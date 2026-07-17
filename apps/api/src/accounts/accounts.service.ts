import { BadRequestException, Inject, Injectable } from "@nestjs/common";
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
    if (existing) return existing.account;

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
}
