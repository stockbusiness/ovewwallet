import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
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
import { CommonUserLinkingService } from "./common-user-linking.service";

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
  /**
   * 既存ユーザーの一括移行 (`AdminMigrationService`) 等、大量のレコードを
   * ループ処理する呼び出し元向け。trueの場合、共通顧客HUBへのcommon_user_id
   * 解決 (`CommonUserHubClient.resolve`) を呼ばない。移行データの解決は
   * 別途「HUB突合バッチ」(既存データ移行、未実装) で一括処理する想定であり、
   * 個々の行ごとに外部APIへ同期呼び出しするとバルク移行の速度・相手サービスへの
   * 負荷に影響するため。既定はfalse (通常のログイン/新規登録では解決する)。
   */
  skipCommonUserHubLink?: boolean;
}

/**
 * リファクタリング指示書 Phase 2: `AccountsService`から分離した新規アカウント
 * 登録責務 (Identity検索・OVEアカウント作成・Identity作成・Wallet作成・
 * ACCOUNT_CREATED監査・新規作成フック)。
 */
@Injectable()
export class AccountRegistrationService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly commonUserLinking: CommonUserLinkingService,
  ) {}

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

    const createdAccount = await this.db.$transaction(async (tx) => {
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

    // 外部HTTP呼び出しをDBトランザクション内に含めない (接続保持・タイムアウトを
    // 避けるため)。ベストエフォートのため失敗しても登録自体は成功済みのまま返す。
    if (!params.skipCommonUserHubLink) {
      await this.commonUserLinking.tryLinkCommonUser(createdAccount);
    }
    return createdAccount;
  }
}
