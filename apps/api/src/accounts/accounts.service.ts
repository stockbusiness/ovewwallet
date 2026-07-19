import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  generateId,
  nextDisplayCode,
  ACCOUNT_CODE_COUNTER,
  WALLET_CODE_COUNTER,
  type IdentityType,
  type OveAccount,
  type Prisma,
  type PrismaClient,
} from "@ove/database";
import { PRISMA } from "../common/prisma.module";

/** OVE利用規約の現行バージョン。新規アカウント作成時にこの値を terms_version として記録する。 */
export const CURRENT_TERMS_VERSION = "1.0";

export interface FindOrCreateIdentityParams {
  identityType: IdentityType;
  provider: string;
  providerSubject: string;
  email?: string;
  phone?: string;
  displayName?: string;
  /** 新規アカウント作成時のみ必須 (指示書: 利用規約同意の永続化)。既存アカウントのログインでは不要。 */
  termsAccepted?: boolean;
  /**
   * 新規アカウント作成時のみ、アカウント作成と同一トランザクション内で呼ばれる。
   * 代理店紹介の紐付け (`ReferralsService`) など、アカウント作成に付随する処理を
   * 「作成した場合だけ」実行するためのフック (既存ユーザーのログインでは呼ばれない)。
   */
  onNewAccountCreated?: (tx: Prisma.TransactionClient, account: OveAccount) => Promise<void>;
}

@Injectable()
export class AccountsService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async getById(oveAccountId: string): Promise<OveAccount | null> {
    return this.db.oveAccount.findUnique({ where: { id: oveAccountId } });
  }

  /**
   * identity (LINE / EMAIL / 戦国パスポート等) からOVEアカウントを解決する。
   * 未登録なら「1. ユーザーごとのOVEアカウントを作成する」「2. ウォレットを作成する」
   * を1トランザクションで実行する (指示書3章)。
   */
  async findOrCreateByIdentity(params: FindOrCreateIdentityParams): Promise<OveAccount> {
    const existing = await this.db.accountIdentity.findUnique({
      where: {
        provider_providerSubject: {
          provider: params.provider,
          providerSubject: params.providerSubject,
        },
      },
      include: { account: true },
    });
    if (existing) {
      // 退会済みアカウントへの再ログインは拒否する (docs/account-closure.md参照)。
      // 同じidentityで新規アカウントを再作成することもしない (同一のLINEユーザーID等で
      // 何度も退会/再登録を繰り返す抜け道を作らないため)。
      if (existing.account.status === "CLOSED") {
        throw new ForbiddenException("this account has been closed");
      }
      return existing.account;
    }

    if (!params.termsAccepted) {
      throw new BadRequestException("terms of service agreement is required to create a new account");
    }

    return this.db.$transaction(async (tx) => {
      const accountCode = await nextDisplayCode(tx, ACCOUNT_CODE_COUNTER, "OVE-ACC");
      const account = await tx.oveAccount.create({
        data: {
          id: generateId(),
          accountCode,
          status: "ACTIVE",
          displayName: params.displayName,
          primaryEmail: params.email,
          primaryPhone: params.phone,
          termsAgreedAt: new Date(),
          termsVersion: CURRENT_TERMS_VERSION,
        },
      });

      await tx.accountIdentity.create({
        data: {
          id: generateId(),
          oveAccountId: account.id,
          identityType: params.identityType,
          provider: params.provider,
          providerSubject: params.providerSubject,
          email: params.email,
          phone: params.phone,
          verifiedAt: new Date(),
        },
      });

      const walletCode = await nextDisplayCode(tx, WALLET_CODE_COUNTER, "OVE-WLT");
      await tx.wallet.create({
        data: {
          id: generateId(),
          oveAccountId: account.id,
          walletCode,
          status: "ACTIVE",
        },
      });

      await tx.auditLog.create({
        data: {
          id: generateId(),
          actorType: "SYSTEM",
          actionType: "ACCOUNT_CREATED",
          targetType: "ove_account",
          targetId: account.id,
          result: "SUCCESS",
          afterData: {
            accountCode,
            identityType: params.identityType,
            provider: params.provider,
            termsVersion: CURRENT_TERMS_VERSION,
          },
        },
      });

      if (params.onNewAccountCreated) {
        await params.onNewAccountCreated(tx, account);
      }

      return account;
    });
  }

  /**
   * サービス連携 (account_links) からOVEアカウントを解決する。未連携なら
   * アカウント・ウォレット・連携をまとめて自動作成する (外部APIからの初回付与向け)。
   */
  async findOrCreateByServiceLink(params: {
    serviceIntegrationId: string;
    externalUserId: string;
  }): Promise<OveAccount> {
    const existingLink = await this.db.accountLink.findUnique({
      where: {
        serviceIntegrationId_externalUserId: {
          serviceIntegrationId: params.serviceIntegrationId,
          externalUserId: params.externalUserId,
        },
      },
      include: { account: true },
    });
    if (existingLink?.account) return existingLink.account;

    return this.db.$transaction(async (tx) => {
      const accountCode = await nextDisplayCode(tx, ACCOUNT_CODE_COUNTER, "OVE-ACC");
      const account = await tx.oveAccount.create({
        data: { id: generateId(), accountCode, status: "ACTIVE" },
      });

      const walletCode = await nextDisplayCode(tx, WALLET_CODE_COUNTER, "OVE-WLT");
      await tx.wallet.create({
        data: { id: generateId(), oveAccountId: account.id, walletCode, status: "ACTIVE" },
      });

      if (existingLink) {
        // PENDING (代理店同期等で受信済みだがOVEアカウント未作成) の連携が既にある
        // 場合は、新規作成したアカウントへ昇格させる (重複するaccount_links行を
        // 作らない。serviceIntegrationId+externalUserIdの一意制約に抵触するため)。
        await tx.accountLink.update({
          where: { id: existingLink.id },
          data: { oveAccountId: account.id, status: "ACTIVE", verifiedAt: new Date() },
        });
      } else {
        await tx.accountLink.create({
          data: {
            id: generateId(),
            oveAccountId: account.id,
            serviceIntegrationId: params.serviceIntegrationId,
            externalUserId: params.externalUserId,
            status: "ACTIVE",
            linkMethod: "API_AUTO_PROVISION",
            verifiedAt: new Date(),
          },
        });
      }

      await tx.auditLog.create({
        data: {
          id: generateId(),
          actorType: "EXTERNAL_SERVICE",
          actionType: "ACCOUNT_CREATED",
          targetType: "ove_account",
          targetId: account.id,
          result: "SUCCESS",
          afterData: { accountCode, serviceIntegrationId: params.serviceIntegrationId },
        },
      });

      return account;
    });
  }

  /**
   * ログインデバイス一覧 (docs/login-devices.md参照)。有効なセッションのみ返す
   * (失効済み・期限切れは含めない)。`currentSessionId`と一致する行にはis_currentを立てる。
   */
  async listSessions(oveAccountId: string, currentSessionId: string) {
    const sessions = await this.db.userSession.findMany({
      where: { oveAccountId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { issuedAt: "desc" },
    });

    return sessions.map((s) => ({
      id: s.id,
      device_label: summarizeUserAgent(s.userAgent),
      ip_address: s.ipAddress,
      issued_at: s.issuedAt.toISOString(),
      last_used_at: s.lastUsedAt ? s.lastUsedAt.toISOString() : null,
      is_current: s.id === currentSessionId,
    }));
  }

  /**
   * 本人によるログインデバイスの個別ログアウト。他人のセッションIDを指定しても
   * 404になる (`oveAccountId`でスコープするため)。
   */
  async revokeSession(oveAccountId: string, sessionId: string): Promise<void> {
    const session = await this.db.userSession.findUnique({ where: { id: sessionId } });
    if (!session || session.oveAccountId !== oveAccountId) throw new NotFoundException("session not found");
    if (session.revokedAt) throw new ForbiddenException("session already revoked");

    await this.db.userSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date(), revokeReason: "USER_REVOKED_DEVICE" },
    });
  }

  /**
   * 本人による「この端末以外からすべてログアウト」(docs/login-devices.md参照)。
   * 個別ログアウトと同様、現在のセッション自身は対象外にする (このAPIを呼んだ
   * 本人がその場でログアウトされてしまう混乱を避けるため)。
   */
  async revokeOtherSessions(oveAccountId: string, currentSessionId: string): Promise<{ revoked_count: number }> {
    const result = await this.db.userSession.updateMany({
      where: { oveAccountId, revokedAt: null, id: { not: currentSessionId } },
      data: { revokedAt: new Date(), revokeReason: "USER_REVOKED_ALL_OTHER_DEVICES" },
    });
    return { revoked_count: result.count };
  }

  /**
   * ユーザー本人による退会 (docs/account-closure.md参照)。残高(available/held)が
   * 0でなければ拒否する (使い切ってから退会してもらう、失効ではなく利用を促す方針)。
   * 成功時はアカウントをCLOSEDにし、有効なセッションを全て失効させる。
   */
  async requestClosure(oveAccountId: string): Promise<{ closed: true }> {
    const account = await this.db.oveAccount.findUnique({ where: { id: oveAccountId } });
    if (!account) throw new NotFoundException("account not found");
    if (account.status === "CLOSED") throw new ConflictException("account is already closed");

    const wallet = await this.db.wallet.findUnique({ where: { oveAccountId } });
    if (wallet && (wallet.availableBalance > 0n || wallet.heldBalance > 0n)) {
      throw new BadRequestException("available_balance and held_balance must be zero before closing the account");
    }

    await this.db.$transaction(async (tx) => {
      await tx.oveAccount.update({
        where: { id: oveAccountId },
        data: { status: "CLOSED", closedAt: new Date() },
      });

      await tx.userSession.updateMany({
        where: { oveAccountId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: "USER_ACCOUNT_CLOSURE" },
      });

      await tx.auditLog.create({
        data: {
          id: generateId(),
          actorType: "USER",
          actorId: oveAccountId,
          actionType: "ACCOUNT_CLOSED",
          targetType: "ove_account",
          targetId: oveAccountId,
          result: "SUCCESS",
        },
      });
    });

    return { closed: true };
  }
}

/** User-Agent文字列から画面表示用の簡易ラベルを作る (専用ライブラリは使わない軽量実装)。 */
function summarizeUserAgent(userAgent: string | null): string {
  if (!userAgent) return "不明な端末";

  const os = userAgent.includes("iPhone")
    ? "iPhone"
    : userAgent.includes("iPad")
      ? "iPad"
      : userAgent.includes("Android")
        ? "Android"
        : userAgent.includes("Mac OS X")
          ? "Mac"
          : userAgent.includes("Windows")
            ? "Windows"
            : "不明なOS";

  const browser = userAgent.includes("Edg/")
    ? "Edge"
    : userAgent.includes("Chrome/")
      ? "Chrome"
      : userAgent.includes("CriOS/")
        ? "Chrome"
        : userAgent.includes("Safari/") && !userAgent.includes("Chrome/")
          ? "Safari"
          : userAgent.includes("Firefox/")
            ? "Firefox"
            : "不明なブラウザ";

  return `${os} / ${browser}`;
}
