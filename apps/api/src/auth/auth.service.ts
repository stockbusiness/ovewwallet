import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import {
  EmailOtpService,
  OtpVerificationError,
  SengokuSsoService,
  MockLineAuthVerifier,
  AgencySsoVerifier,
  issueSession,
  hashSessionToken,
  type KeyValueStore,
} from "@ove/auth";
import { generateId, type PrismaClient } from "@ove/database";
import { KV_STORE } from "../common/kv-store.module";
import { PRISMA } from "../common/prisma.module";
import { AccountsService } from "../accounts/accounts.service";
import { AgencyService } from "../agency/agency.service";
import { ReferralsService } from "../referrals/referrals.service";

@Injectable()
export class AuthService {
  private readonly emailOtp: EmailOtpService;
  private readonly sengokuSso: SengokuSsoService;
  private readonly lineVerifier = new MockLineAuthVerifier();
  private readonly agencySso: AgencySsoVerifier;

  constructor(
    @Inject(KV_STORE) private readonly kv: KeyValueStore,
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly accounts: AccountsService,
    private readonly agencyService: AgencyService,
    private readonly referrals: ReferralsService,
  ) {
    this.emailOtp = new EmailOtpService(kv);
    this.sengokuSso = new SengokuSsoService(kv);
    // sengoku-ai.com代理店システムのSSO(外部連携API仕様書12章)。
    // SENGOKU_AI_SSO_AUDIENCE未設定時は実在しないプレースホルダー値を使い、
    // (起動時にエラーにするのではなく)実際のJWT検証が必ず失敗する安全側の
    // デフォルトにする。
    this.agencySso = new AgencySsoVerifier(kv, {
      issuer: process.env.SENGOKU_AI_SSO_ISSUER || "https://sengoku-ai.com",
      audience: process.env.SENGOKU_AI_SSO_AUDIENCE || "unconfigured-sengoku-ai-sso-audience",
      jwks: process.env.SENGOKU_AI_JWKS_URL || "https://sengoku-ai.com/api/sso/jwks.php",
    });
  }

  async requestEmailOtp(email: string): Promise<{ devCode?: string }> {
    const code = await this.emailOtp.issue(email);
    // 開発環境のみ、コードをレスポンスに含めてメール送信基盤なしで検証できるようにする
    return { devCode: process.env.NODE_ENV !== "production" ? code : undefined };
  }

  async verifyEmailOtpAndLogin(email: string, code: string, termsAccepted?: boolean) {
    let ok: boolean;
    try {
      ok = await this.emailOtp.verify(email, code);
    } catch (err) {
      // コード未発行・期限切れ・試行回数上限は、間違ったコードの場合と同じく401として
      // 扱う (内部実装の詳細を漏らさず、いずれも「認証できない」という結果は同じ)。
      if (err instanceof OtpVerificationError) throw new UnauthorizedException("invalid verification code");
      throw err;
    }
    if (!ok) throw new UnauthorizedException("invalid verification code");

    const account = await this.accounts.findOrCreateByIdentity({
      identityType: "EMAIL",
      provider: "EMAIL",
      providerSubject: email.toLowerCase(),
      email,
      termsAccepted,
    });
    return this.createSessionForAccount(account.id);
  }

  /**
   * `referralCookieToken` は `/invite/{token}` 経由で発行された紹介セッションCookieの値
   * (実装指示書 v1.0)。無効・期限切れ・未指定の場合は通常のログインとして処理を続ける
   * (紹介なしでも登録自体は止めない)。新規アカウント作成時のみ、紹介関係の紐付けを
   * アカウント作成と同一トランザクションで行う。
   */
  async loginWithLineMock(idToken: string, termsAccepted?: boolean, referralCookieToken?: string) {
    const claims = await this.lineVerifier.verifyIdToken(idToken);
    const referral = await this.referrals.resolvePendingSession(referralCookieToken);
    const account = await this.accounts.findOrCreateByIdentity({
      identityType: "LINE",
      provider: "LINE",
      providerSubject: claims.lineUserId,
      email: claims.email,
      termsAccepted,
      onNewAccountCreated: referral
        ? (tx, newAccount) => this.referrals.attachToNewAccount(tx, referral, newAccount, claims.lineUserId)
        : undefined,
    });
    return this.createSessionForAccount(account.id);
  }

  /** 戦国パスポート側 (モック) がSSOコードを発行する。開発・テスト専用エンドポイントで使う。 */
  async issueMockSengokuSsoCode(sengokuMemberId: string): Promise<string> {
    return this.sengokuSso.issueCode(sengokuMemberId);
  }

  async loginWithSengokuSso(code: string, termsAccepted?: boolean) {
    const { sengokuMemberId } = await this.sengokuSso.exchangeCode(code);
    const account = await this.accounts.findOrCreateByIdentity({
      identityType: "PASSKEY",
      provider: "SENGOKU_PASSPORT_SSO",
      providerSubject: sengokuMemberId,
      termsAccepted,
    });
    return this.createSessionForAccount(account.id);
  }

  /**
   * sengoku-ai.com代理店システムのSSO (外部連携API仕様書12章)。
   * RS256+JWKSでJWTを検証し、external_id/subでOVEアカウントを解決してログインさせる。
   */
  async loginWithAgencySso(token: string, termsAccepted?: boolean) {
    const claims = await this.agencySso.verify(token);
    const account = await this.accounts.findOrCreateByIdentity({
      identityType: "SENGOKU_AGENCY",
      provider: "sengoku-ai",
      providerSubject: claims.externalId,
      email: claims.contactEmail,
      displayName: claims.agencyName ?? claims.contactName,
      termsAccepted,
    });
    // account_links (開発ガイドライン4.3章) にexternal_id⇔OVEアカウントの紐付けを
    // 反映する。ServiceIntegrationが未作成(seed未実行等)の場合はスキップし、
    // ログイン自体は失敗させない(セッション発行はAccountIdentityだけで完結する)。
    const serviceIntegrationId = await this.agencyService.getServiceIntegrationId();
    if (serviceIntegrationId) {
      await this.agencyService.linkAccount({
        serviceIntegrationId,
        externalId: claims.externalId,
        oveAccountId: account.id,
        claims: {
          agencyName: claims.agencyName,
          contactName: claims.contactName,
          contactEmail: claims.contactEmail,
          roleLabel: claims.roleLabel,
        },
      });
    }
    return this.createSessionForAccount(account.id);
  }

  async logout(token: string): Promise<void> {
    await this.db.userSession.updateMany({
      where: { sessionTokenHash: hashSessionToken(token), revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: "USER_LOGOUT" },
    });
  }

  private async createSessionForAccount(oveAccountId: string) {
    const issued = issueSession();
    await this.db.userSession.create({
      data: {
        id: generateId(),
        oveAccountId,
        sessionTokenHash: issued.tokenHash,
        expiresAt: issued.expiresAt,
      },
    });
    return { token: issued.token, expiresAt: issued.expiresAt, oveAccountId };
  }
}
