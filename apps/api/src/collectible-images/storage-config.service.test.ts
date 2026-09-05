import { prisma } from "@ove/database";
import {
  CollectibleImageStorageConfigService,
  IMAGE_STORAGE_CONFIG_ID,
  maskSecret,
} from "./storage-config.service";

const ENV_ONLY: NodeJS.ProcessEnv = {
  COLLECTIBLE_IMAGE_STORAGE_BUCKET: "env-bucket",
  COLLECTIBLE_IMAGE_STORAGE_ACCESS_KEY_ID: "env-key-id",
  COLLECTIBLE_IMAGE_STORAGE_SECRET_ACCESS_KEY: "env-secret",
};

describe("maskSecret", () => {
  it("末尾4文字だけ残す", () => {
    expect(maskSecret("abcdefghij")).toBe("******ghij");
  });

  it("4文字以下は全部隠す (末尾が丸見えにならないように)", () => {
    expect(maskSecret("abcd")).toBe("****");
    expect(maskSecret("ab")).toBe("**");
  });
});

describe("CollectibleImageStorageConfigService", () => {
  const service = new CollectibleImageStorageConfigService(prisma);

  beforeEach(async () => {
    await prisma.collectibleImageStorageConfig.deleteMany({});
  });

  afterAll(async () => {
    await prisma.collectibleImageStorageConfig.deleteMany({});
    await prisma.$disconnect();
  });

  describe("resolve", () => {
    it("何も無ければ null", async () => {
      expect(await service.resolve({})).toBeNull();
    });

    it("環境変数だけでも動く (管理画面へ入れるまでの逃げ道)", async () => {
      const resolved = await service.resolve(ENV_ONLY);
      expect(resolved).toMatchObject({
        bucket: "env-bucket",
        accessKeyId: "env-key-id",
        secretAccessKey: "env-secret",
        region: "auto",
      });
    });

    it("管理画面の設定が環境変数より優先される", async () => {
      // 鍵の入れ替えにデプロイを待たせないため。
      await service.save(
        { bucket: "db-bucket", accessKeyId: "db-key-id", secretAccessKey: "db-secret" },
        "admin_1",
      );
      const resolved = await service.resolve(ENV_ONLY);
      expect(resolved).toMatchObject({
        bucket: "db-bucket",
        accessKeyId: "db-key-id",
        secretAccessKey: "db-secret",
      });
    });

    it("シークレットは暗号化して保存し、復号して返す", async () => {
      await service.save(
        { bucket: "b", accessKeyId: "k", secretAccessKey: "very-secret-value" },
        "admin_1",
      );
      const row = await prisma.collectibleImageStorageConfig.findUniqueOrThrow({
        where: { id: IMAGE_STORAGE_CONFIG_ID },
      });
      // DBに生値が残っていないこと。
      expect(row.secretAccessKeyEncrypted).not.toContain("very-secret-value");
      expect((await service.resolve({}))?.secretAccessKey).toBe("very-secret-value");
    });

    it("どれか1つでも欠けたら無効として扱う", async () => {
      await service.save({ bucket: "b", accessKeyId: "k" }, "admin_1");
      expect(await service.resolve({})).toBeNull();
    });

    it("エンドポイント未設定なら省略する (S3ではエンドポイント指定が不要)", async () => {
      await service.save({ bucket: "b", accessKeyId: "k", secretAccessKey: "s" }, "admin_1");
      expect(await service.resolve({})).not.toHaveProperty("endpoint");
    });
  });

  describe("save", () => {
    it("シークレットを空欄で保存しても現在の値を消さない", async () => {
      await service.save({ bucket: "b", accessKeyId: "k", secretAccessKey: "keep-me" }, "admin_1");
      await service.save({ bucket: "b2" }, "admin_2");

      const resolved = await service.resolve({});
      expect(resolved?.secretAccessKey).toBe("keep-me");
      expect(resolved?.bucket).toBe("b2");
    });

    it("空文字は未設定へ戻す意図として扱う", async () => {
      await service.save(
        { bucket: "b", endpoint: "https://example.com", accessKeyId: "k", secretAccessKey: "s" },
        "admin_1",
      );
      await service.save({ endpoint: "" }, "admin_1");
      expect(await service.resolve({})).not.toHaveProperty("endpoint");
    });
  });

  describe("describe", () => {
    it("シークレットの生値を返さない", async () => {
      await service.save(
        { bucket: "b", accessKeyId: "k", secretAccessKey: "super-secret-1234" },
        "admin_1",
      );
      const view = await service.describe({});

      expect(JSON.stringify(view)).not.toContain("super-secret-1234");
      expect(view.secretAccessKeySet).toBe(true);
      expect(view.secretAccessKeyPreview).toBe("*************1234");
      expect(view.configured).toBe(true);
    });

    it("環境変数で動いている状態が分かる", async () => {
      const view = await service.describe(ENV_ONLY);
      expect(view.configured).toBe(true);
      expect(view.fallbackFromEnv).toBe(true);
      expect(view.secretAccessKeySet).toBe(false);
    });

    it("何も設定されていなければ configured=false", async () => {
      const view = await service.describe({});
      expect(view.configured).toBe(false);
      expect(view.fallbackFromEnv).toBe(false);
    });
  });
});
