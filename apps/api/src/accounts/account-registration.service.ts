import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import {
  generateId,
  nextDisplayCode,
  Prisma,
  ACCOUNT_CODE_COUNTER,
  WALLET_CODE_COUNTER,
  type IdentityType,
  type OveAccount,
  type PrismaClient,
} from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import { CommonUserLinkingService } from "./common-user-linking.service";
import { LegalDocumentsService } from "../legal/legal-documents.service";
import { AccountRepository } from "./account.repository";
import { anonymizationHashKey, anonymizeSubject } from "./anonymized-identity";

/**
 * OVE利用規約の現行バージョンの既定値。
 *
 * 実際の値は管理画面から編集する`legal_documents`が持つ
 * (`LegalDocumentsService.currentTermsVersion`、docs/legal-documents.md)。
 * ここに残しているのは、文書がまだ入っていないDBでも動くようにするための
 * フォールバックと、既存の呼び出し元との互換のため。
 */
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
    private readonly accountRepository: AccountRepository,
    private readonly legal: LegalDocumentsService,
  ) {}

  /**
   * identityを引く。生の`provider_subject`で見つからなければ、匿名化後のハッシュでも引く。
   *
   * 退会済みアカウントの個人情報は猶予期間の経過後に匿名化され、`provider_subject`は
   * 復元できないハッシュに置き換わる (`docs/account-anonymization.md`)。生の値だけで
   * 引くと匿名化済みの行に当たらず、**退会した利用者が新規ユーザーとして再登録できて
   * しまう** (`docs/account-closure.md`が禁じている経路)。ハッシュでも引くことで、
   * 匿名化後も同一人物の再登録を検出し続ける。
   *
   * ハッシュ鍵が未設定の環境では2段階目を行わない (匿名化自体が実行されないため、
   * 匿名化済みの行が存在しない)。
   */
  private async findIdentity(provider: string, providerSubject: string) {
    const byRawSubject = await this.db.accountIdentity.findUnique({
      where: { provider_providerSubject: { provider, providerSubject } },
      include: { account: true },
    });
    if (byRawSubject) return byRawSubject;

    const hashKey = anonymizationHashKey();
    if (hashKey === null) return null;

    return this.db.accountIdentity.findUnique({
      where: {
        provider_providerSubject: {
          provider,
          providerSubject: anonymizeSubject(providerSubject, hashKey),
        },
      },
      include: { account: true },
    });
  }

  /**
   * identity (LINE / EMAIL / 戦国パスポート等) からOVEアカウントを解決する。
   * 未登録なら「1. ユーザーごとのOVEアカウントを作成する」「2. ウォレットを作成する」
   * を1トランザクションで実行する (指示書3章)。
   */
  async findOrCreateByIdentity(params: FindOrCreateIdentityParams): Promise<OveAccount> {
    const existing = await this.findIdentity(params.provider, params.providerSubject);
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

    // 登録時に記録するバージョンも管理画面の値に合わせる。コード上の定数のままだと、
    // 管理画面でバージョンを上げた直後に登録した人が、登録した瞬間に再同意を
    // 求められることになる。
    const termsVersion = await this.legal.currentTermsVersion();

    let createdAccount: OveAccount;
    try {
      createdAccount = await this.db.$transaction(async (tx) => {
        const accountCode = await nextDisplayCode(tx, ACCOUNT_CODE_COUNTER, "OVE-ACC");
        const account = await this.accountRepository.create(tx, {
          id: generateId(),
          accountCode,
          status: "ACTIVE",
          displayName: params.displayName,
          primaryEmail: params.email,
          primaryPhone: params.phone,
          termsAgreedAt: new Date(),
          termsVersion,
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
              termsVersion,
            },
          },
        });

        if (params.onNewAccountCreated) {
          await params.onNewAccountCreated(tx, account);
        }

        return account;
      });
    } catch (error) {
      // モジュール化後レビュー対応 P1-4: 同一identity (provider+providerSubject) への
      // 同時登録リクエストは、両方とも「未登録」判定を通過した後にaccount_identitiesの
      // 一意制約で片方が失敗しうる。再検索して先に作成された側のアカウントを返す
      // (500を返して登録自体を失敗させない)。
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        // 上と同じ2段階照合を使う (照合の条件が2箇所で食い違わないように)。
        const race = await this.findIdentity(params.provider, params.providerSubject);
        if (race) {
          if (race.account.status === "CLOSED") {
            throw new ForbiddenException("this account has been closed");
          }
          return race.account;
        }
      }
      throw error;
    }

    // 外部HTTP呼び出しをDBトランザクション内に含めない (接続保持・タイムアウトを
    // 避けるため)。ベストエフォートのため失敗しても登録自体は成功済みのまま返す。
    if (!params.skipCommonUserHubLink) {
      await this.commonUserLinking.tryLinkCommonUser(createdAccount);
    }
    return createdAccount;
  }
}
