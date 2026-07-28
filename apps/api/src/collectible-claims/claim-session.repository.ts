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
}
