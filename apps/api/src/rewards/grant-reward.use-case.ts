import { Inject, Injectable } from "@nestjs/common";
import {
  type CreatedByType,
  type OveTransaction,
  type Prisma,
  type PrismaClient,
  type TransactionType,
} from "@ove/database";
import { creditWallet } from "@ove/ledger";
import { PRISMA } from "../common/prisma.module";
import { enforceRewardRuleLimits } from "./reward-rule-limits";

export interface GrantRewardParams {
  oveAccountId: string;
  amount: bigint;
  transactionType: TransactionType;
  idempotencyKey: string;
  displayName: string;
  description?: string;
  sourceService?: string;
  sourceReferenceId?: string;
  createdByType: CreatedByType;
  createdById?: string;
  /** 代理店帰属情報等、呼び出し元固有のmetadata (共通イベント経由のみ使用)。 */
  metadata?: Prisma.InputJsonValue;
  /**
   * `reward_rules`の上限enforcement対象にする場合のみ指定する (指示書「reward rule」
   * 「有効期限」の共通化対象)。未指定ならreward_rulesの検証・有効期限付与を行わない
   * (日次ログインボーナス等、ルール非対象の付与では使わない想定)。
   */
  ruleCode?: string;
  /** monthly/global集計の絞り込み (商品コード単位の上限等)。ruleCode指定時のみ有効。 */
  ruleLimitsExtraWhere?: Prisma.OveTransactionWhereInput;
}

export interface GrantRewardResult {
  oveAccountId: string;
  transaction: OveTransaction;
}

/**
 * リファクタリング指示書 Phase 6: 外部サービスAPI経由 (`RewardsService.grant`) と
 * 共通イベントInbox経由 (`RewardGrantedHandler`) で重複していた「受取人のウォレット解決・
 * 冪等性・reward_rules上限・有効期限計算・台帳付与」を共通化する。
 * サービス単位の上限 (`ServiceIntegration.perRequestAmountLimit`等) や、受取人の
 * 解決方法 (service link vs common_user_id) は送信元ごとに性質が異なるため、
 * このUseCaseの外側 (各呼び出し元) で処理してから`oveAccountId`を渡すこと。
 */
@Injectable()
export class GrantRewardUseCase {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async execute(params: GrantRewardParams): Promise<GrantRewardResult> {
    // 冪等キーが既に処理済みなら、上限チェックより前に既存取引をそのまま返す
    // (再送/リトライは「新規リクエスト」ではないため、上限判定の対象にしない)。
    const existing = await this.db.oveTransaction.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (existing) {
      return { oveAccountId: params.oveAccountId, transaction: existing };
    }

    const wallet = await this.db.wallet.findUniqueOrThrow({ where: { oveAccountId: params.oveAccountId } });

    let expiryDays: number | null = null;
    if (params.ruleCode) {
      const rule = await enforceRewardRuleLimits(this.db, {
        ruleCode: params.ruleCode,
        walletId: wallet.id,
        transactionType: params.transactionType,
        eventId: params.sourceReferenceId ?? params.idempotencyKey,
        amount: params.amount,
        extraWhere: params.ruleLimitsExtraWhere,
      });
      expiryDays = rule?.expiryDays ?? null;
    }

    const transaction = await creditWallet(
      {
        walletId: wallet.id,
        amount: params.amount,
        transactionType: params.transactionType,
        idempotencyKey: params.idempotencyKey,
        displayName: params.displayName,
        description: params.description,
        sourceService: params.sourceService,
        sourceReferenceId: params.sourceReferenceId,
        createdByType: params.createdByType,
        createdById: params.createdById,
        metadata: params.metadata,
        expiresAt: expiryDays ? new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000) : undefined,
      },
      this.db,
    );

    return { oveAccountId: params.oveAccountId, transaction };
  }
}
