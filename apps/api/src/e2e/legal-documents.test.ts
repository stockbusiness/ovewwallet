import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { prisma, generateId } from "@ove/database";
import { hashSecret } from "@ove/auth";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";
import { LegalDocumentsService } from "../legal/legal-documents.service";

/**
 * 利用規約・プライバシーポリシー・会社情報の管理 (docs/legal-documents.md)。
 *
 * 一番大事なのは、**利用規約のバージョンを変えると再同意が始まる**ことと、
 * **バージョンを据え置けば始まらない**こと。ここを取り違えると、誤字修正で
 * 全利用者を止めるか、内容を変えたのに同意を取り直さないかのどちらかになる。
 */
describe("法的文書", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let auditorCookie: string[];

  async function loginAdmin(role: "SUPER_ADMIN" | "AUDITOR"): Promise<string[]> {
    const email = `e2e-legal-${role}-${generateId()}@ovewallet.local`;
    const password = "e2e-test-password-123";
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-${generateId()}`,
        email,
        passwordHash: hashSecret(password),
        role,
        displayName: `E2E ${role}`,
      },
    });
    const res = await request(app.getHttpServer())
      .post("/api/v1/admin/login")
      .send({ email, password })
      .expect(201);
    return res.headers["set-cookie"] as unknown as string[];
  }

  async function createUser() {
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/line/login")
      .send({ idToken: `mock.${generateId()}`, termsAccepted: true })
      .expect(201);
    return login.headers["set-cookie"] as unknown as string[];
  }

  async function saveTerms(body: Record<string, unknown>) {
    await request(app.getHttpServer())
      .post("/api/v1/admin/legal/terms")
      .set("Cookie", adminCookie)
      .send({ reason: "e2e", ...body })
      .expect(201);
    // 版番号は短時間キャッシュされる。テストでは即座に効かせたい。
    app.get(LegalDocumentsService).invalidateTermsVersionCache();
  }

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
    adminCookie = await loginAdmin("SUPER_ADMIN");
    auditorCookie = await loginAdmin("AUDITOR");
  });

  afterEach(async () => {
    // 他のテストへ影響させないため、規約は毎回もとの状態へ戻す。
    await prisma.legalDocument.update({
      where: { slug: "terms" },
      data: { version: "1.0", published: true },
    });
    app.get(LegalDocumentsService).invalidateTermsVersionCache();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe("利用者側の参照", () => {
    it("公開済みの規約はログインせずに読める", async () => {
      // 登録前に読めないと意味がない
      const res = await request(app.getHttpServer()).get("/api/v1/legal/terms").expect(200);
      expect(res.body.title).toBe("ORI利用規約");
      expect(res.body.body).toContain("第1条");
      expect(res.body.version).toBe("1.0");
    });

    it("未公開の文書は404にする (書きかけを見せない)", async () => {
      await request(app.getHttpServer()).get("/api/v1/legal/privacy").expect(404);
    });

    it("公開すると読めるようになる", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/admin/legal/privacy")
        .set("Cookie", adminCookie)
        .send({ published: true, reason: "e2e" })
        .expect(201);
      try {
        await request(app.getHttpServer()).get("/api/v1/legal/privacy").expect(200);
      } finally {
        await prisma.legalDocument.update({ where: { slug: "privacy" }, data: { published: false } });
      }
    });

    it("知らない種類の文書は404にする", async () => {
      await request(app.getHttpServer()).get("/api/v1/legal/unknown-doc").expect(404);
    });

    it("一覧には公開済みのものだけが並ぶ", async () => {
      const res = await request(app.getHttpServer()).get("/api/v1/legal").expect(200);
      expect(res.body.slugs).toEqual(["terms"]);
    });
  });

  describe("バージョンと再同意", () => {
    it("バージョンを据え置いて本文だけ直しても再同意は起きない", async () => {
      // 誤字修正のたびに全利用者を止めない
      const cookie = await createUser();
      await saveTerms({ body: "## 第1条\n誤字を直しました。" });

      const res = await request(app.getHttpServer())
        .get("/api/v1/accounts/me/terms")
        .set("Cookie", cookie)
        .expect(200);
      expect(res.body.consent_required).toBe(false);
    });

    it("バージョンを変えると既存利用者に再同意が求められる", async () => {
      const cookie = await createUser();
      await saveTerms({ version: "2.0" });

      const res = await request(app.getHttpServer())
        .get("/api/v1/accounts/me/terms")
        .set("Cookie", cookie)
        .expect(200);
      expect(res.body.current_version).toBe("2.0");
      expect(res.body.consent_required).toBe(true);
    });

    it("再同意するまで更新系は拒否され、同意すれば通る", async () => {
      const cookie = await createUser();
      await saveTerms({ version: "2.0" });

      await request(app.getHttpServer())
        .put("/api/v1/accounts/me/profile")
        .set("Cookie", cookie)
        .send({ fullName: "田中太郎" })
        .expect(403);

      await request(app.getHttpServer())
        .post("/api/v1/accounts/me/terms/accept")
        .set("Cookie", cookie)
        .expect(201);

      await request(app.getHttpServer())
        .put("/api/v1/accounts/me/profile")
        .set("Cookie", cookie)
        .send({ fullName: "田中太郎" })
        .expect(200);
    });

    it("バージョンを上げた後の新規登録者は、登録直後に再同意を求められない", async () => {
      // 登録時に記録する版が古いままだと、登録した瞬間に止められてしまう
      await saveTerms({ version: "3.0" });
      const cookie = await createUser();

      const res = await request(app.getHttpServer())
        .get("/api/v1/accounts/me/terms")
        .set("Cookie", cookie)
        .expect(200);
      expect(res.body.agreed_version).toBe("3.0");
      expect(res.body.consent_required).toBe(false);
    });
  });

  describe("管理画面からの編集", () => {
    it("未公開のものも含めて一覧できる", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/legal")
        .set("Cookie", adminCookie)
        .expect(200);
      expect(res.body.map((d: { slug: string }) => d.slug)).toEqual(["terms", "privacy", "company"]);
    });

    it("変更は監査ログに残り、再同意を伴うかどうかが分かる", async () => {
      await saveTerms({ version: "4.0", reason: "規約改定" });

      const log = await prisma.auditLog.findFirstOrThrow({
        where: { actionType: "LEGAL_DOCUMENT_UPDATED", targetId: "terms" },
        orderBy: { createdAt: "desc" },
      });
      expect((log.afterData as { reconsentRequired: boolean }).reconsentRequired).toBe(true);
    });

    it("本文だけの変更では、再同意を伴わないと記録される", async () => {
      await saveTerms({ body: "## 第1条\n直しました。", reason: "誤字修正" });

      const log = await prisma.auditLog.findFirstOrThrow({
        where: { actionType: "LEGAL_DOCUMENT_UPDATED", targetId: "terms" },
        orderBy: { createdAt: "desc" },
      });
      const after = log.afterData as { reconsentRequired: boolean; bodyChanged: boolean };
      expect(after.reconsentRequired).toBe(false);
      expect(after.bodyChanged).toBe(true);
    });

    it("理由なしでは保存できない", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/admin/legal/terms")
        .set("Cookie", adminCookie)
        .send({ version: "9.9" })
        .expect(400);
    });

    it("AUDITORは読めるが変更できない", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/admin/legal")
        .set("Cookie", auditorCookie)
        .expect(200);
      await request(app.getHttpServer())
        .post("/api/v1/admin/legal/terms")
        .set("Cookie", auditorCookie)
        .send({ version: "9.9", reason: "e2e" })
        .expect(403);
    });

    it("ログインしていなければ読めも変えもしない", async () => {
      await request(app.getHttpServer()).get("/api/v1/admin/legal").expect(401);
      await request(app.getHttpServer())
        .post("/api/v1/admin/legal/terms")
        .send({ version: "9.9", reason: "e2e" })
        .expect(401);
    });
  });
});
