import { Inject, Injectable } from "@nestjs/common";
import {
  generateId,
  nextDisplayCode,
  ACCOUNT_CODE_COUNTER,
  WALLET_CODE_COUNTER,
  type IdentityType,
  type OveAccount,
  type PrismaClient,
} from "@ove/database";
import { PRISMA } from "../common/prisma.module";

export interface FindOrCreateIdentityParams {
  identityType: IdentityType;
  provider: string;
  providerSubject: string;
  email?: string;
  phone?: string;
  displayName?: string;
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
          afterData: { accountCode, identityType: params.identityType, provider: params.provider },
        },
      });

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
    if (existingLink) return existingLink.account;

    return this.db.$transaction(async (tx) => {
      const accountCode = await nextDisplayCode(tx, ACCOUNT_CODE_COUNTER, "OVE-ACC");
      const account = await tx.oveAccount.create({
        data: { id: generateId(), accountCode, status: "ACTIVE" },
      });

      const walletCode = await nextDisplayCode(tx, WALLET_CODE_COUNTER, "OVE-WLT");
      await tx.wallet.create({
        data: { id: generateId(), oveAccountId: account.id, walletCode, status: "ACTIVE" },
      });

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
