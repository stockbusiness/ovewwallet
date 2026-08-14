import { Injectable } from "@nestjs/common";
import { decryptSecret, encryptSecret, generateOpaqueToken, sha256Hex } from "@ove/auth";
import type { ClaimSession } from "@ove/database";
import { getEncryptionKey } from "../common/encryption-key";
import { ClaimSessionRepository } from "./claim-session.repository";

/** サーバー側Claim Sessionの有効期間 (WalletReferralの既定24時間と同じ目安)。 */
export const CLAIM_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export type ResolveClaimSessionResult =
  | { outcome: "ok"; session: ClaimSession; rawToken: string }
  /**
   * 千ノ国NFTマーケット契約v2指示書26〜28章。安全なSession ID(`/claim/<id>`)で
   * アクセスされ、かつ`expiresAt`を過ぎている。自動延長はせず、Marketの受取導線を
   * やり直してもらう (Market側のClaim entitlement自体は無期限のため、購入権は失効しない)。
   */
  | { outcome: "session_expired" };

/**
 * NFTカードClaim導線実装指示書4章。`/claim/{token}`の`{token}`は2種類ありうる:
 * - 戦国マーケットが発行した生Claim Token (初回訪問時)
 * - 既存Claim Sessionの`id` (ログイン復帰・再読み込み時、指示書5章の安全なReturn
 *   Path`/claim/<safe-session-id>`によりURLに現れるのはこちら)
 * この両方を同じ`{token}`パスセグメントで受け付け、`id`一致を先に試し、無ければ
 * 生Tokenのハッシュで検索、それも無ければ新規作成する。
 *
 * 契約v2指示書26〜28章。`expiresAt`は作成時に設定されるだけで、これまで実際に
 * 参照時の期限判定を行っていなかった。以下の2経路で扱いを分ける:
 * - Session ID経由 (`findById`一致) が期限切れ: 自動延長しない。`session_expired`を
 *   返し、呼び出し元はMarketの受取導線からやり直すよう案内する。
 * - 生Token経由 (`findByTokenHash`一致) が期限切れ: 同じ生Tokenでの再訪問は
 *   Marketの受取導線をやり直したのと同じ意味のため、Session IDはそのままで
 *   有効期限だけ延長して使えるようにする (「Marketから再度受取手続き」の実体)。
 */
@Injectable()
export class ClaimSessionResolver {
  constructor(private readonly sessions: ClaimSessionRepository) {}

  async resolve(tokenOrSessionId: string): Promise<ResolveClaimSessionResult> {
    const bySessionId = await this.sessions.findById(tokenOrSessionId);
    if (bySessionId) {
      if (bySessionId.expiresAt <= new Date()) {
        return { outcome: "session_expired" };
      }
      return { outcome: "ok", session: bySessionId, rawToken: decryptSecret(bySessionId.tokenEncrypted, getEncryptionKey()) };
    }

    const tokenHash = sha256Hex(tokenOrSessionId);
    const existing = await this.sessions.findByTokenHash(tokenHash);
    if (existing) {
      if (existing.expiresAt <= new Date()) {
        const renewed = await this.sessions.renewExpiry(existing.id, new Date(Date.now() + CLAIM_SESSION_TTL_MS));
        return { outcome: "ok", session: renewed, rawToken: tokenOrSessionId };
      }
      return { outcome: "ok", session: existing, rawToken: tokenOrSessionId };
    }

    const created = await this.sessions.create({
      id: generateOpaqueToken(32),
      tokenHash,
      tokenEncrypted: encryptSecret(tokenOrSessionId, getEncryptionKey()),
      expiresAt: new Date(Date.now() + CLAIM_SESSION_TTL_MS),
    });
    return { outcome: "ok", session: created, rawToken: tokenOrSessionId };
  }
}
