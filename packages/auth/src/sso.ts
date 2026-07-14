import { generateOpaqueToken, hashSecret, verifySecret } from "./crypto";
import type { KeyValueStore } from "./kv-store";

const SSO_CODE_TTL_SECONDS = 60; // 有効期限60秒

export class SsoCodeInvalidError extends Error {
  constructor() {
    super("SSO code is invalid, expired, or already used");
    this.name = "SsoCodeInvalidError";
  }
}

function ssoKey(codeId: string): string {
  return `sso:code:${codeId}`;
}

/**
 * 戦国パスポート側が発行する短時間・1回限りのSSOコードを模した実装。
 * URLには氏名・メール・電話番号・LINEユーザーID・OVE残高・戦国パスポート
 * セッション情報を一切含めない (コードは256bit乱数、ハッシュ化して保存)。
 */
export class SengokuSsoService {
  constructor(private readonly store: KeyValueStore) {}

  /** 戦国パスポート側 (モック) がSSOコードを発行する。 */
  async issueCode(sengokuMemberId: string): Promise<string> {
    const codeId = generateOpaqueToken(8); // ルックアップ用の公開部分
    const secret = generateOpaqueToken(32); // 256bit以上のランダム値
    const fullCode = `${codeId}.${secret}`;

    await this.store.set(
      ssoKey(codeId),
      JSON.stringify({ secretHash: hashSecret(secret), sengokuMemberId }),
      SSO_CODE_TTL_SECONDS,
    );

    return fullCode;
  }

  /** OVEウォレット側がコードを1回だけ検証・消費する。 */
  async exchangeCode(fullCode: string): Promise<{ sengokuMemberId: string }> {
    const [codeId, secret] = fullCode.split(".");
    if (!codeId || !secret) {
      throw new SsoCodeInvalidError();
    }

    const raw = await this.store.get(ssoKey(codeId));
    if (!raw) {
      throw new SsoCodeInvalidError();
    }
    // 1回のみ利用可能: 検証前に即時削除する
    await this.store.del(ssoKey(codeId));

    const { secretHash, sengokuMemberId } = JSON.parse(raw) as {
      secretHash: string;
      sengokuMemberId: string;
    };

    if (!verifySecret(secret, secretHash)) {
      throw new SsoCodeInvalidError();
    }

    return { sengokuMemberId };
  }
}

export interface LineIdTokenClaims {
  lineUserId: string;
  email?: string;
}

/**
 * LINEのIDトークン検証インターフェース。LINEから受け取ったプロフィールを
 * そのまま信用せず、サーバー側でIDトークン/認証コードを検証する契約のみ
 * 定義する。本番実装はLINE Platform APIへ問い合わせて差し替える。
 */
export interface LineAuthVerifier {
  verifyIdToken(idToken: string): Promise<LineIdTokenClaims>;
}

/** 開発・テスト用モック。本番のLINEチャネル連携が整うまでのインターフェース実装。 */
export class MockLineAuthVerifier implements LineAuthVerifier {
  async verifyIdToken(idToken: string): Promise<LineIdTokenClaims> {
    if (!idToken || !idToken.startsWith("mock.")) {
      throw new Error("invalid LINE id token");
    }
    const lineUserId = idToken.slice("mock.".length);
    if (!lineUserId) {
      throw new Error("invalid LINE id token");
    }
    return { lineUserId };
  }
}
