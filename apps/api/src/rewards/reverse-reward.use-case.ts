import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { type CreatedByType, type OveTransaction, type PrismaClient, type TransactionType } from "@ove/database";
import { reverseTransaction } from "@ove/ledger";
import { PRISMA } from "../common/prisma.module";

export interface ReverseRewardParams {
  transactionType: TransactionType;
  /** 原取引を`sourceReferenceId`で検索するための参照値 (例: 共通イベントのevent_id)。 */
  originalReference: string;
  reason: string;
  idempotencyKey: string;
  createdByType: CreatedByType;
  createdById?: string;
  /**
   * 認可判定は呼び出し元固有のポリシーのため (例: 共通イベント経由のみ
   * オーケストレーターallowlistを考慮する)、原取引を渡して呼び出し元に判定させる。
   * `false`を返すと`ForbiddenException`を投げる。
   */
  isAuthorized: (original: OveTransaction) => boolean;
  unauthorizedMessage: (original: OveTransaction) => string;
}

/**
 * リファクタリング指示書 Phase 6: 付与の取消 (`GrantRewardUseCase`とは分離)。
 * 現状は共通イベントInbox経由 (`RewardReversedHandler`) のみが利用する
 * 「参照値から原取引を検索し、認可を確認してからreverseTransactionする」パターンを
 * 切り出したもの。管理画面の`admin.service.ts#reverse` (取引IDを直接指定する信頼済み
 * 操作、認可確認自体が不要) とは性質が異なるため対象外とする。
 */
@Injectable()
export class ReverseRewardUseCase {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async execute(params: ReverseRewardParams): Promise<OveTransaction> {
    const original = await this.db.oveTransaction.findFirst({
      where: {
        transactionType: params.transactionType,
        sourceReferenceId: params.originalReference,
        status: "COMPLETED",
      },
    });
    if (!original) {
      throw new NotFoundException(
        `no reversible ${params.transactionType} transaction found for "${params.originalReference}"`,
      );
    }
    if (!params.isAuthorized(original)) {
      throw new ForbiddenException(params.unauthorizedMessage(original));
    }

    return reverseTransaction(
      {
        transactionId: original.id,
        reason: params.reason,
        idempotencyKey: params.idempotencyKey,
        createdByType: params.createdByType,
        createdById: params.createdById,
      },
      this.db,
    );
  }
}
