import { Inject, Injectable } from "@nestjs/common";
import { generateId, Prisma, type PrismaClient } from "@ove/database";
import {
  ObjectStorageService,
  type StorageTestResult,
} from "../collectible-images/object-storage";
import { CollectibleImageStorageConfigService } from "../collectible-images/storage-config.service";
import { PRISMA } from "../common/prisma.module";

/**
 * カード画像の保管先設定 (`collectible_image_storage_config`、シングルトン行) を
 * 管理画面から編集する (docs/collectible-images.md)。
 *
 * シークレットはメール送信設定と同じAES-256-GCM可逆暗号化で保存し、**生値は
 * レスポンスへ一切含めない** (末尾4文字のみのマスク表示)。
 */
@Injectable()
export class AdminImageStorageService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly config: CollectibleImageStorageConfigService,
    private readonly storage: ObjectStorageService,
  ) {}

  async get() {
    return this.config.describe();
  }

  /** 指定された項目だけを更新する (シークレットを空欄で保存すると現在の値を維持)。 */
  async update(
    params: {
      bucket?: string;
      endpoint?: string;
      region?: string;
      accessKeyId?: string;
      secretAccessKey?: string;
    },
    adminId: string,
    reason: string,
  ) {
    const before = await this.config.describe();
    await this.config.save(params, adminId);
    // 保存した設定で次の取り込みから動かすため、作り置きのクライアントを捨てる。
    this.storage.invalidate();
    const after = await this.config.describe();

    await this.db.auditLog.create({
      data: {
        id: generateId(),
        actorType: "ADMIN",
        actorId: adminId,
        actionType: "COLLECTIBLE_IMAGE_STORAGE_CONFIG_UPDATED",
        targetType: "collectible_image_storage_config",
        targetId: "default",
        result: "SUCCESS",
        reason,
        // 鍵そのものは残さない。設定されているかと、接続先だけを記録する。
        beforeData: auditView(before) as Prisma.InputJsonValue,
        afterData: auditView(after) as Prisma.InputJsonValue,
      },
    });

    return after;
  }

  /**
   * 接続テスト。保存済みの設定で実際に書いて読み戻す。
   *
   * 本番と同じ鍵で外部へ書き込むので、誰がいつ試したかを監査ログに残す。
   */
  async testConnection(adminId: string): Promise<StorageTestResult> {
    const result = await this.storage.testConnection();

    await this.db.auditLog.create({
      data: {
        id: generateId(),
        actorType: "ADMIN",
        actorId: adminId,
        actionType: "COLLECTIBLE_IMAGE_STORAGE_TESTED",
        targetType: "collectible_image_storage_config",
        targetId: "default",
        result: result.outcome === "ok" ? "SUCCESS" : "FAILURE",
        reason: result.message.slice(0, 300),
        afterData: {
          outcome: result.outcome,
          bucket: result.bucket,
        } as Prisma.InputJsonValue,
      },
    });

    return result;
  }
}

function auditView(view: Awaited<ReturnType<CollectibleImageStorageConfigService["describe"]>>) {
  return {
    configured: view.configured,
    bucket: view.bucket,
    endpoint: view.endpoint,
    region: view.region,
    accessKeyId: view.accessKeyId,
    secretAccessKeySet: view.secretAccessKeySet,
  };
}
