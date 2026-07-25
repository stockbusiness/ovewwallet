import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { generateId, type Prisma, type PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import { AccountRepository } from "./account.repository";

export type LinkCommonUserAction = "already_linked" | "conflict_requires_review" | "linked";

export interface LinkCommonUserResult {
  action: LinkCommonUserAction;
  oveAccountId: string;
  commonUserId?: string;
}

export interface LinkCommonUserParams {
  accountId: string;
  commonUserId: string;
  actorType: "SYSTEM" | "EXTERNAL_SERVICE";
  actorId?: string;
  /** AuditLogのreasonに残す追加コンテキスト (例: `event_id=...`)。 */
  reasonContext?: string;
}

export type RelinkAfterMergeAction = "relinked" | "relink_conflict_requires_review";

export interface RelinkAfterMergeResult {
  action: RelinkAfterMergeAction;
  oveAccountId: string;
}

export interface RelinkAfterMergeParams {
  accountId: string;
  expectedPreviousCommonUserId: string;
  newCommonUserId: string;
  actorType: "SYSTEM" | "EXTERNAL_SERVICE";
  actorId?: string;
  reasonContext?: string;
}

/**
 * 追加整合性対策 P0-1: `common_user_id`の同時設定競合を防ぐ共通UseCase。
 * `CommonUserResolvedHandler` (共通イベント経由) と `CommonUserLinkingService`
 * (HUB resolve直後のベストエフォート経路) の両方から使い、競合時の挙動
 * (`conflict_requires_review`・AuditLog記録) を1箇所に揃える。
 *
 * 「他アカウントに既に設定済みでないか事前確認してから保存する」という
 * check-then-actでは、異なる2アカウントへの同時設定リクエストが両方とも
 * 事前確認を通過しうる (TOCTOU)。`common_user_id`にDB UNIQUE制約は付けない
 * (複数アカウントが同じ値を持つ状態を検出して要レビューにする既存の防御的設計
 * `CommonEventAccountResolver`・P0-5回帰テストと両立させるため)。代わりに
 * `AccountRepository.lockByCommonUserId` (PostgreSQL advisory lock) で
 * 同じcommon_user_idへの並行呼び出しをトランザクション内で直列化し、ロック後に
 * 権威ある再確認を行うことでTOCTOUを閉じる。
 */
@Injectable()
export class CommonUserLinkingUseCase {
  private readonly logger = new Logger(CommonUserLinkingUseCase.name);

  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly accountRepository: AccountRepository,
  ) {}

  async link(params: LinkCommonUserParams): Promise<LinkCommonUserResult> {
    return this.db.$transaction(async (tx) => {
      // common_user_id単位のadvisory lockを取得してから全ての再確認を行う。
      // 異なるcommon_user_id同士は互いにブロックしないため、通常時の並行性は
      // ほぼ損なわれない。
      await this.accountRepository.lockByCommonUserId(params.commonUserId, tx);

      // 呼び出し元 (`CommonUserResolvedHandler`/`CommonUserLinkingService`) は
      // いずれも呼び出し前に対象アカウントの存在を確認済みのため、ここでの未検出は
      // 想定外 (呼び出し元の実装ミスとして扱い、conflictへ丸めずthrowする)。
      const account = await this.accountRepository.findById(params.accountId, tx);
      if (!account) {
        throw new NotFoundException(`account ${params.accountId} not found`);
      }

      if (account.commonUserId === params.commonUserId) {
        return { action: "already_linked", oveAccountId: account.id, commonUserId: params.commonUserId };
      }

      if (account.commonUserId && account.commonUserId !== params.commonUserId) {
        await this.recordConflict(
          tx,
          params,
          "対象アカウントに既に別のcommon_user_idが設定済みのため上書きしない",
          { existingCommonUserId: account.commonUserId },
        );
        return { action: "conflict_requires_review", oveAccountId: account.id };
      }

      // advisory lock取得後のため、この再確認が権威ある競合判定になる
      // (先に同じロックを取った側が既にUPDATEを終えて保持しているか、これから
      // 保持する値をここで確実に見られる)。
      const conflicting = await this.accountRepository.findConflictingCommonUserLinks(
        params.commonUserId,
        account.id,
        tx,
      );
      if (conflicting.length > 0) {
        await this.recordConflict(
          tx,
          params,
          `common_user_id "${params.commonUserId}" は既に他のOVEアカウントに設定済みのため自動設定しない`,
          { conflictingAccountIds: conflicting.map((a) => a.id) },
        );
        return { action: "conflict_requires_review", oveAccountId: account.id };
      }

      await this.accountRepository.linkCommonUser(account.id, params.commonUserId, tx);
      return { action: "linked", oveAccountId: account.id, commonUserId: params.commonUserId };
    });
  }

  /**
   * PR #1最終修正: `common_user.merged`受信時、旧`common_user_id`を持つローカルアカウントが
   * 1件だけ存在する場合の再紐づけ専用経路。`link()`は「対象アカウントに既に別の
   * common_user_idが設定済み = 競合」として扱うため、旧IDから新IDへの正当な移行を
   * 弾いてしまう (このメソッドが無かった場合の回帰)。旧ID・新ID両方のadvisory lockを
   * `Array.sort()`した昇順で取得することで、逆順で同時に処理される2つのmergeイベント
   * 同士がデッドロックしない。
   */
  async relinkAfterMerge(params: RelinkAfterMergeParams): Promise<RelinkAfterMergeResult> {
    return this.db.$transaction(async (tx) => {
      const lockIds = [params.expectedPreviousCommonUserId, params.newCommonUserId].sort();
      for (const id of lockIds) {
        await this.accountRepository.lockByCommonUserId(id, tx);
      }

      const account = await this.accountRepository.findById(params.accountId, tx);
      if (!account) {
        throw new NotFoundException(`account ${params.accountId} not found`);
      }

      // 冪等: 同じmergeイベントの再送で既に新IDへ移行済みなら成功として扱う。
      if (account.commonUserId === params.newCommonUserId) {
        return { action: "relinked", oveAccountId: account.id };
      }

      if (
        params.expectedPreviousCommonUserId === params.newCommonUserId ||
        account.commonUserId !== params.expectedPreviousCommonUserId
      ) {
        await this.recordMergeConflict(tx, params, account.commonUserId, [], "現在のcommon_user_idが期待する旧IDと一致しない");
        return { action: "relink_conflict_requires_review", oveAccountId: account.id };
      }

      // advisory lock取得後のため、この再確認が権威ある競合判定になる。
      const conflicting = await this.accountRepository.findConflictingCommonUserLinks(
        params.newCommonUserId,
        account.id,
        tx,
      );
      if (conflicting.length > 0) {
        await this.recordMergeConflict(
          tx,
          params,
          account.commonUserId,
          conflicting.map((a) => a.id),
          `新common_user_id "${params.newCommonUserId}" は既に他のOVEアカウントに設定済みのため自動更新しない`,
        );
        return { action: "relink_conflict_requires_review", oveAccountId: account.id };
      }

      await this.accountRepository.linkCommonUser(account.id, params.newCommonUserId, tx);
      await tx.auditLog.create({
        data: {
          id: generateId(),
          actorType: params.actorType,
          actorId: params.actorId,
          actionType: "COMMON_USER_MERGED_RELINKED",
          targetType: "ove_account",
          targetId: account.id,
          result: "SUCCESS",
          reason: params.reasonContext,
          beforeData: { commonUserId: params.expectedPreviousCommonUserId } as unknown as Prisma.InputJsonValue,
          afterData: { commonUserId: params.newCommonUserId } as unknown as Prisma.InputJsonValue,
        },
      });
      return { action: "relinked", oveAccountId: account.id };
    });
  }

  private async recordMergeConflict(
    tx: Prisma.TransactionClient,
    params: RelinkAfterMergeParams,
    actualCommonUserId: string | null,
    conflictingAccountIds: string[],
    reason: string,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        id: generateId(),
        actorType: params.actorType,
        actorId: params.actorId,
        actionType: "COMMON_USER_MERGED_RELINK_CONFLICT",
        targetType: "ove_account",
        targetId: params.accountId,
        result: "FAILURE",
        reason: params.reasonContext ? `${reason} (${params.reasonContext})` : reason,
        afterData: {
          expectedPreviousCommonUserId: params.expectedPreviousCommonUserId,
          actualCommonUserId,
          newCommonUserId: params.newCommonUserId,
          conflictingAccountIds,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    this.logger.warn(
      `common_user.merged relink conflict for account ${params.accountId}: ${reason} (expectedPrevious=${params.expectedPreviousCommonUserId}, new=${params.newCommonUserId})`,
    );
  }

  private async recordConflict(
    tx: Prisma.TransactionClient,
    params: LinkCommonUserParams,
    reason: string,
    afterDataExtra: Record<string, unknown>,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        id: generateId(),
        actorType: params.actorType,
        actorId: params.actorId,
        actionType: "COMMON_USER_RESOLVED_CONFLICT",
        targetType: "ove_account",
        targetId: params.accountId,
        result: "FAILURE",
        reason: params.reasonContext ? `${reason} (${params.reasonContext})` : reason,
        afterData: {
          rejectedCommonUserId: params.commonUserId,
          ...afterDataExtra,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    this.logger.warn(`common_user_id ${params.commonUserId} conflict for account ${params.accountId}: ${reason}`);
  }
}
