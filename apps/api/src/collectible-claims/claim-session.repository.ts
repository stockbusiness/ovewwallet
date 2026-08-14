import { Inject, Injectable } from "@nestjs/common";
import type { ClaimSession, PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";

export interface CreateClaimSessionParams {
  id: string;
  tokenHash: string;
  tokenEncrypted: string;
  expiresAt: Date;
}

/**
 * NFTカードClaim導線実装指示書4章。`ClaimSession`(生Claim Tokenをブラウザへ
 * 保存させないためのサーバー側セッション) へのPrismaアクセスを集約する。
 */
@Injectable()
export class ClaimSessionRepository {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async findById(id: string): Promise<ClaimSession | null> {
    return this.db.claimSession.findUnique({ where: { id } });
  }

  async findByTokenHash(tokenHash: string): Promise<ClaimSession | null> {
    return this.db.claimSession.findUnique({ where: { tokenHash } });
  }

  async create(params: CreateClaimSessionParams): Promise<ClaimSession> {
    return this.db.claimSession.create({ data: params });
  }

  /**
   * 契約v2指示書28章。生Claim Tokenでの再訪問(`findByTokenHash`一致)が既に期限切れ
   * だった場合、Session IDは変えずに有効期限だけ延長する
   * (Session ID経由アクセスの「自動延長しない」とは別の経路 — 同じ生Tokenへの
   * 再訪問はMarketの受取導線をやり直したのと同じ意味であり、新規発行を妨げない)。
   */
  async renewExpiry(id: string, expiresAt: Date): Promise<ClaimSession> {
    return this.db.claimSession.update({ where: { id }, data: { expiresAt } });
  }
}
