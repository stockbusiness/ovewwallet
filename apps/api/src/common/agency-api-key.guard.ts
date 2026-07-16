import { type CanActivate, type ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { verifySecret } from "@ove/auth";
import type { ServiceIntegration, PrismaClient } from "@ove/database";
import { PRISMA } from "./prisma.module";

export interface AuthenticatedPartnerRequest extends Request {
  serviceIntegration: ServiceIntegration;
}

/**
 * 戦国経済圏代理店システム外部連携API仕様書5章の認証方式:
 * `x-api-key` ヘッダー、または `Authorization: Bearer` ヘッダーのどちらかで
 * 単純なAPIキー照合を行う。既存の `ExternalApiAuthGuard` (HMAC署名・タイムスタンプ・
 * nonce必須) とは異なり、開発ガイドライン9.1章の方針で`service_integrations`
 * (ServiceCode.AGENCY_SYSTEM) を再利用しつつも、sengoku-ai.com側がHMAC署名に
 * 対応していないため認証ロジック自体は簡易な鍵照合のみとする。
 */
@Injectable()
export class AgencyApiKeyGuard implements CanActivate {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const apiKey = this.extractApiKey(req);
    if (!apiKey) {
      throw new UnauthorizedException("missing x-api-key or Authorization: Bearer header");
    }

    const candidates = await this.db.serviceIntegration.findMany({
      where: { serviceCode: "AGENCY_SYSTEM", status: "ACTIVE" },
    });
    const matched = candidates.find((c) => verifySecret(apiKey, c.apiKeyHash));
    if (!matched) {
      throw new UnauthorizedException("invalid API key");
    }

    await this.db.serviceIntegration.update({
      where: { id: matched.id },
      data: { lastAccessedAt: new Date() },
    });

    (req as unknown as AuthenticatedPartnerRequest).serviceIntegration = matched;
    return true;
  }

  private extractApiKey(req: Request): string | undefined {
    const direct = req.header("x-api-key");
    if (direct) return direct;

    const authHeader = req.header("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      return authHeader.slice("Bearer ".length).trim();
    }
    return undefined;
  }
}
