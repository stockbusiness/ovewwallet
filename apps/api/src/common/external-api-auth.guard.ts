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

export interface AuthenticatedServiceRequest extends Request {
  serviceIntegration: ServiceIntegration;
}

/**
 * 外部サービスAPI認証 (指示書11章): APIキー・HMAC署名・タイムスタンプ・nonce・
 * IP制限を検証する。金額上限・idempotency key の検証はサービス層で行う。
 */
@Injectable()
export class ExternalApiAuthGuard implements CanActivate {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(KV_STORE) private readonly kv: KeyValueStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const apiKey = req.header("x-ove-api-key");
    const timestamp = req.header("x-ove-timestamp");
    const nonce = req.header("x-ove-nonce");
    const signature = req.header("x-ove-signature");

    if (!apiKey || !timestamp || !nonce || !signature) {
      throw new UnauthorizedException("missing X-OVE-* authentication headers");
    }

    const candidates = await this.db.serviceIntegration.findMany({ where: { status: "ACTIVE" } });
    const integration = candidates.find((c) => verifySecret(apiKey, c.apiKeyHash));
    if (!integration) {
      throw new UnauthorizedException("invalid API key");
    }

    const encryptionKey = process.env.ENCRYPTION_KEY || "dev-only-insecure-encryption-key";
    const signingSecret = decryptSecret(integration.signingSecretEncrypted, encryptionKey);

    const canonicalPayload = `${req.method}:${req.originalUrl}:${JSON.stringify(req.body ?? {})}`;
    const authenticator = new ExternalApiAuthenticator(this.kv);

    await authenticator.verify(
      {
        apiKey,
        timestamp,
        nonce,
        signature,
        canonicalPayload,
        sourceIp: req.ip ?? "unknown",
      },
      {
        serviceIntegrationId: integration.id,
        signingSecret,
        allowedIps: integration.allowedIps,
      },
    );

    await this.db.serviceIntegration.update({
      where: { id: integration.id },
      data: { lastAccessedAt: new Date() },
    });

    (req as AuthenticatedServiceRequest).serviceIntegration = integration;
    return true;
  }
}
