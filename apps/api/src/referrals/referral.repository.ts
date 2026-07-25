import { Inject, Injectable } from "@nestjs/common";
import { type Prisma, type PrismaClient, type WalletReferral, type WalletReferralBenefit } from "@ove/database";
import { PRISMA } from "../common/prisma.module";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * リファクタリング指示書 Phase 3: `wallet_referrals`/`wallet_referral_benefits`への
 * Prismaアクセスを集約するリポジトリ。呼び出し元が既に開いているトランザクション
 * (`Prisma.TransactionClient`) を渡せば、その中で実行する (原子性を保つため)。
 * 省略時はモジュール既定の`PrismaClient`を使う。
 */
@Injectable()
export class ReferralRepository {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async findBySessionTokenHash(sessionTokenHash: string, client: Db = this.db): Promise<WalletReferral | null> {
    return client.walletReferral.findUnique({ where: { sessionTokenHash } });
  }

  async findByIdOrThrow(id: string, client: Db = this.db): Promise<WalletReferral> {
    return client.walletReferral.findUniqueOrThrow({ where: { id } });
  }

  async findByWalletUserId(walletUserId: string, client: Db = this.db): Promise<WalletReferral | null> {
    return client.walletReferral.findUnique({ where: { walletUserId } });
  }

  /**
   * `referralSessionKey`はDB一意制約が無い外部由来の値のため、2件以上ヒットする
   * 可能性がある呼び出し元では`findByWalletUserId`等より優先度を下げて使うこと。
   */
  async findFirstByReferralSessionKey(referralSessionKey: string, client: Db = this.db): Promise<WalletReferral | null> {
    return client.walletReferral.findFirst({ where: { referralSessionKey } });
  }

  async create(data: Prisma.WalletReferralCreateInput, client: Db = this.db): Promise<WalletReferral> {
    return client.walletReferral.create({ data });
  }

  async update(
    id: string,
    data: Prisma.WalletReferralUpdateInput,
    client: Db = this.db,
  ): Promise<WalletReferral> {
    return client.walletReferral.update({ where: { id }, data });
  }

  /**
   * `resolvePendingSession`からここまでの間に別リクエストが同じ紹介セッションを
   * 先に消費している可能性があるため、`status: "CAPTURED"` / `usedAt: null`を条件に
   * 含めた条件付き更新で排他する (`updateMany`の影響行数で競合検知する)。
   */
  async claimCapturedForAccount(
    tx: Prisma.TransactionClient,
    referralId: string,
    accountId: string,
    now: Date,
  ): Promise<{ count: number }> {
    return tx.walletReferral.updateMany({
      where: { id: referralId, status: "CAPTURED", usedAt: null },
      data: { walletUserId: accountId, status: "PENDING", registeredAt: now, usedAt: now },
    });
  }

  async findBenefitByWalletUserId(walletUserId: string, client: Db = this.db): Promise<WalletReferralBenefit | null> {
    return client.walletReferralBenefit.findUnique({
      where: { benefitType_walletUserId: { benefitType: "REFERRAL_SIGNUP_BONUS", walletUserId } },
    });
  }

  async createBenefit(
    data: Prisma.WalletReferralBenefitUncheckedCreateInput,
    client: Db = this.db,
  ): Promise<WalletReferralBenefit> {
    return client.walletReferralBenefit.create({ data });
  }

  async updateBenefit(
    id: string,
    data: Prisma.WalletReferralBenefitUpdateInput,
    client: Db = this.db,
  ): Promise<WalletReferralBenefit> {
    return client.walletReferralBenefit.update({ where: { id }, data });
  }
}
