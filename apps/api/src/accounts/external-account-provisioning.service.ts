import { Inject, Injectable } from "@nestjs/common";
import {
  generateId,
  nextDisplayCode,
  Prisma,
  ACCOUNT_CODE_COUNTER,
  WALLET_CODE_COUNTER,
  type OveAccount,
  type PrismaClient,
} from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import { AccountRepository } from "./account.repository";

/**
 * リファクタリング指示書 Phase 2: `AccountsService`から分離した外部サービス
 * 連携 (account_links) からの自動プロビジョニング責務。
 */
@Injectable()
export class ExternalAccountProvisioningService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly accountRepository: AccountRepository,
  ) {}

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

    try {
      return await this.db.$transaction(async (tx) => {
        const accountCode = await nextDisplayCode(tx, ACCOUNT_CODE_COUNTER, "OVE-ACC");
        const account = await this.accountRepository.create(tx, { id: generateId(), accountCode, status: "ACTIVE" });

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
    } catch (error) {
      // モジュール化後レビュー対応 P1-4: 同一(serviceIntegrationId, externalUserId)への
      // 同時初回付与リクエストは、両方とも「未連携」判定を通過した後にaccount_linksの
      // 一意制約で片方が失敗しうる。再検索して先に作成された側のアカウントを返す
      // (500を返して初回付与自体を失敗させない)。
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const race = await this.db.accountLink.findUnique({
          where: {
            serviceIntegrationId_externalUserId: {
              serviceIntegrationId: params.serviceIntegrationId,
              externalUserId: params.externalUserId,
            },
          },
          include: { account: true },
        });
        if (race?.account) return race.account;
      }
      throw error;
    }
  }
}
