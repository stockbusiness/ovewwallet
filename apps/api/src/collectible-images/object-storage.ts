import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { Injectable, Logger } from "@nestjs/common";

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
  private client: S3Client | null = null;

  isConfigured(): boolean {
    return readConfig() !== null;
  }

  bucket(): string | null {
    return readConfig()?.bucket ?? null;
  }

  async put(params: {
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<void> {
    const config = this.requireConfig();
    await this.getClient().send(
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
    const config = this.requireConfig();
    try {
      const result = await this.getClient().send(
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

  private requireConfig(): StorageConfig {
    const config = readConfig();
    if (!config) {
      throw new Error("object storage is not configured (COLLECTIBLE_IMAGE_STORAGE_* env vars)");
    }
    return config;
  }

  /**
   * クライアントは使い回す。呼び出しごとに作ると接続が張り直しになるため。
   * 設定が変わることは実運用では起こらない (環境変数は再起動で入れ替わる)。
   */
  private getClient(): S3Client {
    if (this.client) return this.client;
    const config = this.requireConfig();
    const options: S3ClientConfig = {
      region: config.region,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    };
    // R2 は独自エンドポイントを使う。S3 なら未設定でよい。
    if (config.endpoint) {
      options.endpoint = config.endpoint;
      // R2 は path-style を要求する。
      options.forcePathStyle = true;
    }
    this.logger.log(
      `object storage enabled (bucket=${config.bucket}${config.endpoint ? ", custom endpoint" : ""})`,
    );
    this.client = new S3Client(options);
    return this.client;
  }
}

interface StorageConfig {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
}

function readConfig(env: NodeJS.ProcessEnv = process.env): StorageConfig | null {
  const bucket = env["COLLECTIBLE_IMAGE_STORAGE_BUCKET"];
  const accessKeyId = env["COLLECTIBLE_IMAGE_STORAGE_ACCESS_KEY_ID"];
  const secretAccessKey = env["COLLECTIBLE_IMAGE_STORAGE_SECRET_ACCESS_KEY"];
  if (!bucket || !accessKeyId || !secretAccessKey) return null;

  const endpoint = env["COLLECTIBLE_IMAGE_STORAGE_ENDPOINT"];
  return {
    bucket,
    // R2 は region を見ないが、SDKが必須とするため既定値を置く。
    region: env["COLLECTIBLE_IMAGE_STORAGE_REGION"] || "auto",
    accessKeyId,
    secretAccessKey,
    ...(endpoint ? { endpoint } : {}),
  };
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === "NoSuchKey" || name === "NotFound";
}
