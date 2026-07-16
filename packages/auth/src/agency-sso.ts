import { jwtVerify, createRemoteJWKSet, type JWTVerifyGetKey } from "jose";
import type { KeyValueStore } from "./kv-store";

export class AgencySsoVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgencySsoVerificationError";
  }
}

/** 外部連携API仕様書12章のJWTクレームのうち、SSOログインに必要な項目。 */
export interface AgencySsoClaims {
  externalId: string;
  jti: string;
  roleLevel?: number;
  roleLabel?: string;
  agencyName?: string;
  contactName?: string;
  contactEmail?: string;
  actorId?: string;
  actorName?: string;
  actorEmail?: string;
  clientKey?: string;
  clientName?: string;
}

export interface AgencySsoVerifierOptions {
  /** 期待するiss。通常 "https://sengoku-ai.com"。 */
  issuer: string;
  /** sengoku-ai.com側でこの連携先向けに発行されたaud値。 */
  audience: string;
  /**
   * JWKSの取得元。本番ではJWKS URL文字列 (例: "https://sengoku-ai.com/api/sso/jwks.php")。
   * テストではjose.createLocalJWKSet()等で作った検証関数を直接注入できる。
   */
  jwks: string | JWTVerifyGetKey;
  /** exp/iatの時刻ずれ許容(秒)。デフォルト5秒。 */
  clockToleranceSeconds?: number;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/**
 * 戦国経済圏代理店システム(sengoku-ai.com)が発行するSSO用JWTを検証する
 * (外部連携API仕様書12章)。RS256署名をJWKS(kid一致)で検証し、iss/aud/exp/iatを
 * 確認したうえで、jtiの再利用(リプレイ)を拒否する(仕様書推奨事項)。
 *
 * JWTの有効期限は発行から60秒しかないため(仕様書記載)、jtiの使用済みマークは
 * KVストアにTTL付きで保存する方式とし、専用テーブルは持たない。
 */
export class AgencySsoVerifier {
  private readonly jwks: JWTVerifyGetKey;

  constructor(
    private readonly kv: KeyValueStore,
    private readonly options: AgencySsoVerifierOptions,
  ) {
    this.jwks = typeof options.jwks === "string" ? createRemoteJWKSet(new URL(options.jwks)) : options.jwks;
  }

  async verify(token: string): Promise<AgencySsoClaims> {
    let payload: Record<string, unknown>;
    try {
      const result = await jwtVerify(token, this.jwks, {
        issuer: this.options.issuer,
        audience: this.options.audience,
        algorithms: ["RS256"],
        clockTolerance: this.options.clockToleranceSeconds ?? 5,
      });
      payload = result.payload;
    } catch (err) {
      throw new AgencySsoVerificationError(
        `SSO token verification failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const externalId = readString(payload.external_id) ?? readString(payload.sub);
    const jti = readString(payload.jti);
    if (!externalId || !jti) {
      throw new AgencySsoVerificationError("SSO token is missing external_id/sub or jti");
    }

    await this.assertJtiNotReused(jti, readNumber(payload.exp));

    return {
      externalId,
      jti,
      roleLevel: readNumber(payload.role_level),
      roleLabel: readString(payload.role_label),
      agencyName: readString(payload.agency_name),
      contactName: readString(payload.contact_name),
      contactEmail: readString(payload.contact_email),
      actorId: readString(payload.actor_id),
      actorName: readString(payload.actor_name),
      actorEmail: readString(payload.actor_email),
      clientKey: readString(payload.client_key),
      clientName: readString(payload.client_name),
    };
  }

  /** jtiの再利用(同一JWTの使い回し)を1回限りに制限する。 */
  private async assertJtiNotReused(jti: string, exp: number | undefined): Promise<void> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    // 有効期限切れ直後の再送も一定期間拒否できるよう、最低60秒はキーを保持する。
    const ttlSeconds = Math.max(exp ? exp - nowSeconds : 0, 60);
    const count = await this.kv.incr(`agency-sso:jti:${jti}`, ttlSeconds);
    if (count > 1) {
      throw new AgencySsoVerificationError("SSO token has already been used (jti replay)");
    }
  }
}
