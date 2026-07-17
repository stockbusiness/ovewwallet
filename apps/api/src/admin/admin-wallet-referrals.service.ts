import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";

/**
 * 代理店紹介トークン受け入れの確認画面 (実装指示書 v1.0 14章「管理画面の確認機能」)。
 * Phase 1では確認 (一覧・詳細) のみを提供する。管理者による手動確定・取消・紹介者訂正
 * (14.3章) はPhase 3で追加する運用機能のため、ここでは実装しない。
 */
// 紹介トークン全文・そのハッシュ・セッションCookieのハッシュは管理画面へ一切出さない
// (実装指示書14.1章)。IP/UAは元から一方向ハッシュのみ保存しているため、そのまま返してよい。
const SAFE_SELECT = {
  id: true,
  walletUserId: true,
  commonUserId: true,
  agencyId: true,
  agencyRank: true,
  status: true,
  source: true,
  capturedAt: true,
  expiresAt: true,
  usedAt: true,
  registeredAt: true,
  confirmedAt: true,
  rejectedAt: true,
  revokedAt: true,
  lastErrorCode: true,
  lastErrorMessage: true,
  createdIpHash: true,
  userAgentHash: true,
  reason: true,
  createdAt: true,
  updatedAt: true,
  account: { select: { id: true, accountCode: true, displayName: true } },
  benefits: true,
} as const;

@Injectable()
export class AdminWalletReferralsService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async list(params: { status?: string; limit?: number }): Promise<unknown> {
    return this.db.walletReferral.findMany({
      where: params.status ? { status: params.status as never } : undefined,
      orderBy: { createdAt: "desc" },
      take: Math.min(params.limit ?? 100, 500),
      select: SAFE_SELECT,
    });
  }

  async detail(id: string): Promise<unknown> {
    const referral = await this.db.walletReferral.findUnique({ where: { id }, select: SAFE_SELECT });
    if (!referral) throw new NotFoundException("wallet referral not found");
    return referral;
  }
}
