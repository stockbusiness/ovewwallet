import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import {
  EmailOtpService,
  OtpVerificationError,
  SengokuSsoService,
  MockLineAuthVerifier,
  issueSession,
  hashSessionToken,
  type KeyValueStore,
} from "@ove/auth";
import { generateId, type PrismaClient } from "@ove/database";
import { KV_STORE } from "../common/kv-store.module";
import { PRISMA } from "../common/prisma.module";
import { AccountsService } from "../accounts/accounts.service";

@Injectable()
export class AuthService {
  private readonly emailOtp: EmailOtpService;
  private readonly sengokuSso: SengokuSsoService;
  private readonly lineVerifier = new MockLineAuthVerifier();

  constructor(
    @Inject(KV_STORE) private readonly kv: KeyValueStore,
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly accounts: AccountsService,
  ) {
    this.emailOtp = new EmailOtpService(kv);
    this.sengokuSso = new SengokuSsoService(kv);
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

  async loginWithLineMock(idToken: string, termsAccepted?: boolean) {
    const claims = await this.lineVerifier.verifyIdToken(idToken);
    const account = await this.accounts.findOrCreateByIdentity({
      identityType: "LINE",
      provider: "LINE",
      providerSubject: claims.lineUserId,
      email: claims.email,
      termsAccepted,
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
