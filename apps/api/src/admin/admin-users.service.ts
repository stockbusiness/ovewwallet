import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { generateOpaqueToken, hashSecret } from "@ove/auth";
import {
  ADMIN_CODE_COUNTER,
  generateId,
  nextDisplayCode,
  Prisma,
  type AdminRole,
  type AdminUserStatus,
  type PrismaClient,
} from "@ove/database";
import { PRISMA } from "../common/prisma.module";

/** 一覧・詳細で返す項目。`passwordHash`・`mfaSecretEncrypted`は決して返さない。 */
const ADMIN_USER_FIELDS = {
  id: true,
  adminCode: true,
  email: true,
  role: true,
  status: true,
  displayName: true,
  mfaEnabled: true,
  mfaEnrolledAt: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface CreateAdminUserParams {
  email: string;
  displayName: string;
  role: AdminRole;
}

export interface UpdateAdminUserParams {
  displayName?: string;
  role?: AdminRole;
  status?: AdminUserStatus;
  reason?: string;
}

/**
 * 管理者アカウントの管理 (追加・ロール変更・停止/再開・パスワードリセット)。
 *
 * これが無いと初期投入スクリプトが作る SUPER_ADMIN 1件しか存在できず、
 * 6種類のロール(`RolesGuard`)も、申請者と承認者に別々の管理者を要求する
 * 二段階承認(`AdminApprovalService`)も実運用できない。
 *
 * 停止(SUSPENDED)は即座に効く。`AdminAuthGuard`がリクエストのたびにDBから管理者を
 * 読み直して`status !== "ACTIVE"`を拒否するため、既存セッションを個別に失効させる
 * 必要がない (退職者のアカウントはこのAPIで停止すればその場でアクセスできなくなる)。
 */
@Injectable()
export class AdminUsersService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async list() {
    return this.db.adminUser.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
      select: ADMIN_USER_FIELDS,
    });
  }

  private async requireAdmin(id: string) {
    const admin = await this.db.adminUser.findUnique({ where: { id } });
    if (!admin) throw new NotFoundException("admin user not found");
    return admin;
  }

  /**
   * 管理者を追加し、初回ログイン用の初期パスワードを発行する。
   * パスワードは戻り値でこの1回だけ返し、DBにはハッシュのみ保存する
   * (外部サービスのAPIキー発行と同じ方針)。受け取った管理者は初回ログイン後に
   * 自分でパスワードを変更する。
   */
  async create(params: CreateAdminUserParams, actorId: string) {
    const existing = await this.db.adminUser.findUnique({ where: { email: params.email } });
    if (existing) throw new ConflictException("このメールアドレスの管理者は既に存在します");

    const initialPassword = generateOpaqueToken(12);
    const created = await this.createWithAllocatedCode(params, initialPassword);

    await this.db.auditLog.create({
      data: {
        id: generateId(),
        actorType: "ADMIN",
        actorId,
        actionType: "ADMIN_USER_CREATE",
        targetType: "admin_user",
        targetId: created.id,
        result: "SUCCESS",
        afterData: { email: created.email, role: created.role, adminCode: created.adminCode },
      },
    });

    return { admin: created, initialPassword };
  }

  /**
   * `admin_code`を採番して作成する。
   *
   * 既存環境では初期投入スクリプトが `OVE-ADM-00000001` を固定値で作成しており、
   * カウンタ未初期化のまま採番すると同じ値に当たって一意制約違反になる。移行用の
   * マイグレーションを増やさずに済むよう、衝突したら次の番号で採り直す
   * (2回目以降はカウンタが進んでいるため通常は1回で成功する)。
   */
  private async createWithAllocatedCode(params: CreateAdminUserParams, initialPassword: string) {
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const adminCode = await nextDisplayCode(this.db, ADMIN_CODE_COUNTER, "OVE-ADM");
      try {
        return await this.db.adminUser.create({
          data: {
            id: generateId(),
            adminCode,
            email: params.email,
            passwordHash: hashSecret(initialPassword),
            role: params.role,
            displayName: params.displayName,
          },
          select: ADMIN_USER_FIELDS,
        });
      } catch (error) {
        const isAdminCodeConflict =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002" &&
          String(error.meta?.target ?? "").includes("admin_code");
        if (!isAdminCodeConflict || attempt === maxAttempts) throw error;
      }
    }
    // ループは必ず return か throw で抜けるため到達しない。
    throw new Error("failed to allocate admin_code");
  }

  /**
   * 表示名・ロール・状態を変更する。
   *
   * 自分自身のロール変更と停止は拒否する。誤操作で自分の権限を失うと復旧できないうえ、
   * 権限昇格を自分ひとりで完結させないため (別のSUPER_ADMINに実施してもらう)。
   *
   * この2つの禁止により「有効なSUPER_ADMINが0人になる」状態は構造的に起こらない。
   * このAPIを呼べるのは有効なSUPER_ADMIN本人 (`AdminAuthGuard`が`status`を毎回確認し、
   * `RolesGuard`がロールを確認する) に限られ、その本人は自分を降格・停止できないため、
   * どの操作の後も操作者自身が有効なSUPER_ADMINとして必ず残る。
   * 将来この自己操作の禁止を緩める場合は、代わりに「最後の有効なSUPER_ADMINを
   * 降格・停止させない」明示的なチェックが必要になる。
   */
  async update(id: string, params: UpdateAdminUserParams, actorId: string) {
    const before = await this.requireAdmin(id);

    if (id === actorId && params.role !== undefined && params.role !== before.role) {
      throw new BadRequestException("自分自身のロールは変更できません (別のSUPER_ADMINに依頼してください)");
    }
    if (id === actorId && params.status === "SUSPENDED") {
      throw new BadRequestException("自分自身のアカウントは停止できません");
    }

    const updated = await this.db.adminUser.update({
      where: { id },
      data: {
        displayName: params.displayName,
        role: params.role,
        status: params.status,
      },
      select: ADMIN_USER_FIELDS,
    });

    await this.db.auditLog.create({
      data: {
        id: generateId(),
        actorType: "ADMIN",
        actorId,
        actionType: "ADMIN_USER_UPDATE",
        targetType: "admin_user",
        targetId: id,
        result: "SUCCESS",
        reason: params.reason,
        beforeData: { role: before.role, status: before.status, displayName: before.displayName },
        afterData: { role: updated.role, status: updated.status, displayName: updated.displayName },
      },
    });

    return updated;
  }

  /**
   * パスワードを再発行する (本人がログインできなくなった場合の復旧用)。
   * 新しいパスワードは戻り値でこの1回だけ返す。
   *
   * MFAが有効な管理者はパスワードだけではログインできないため、MFA端末を失った場合は
   * 別途 `mfaEnabled` を落とす必要がある。ここでMFAを一緒に解除しないのは、
   * パスワードリセットだけで二要素を無効化できてしまうと、SUPER_ADMIN権限の乗っ取りが
   * 1操作で完結してしまうため。
   */
  async resetPassword(id: string, reason: string, actorId: string) {
    await this.requireAdmin(id);

    const newPassword = generateOpaqueToken(12);
    const updated = await this.db.adminUser.update({
      where: { id },
      data: { passwordHash: hashSecret(newPassword) },
      select: ADMIN_USER_FIELDS,
    });

    await this.db.auditLog.create({
      data: {
        id: generateId(),
        actorType: "ADMIN",
        actorId,
        actionType: "ADMIN_USER_PASSWORD_RESET",
        targetType: "admin_user",
        targetId: id,
        result: "SUCCESS",
        reason,
      },
    });

    return { admin: updated, newPassword };
  }
}
