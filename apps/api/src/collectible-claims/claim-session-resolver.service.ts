import { Injectable } from "@nestjs/common";
import { decryptSecret, encryptSecret, generateOpaqueToken, sha256Hex } from "@ove/auth";
import type { ClaimSession } from "@ove/database";
import { getEncryptionKey } from "../common/encryption-key";
import { ClaimSessionRepository } from "./claim-session.repository";

/** サーバー側Claim Sessionの有効期間 (WalletReferralの既定24時間と同じ目安)。 */
export const CLAIM_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export interface ResolvedClaimSession {
  session: ClaimSession;
  rawToken: string;
}

/**
 * NFTカードClaim導線実装指示書4章。`/claim/{token}`の`{token}`は2種類ありうる:
 * - 戦国マーケットが発行した生Claim Token (初回訪問時)
 * - 既存Claim Sessionの`id` (ログイン復帰・再読み込み時、指示書5章の安全なReturn
 *   Path`/claim/<safe-session-id>`によりURLに現れるのはこちら)
 * この両方を同じ`{token}`パスセグメントで受け付け、`id`一致を先に試し、無ければ
 * 生Tokenのハッシュで検索、それも無ければ新規作成する。
 */
@Injectable()
export class ClaimSessionResolver {
  constructor(private readonly sessions: ClaimSessionRepository) {}

  async resolve(tokenOrSessionId: string): Promise<ResolvedClaimSession> {
    const bySessionId = await this.sessions.findById(tokenOrSessionId);
    if (bySessionId) {
      return { session: bySessionId, rawToken: decryptSecret(bySessionId.tokenEncrypted, getEncryptionKey()) };
    }

    const tokenHash = sha256Hex(tokenOrSessionId);
    const existing = await this.sessions.findByTokenHash(tokenHash);
    if (existing) {
      return { session: existing, rawToken: tokenOrSessionId };
    }

    const created = await this.sessions.create({
      id: generateOpaqueToken(32),
      tokenHash,
      tokenEncrypted: encryptSecret(tokenOrSessionId, getEncryptionKey()),
      expiresAt: new Date(Date.now() + CLAIM_SESSION_TTL_MS),
    });
    return { session: created, rawToken: tokenOrSessionId };
  }
}
