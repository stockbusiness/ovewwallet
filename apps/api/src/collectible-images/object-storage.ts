import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { Injectable, Logger } from "@nestjs/common";
import {
  CollectibleImageStorageConfigService,
  type ResolvedStorageConfig,
} from "./storage-config.service";

/** 接続テストで書き込む固定キー。毎回上書きするので増えない。 */
export const CONNECTION_TEST_KEY = "_wallet-connection-test";

export type StorageTestOutcome = "ok" | "failed" | "not_configured";

export interface StorageTestResult {
  outcome: StorageTestOutcome;
  message: string;
  bucket: string | null;
}

/**
 * S3互換のオブジェクトストレージ (Cloudflare R2 / AWS S3) への読み書き。
 *
 * 設定が揃っていなければ**無効として振る舞う** (`isConfigured() === false`)。
 * 未設定で起動を止めないのは、画像の保管が使えないことより、ウォレット全体が
 * 起動しないことの方が害が大きいため。無効の間は取り込みを行わず、これまでどおり
 * 外部URLをそのまま表示する (docs/collectible-images.md)。
 */
@Injectable()
export class ObjectStorageService {
  private readonly logger = new Logger(ObjectStorageService.name);
  /** 設定が変わったら作り直せるよう、生成時の設定の指紋と一緒に持つ。 */
  private cached: { fingerprint: string; client: S3Client } | null = null;

  constructor(private readonly config: CollectibleImageStorageConfigService) {}

  async isConfigured(): Promise<boolean> {
    return (await this.config.resolve()) !== null;
  }

  async put(params: { key: string; body: Buffer; contentType: string }): Promise<void> {
    const config = await this.requireConfig();
    await this.getClient(config).send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: params.key,
        Body: params.body,
        ContentType: params.contentType,
        // 内容でキーを決めているため中身は変わらない。長期キャッシュを許す。
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
  }

  async get(key: string): Promise<{ body: Buffer; contentType: string | null } | null> {
    const config = await this.requireConfig();
    try {
      const result = await this.getClient(config).send(
        new GetObjectCommand({ Bucket: config.bucket, Key: key }),
      );
      if (!result.Body) return null;
      const bytes = await result.Body.transformToByteArray();
      return { body: Buffer.from(bytes), contentType: result.ContentType ?? null };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  /**
   * 保存済みの設定で実際に書いて読み戻す。
   *
   * 一覧や存在確認では**書き込み権限があるかが分からない**。実際に必要なのは書き込み
   * なので、そこまで確かめる。書き先は固定キーで毎回上書きするため、ゴミが増えない。
   */
  async testConnection(): Promise<StorageTestResult> {
    const config = await this.config.resolve();
    if (!config) {
      return {
        outcome: "not_configured",
        message: "バケット・アクセスキー・シークレットのいずれかが未設定です。",
        bucket: null,
      };
    }

    const probe = Buffer.from(`ove-wallet connection test ${new Date().toISOString()}`);
    try {
      await this.put({ key: CONNECTION_TEST_KEY, body: probe, contentType: "text/plain" });
      const readBack = await this.get(CONNECTION_TEST_KEY);
      if (!readBack) {
        return {
          outcome: "failed",
          message: "書き込みは成功しましたが、読み戻せませんでした。読み取り権限をご確認ください。",
          bucket: config.bucket,
        };
      }
      return {
        outcome: "ok",
        message: "書き込みと読み取りに成功しました。",
        bucket: config.bucket,
      };
    } catch (error) {
      // 例外の文言に鍵が混ざらないよう、名前とメッセージだけを短く返す。
      return {
        outcome: "failed",
        message: describeError(error),
        bucket: config.bucket,
      };
    }
  }

  /** 管理画面で設定を変えた直後から新しい設定で動かすため、作り置きを捨てる。 */
  invalidate(): void {
    this.cached = null;
  }

  private async requireConfig(): Promise<ResolvedStorageConfig> {
    const config = await this.config.resolve();
    if (!config) {
      throw new Error("object storage is not configured");
    }
    return config;
  }

  /**
   * クライアントは使い回す。呼び出しごとに作ると接続が張り直しになるため。
   * 設定が変わったときだけ作り直す。
   */
  private getClient(config: ResolvedStorageConfig): S3Client {
    const fingerprint = fingerprintOf(config);
    if (this.cached?.fingerprint === fingerprint) return this.cached.client;

    const options: S3ClientConfig = {
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    };
    // R2 は独自エンドポイントと path-style を要求する。S3 なら未設定でよい。
    if (config.endpoint) {
      options.endpoint = config.endpoint;
      options.forcePathStyle = true;
    }
    this.logger.log(
      `object storage client created (bucket=${config.bucket}${config.endpoint ? ", custom endpoint" : ""})`,
    );
    const client = new S3Client(options);
    this.cached = { fingerprint, client };
    return client;
  }
}

/** 鍵そのものは指紋に含めない (ログにも例外にも出ないようにするため、長さだけ見る)。 */
function fingerprintOf(config: ResolvedStorageConfig): string {
  return [
    config.bucket,
    config.region,
    config.endpoint ?? "",
    config.accessKeyId,
    String(config.secretAccessKey.length),
  ].join("|");
}

function describeError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const name = (error as { name?: unknown }).name;
    const message = (error as { message?: unknown }).message;
    if (typeof name === "string" && typeof message === "string") {
      return `${name}: ${message}`.slice(0, 300);
    }
  }
  return error instanceof Error ? error.message.slice(0, 300) : "unknown error";
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === "NoSuchKey" || name === "NotFound";
}
