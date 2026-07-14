import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { ExternalApiAuthenticator, decryptSecret, verifySecret } from "@ove/auth";
import type { ServiceIntegration, PrismaClient } from "@ove/database";
import { PRISMA } from "./prisma.module";
import { KV_STORE } from "./kv-store.module";
import type { KeyValueStore } from "@ove/auth";
import { logApiAccess } from "./api-access-log";
import type { RequestWithId } from "./request-id.middleware";

export interface AuthenticatedServiceRequest extends Request {
  serviceIntegration: ServiceIntegration;
}

/**
 * 外部サービスAPI認証 (指示書11章): APIキー・HMAC署名・タイムスタンプ・nonce・
 * IP制限を検証する。金額上限・idempotency key の検証はサービス層で行う。
 * 認証段階で拒否したリクエストはここで `api_access_logs` に記録する
 * (認証成功後の業務ロジックの結果は `ApiAccessLogInterceptor` が記録する)。
 */
@Injectable()
export class ExternalApiAuthGuard implements CanActivate {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(KV_STORE) private readonly kv: KeyValueStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & Partial<RequestWithId>>();
    const apiKey = req.header("x-ove-api-key");
    let integration: ServiceIntegration | undefined;

    try {
      const timestamp = req.header("x-ove-timestamp");
      const nonce = req.header("x-ove-nonce");
      const signature = req.header("x-ove-signature");

      if (!apiKey || !timestamp || !nonce || !signature) {
        throw new UnauthorizedException("missing X-OVE-* authentication headers");
      }

      const candidates = await this.db.serviceIntegration.findMany({ where: { status: "ACTIVE" } });
      integration = candidates.find((c) => verifySecret(apiKey, c.apiKeyHash));
      if (!integration) {
        throw new UnauthorizedException("invalid API key");
      }

      const encryptionKey = process.env.ENCRYPTION_KEY || "dev-only-insecure-encryption-key";
      const signingSecret = decryptSecret(integration.signingSecretEncrypted, encryptionKey);
      const canonicalPayload = `${req.method}:${req.originalUrl}:${JSON.stringify(req.body ?? {})}`;
      const authenticator = new ExternalApiAuthenticator(this.kv);

      await authenticator.verify(
        { apiKey, timestamp, nonce, signature, canonicalPayload, sourceIp: req.ip ?? "unknown" },
        { serviceIntegrationId: integration.id, signingSecret, allowedIps: integration.allowedIps },
      );

      await this.db.serviceIntegration.update({
        where: { id: integration.id },
        data: { lastAccessedAt: new Date() },
      });

      (req as unknown as AuthenticatedServiceRequest).serviceIntegration = integration;
      return true;
    } catch (error) {
      await this.safeLog(req, integration?.id ?? null, apiKey, error);
      throw error;
    }
  }

  private async safeLog(
    req: Request & Partial<RequestWithId>,
    serviceIntegrationId: string | null,
    apiKey: string | undefined,
    error: unknown,
  ): Promise<void> {
    try {
      await logApiAccess(this.db, {
        serviceIntegrationId,
        apiKeyPrefix: apiKey ? apiKey.slice(0, 10) : null,
        method: req.method,
        path: req.originalUrl,
        statusCode: 401,
        sourceIp: req.ip,
        requestId: req.requestId,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    } catch {
      // ログ記録自体の失敗でAPIリクエストの本来の処理結果を左右しない
    }
  }
}
