import { Inject, Injectable } from "@nestjs/common";
import { generateId, type OveAccount, type PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import { AccountRepository } from "../accounts/account.repository";

export type AccountLookupResult =
  | { status: "not_found" }
  | { status: "ok"; account: OveAccount }
  | { status: "conflict"; accountIds: string[] };

/**
 * リファクタリング指示書 Phase 4: 複数ハンドラ (`customer-assignment-changed`,
 * `reward-granted`) が共有する`common_user_id`→OveAccount解決ロジック。新イベント
 * 追加時にこのファイルを変更する必要はなく、既存ハンドラからimportして使うだけでよい。
 *
 * 次期改修指示書P0-5: `common_user_id`はINDEXのみでUNIQUE制約が無いため、`findFirst`で
 * 任意の1件を扱わない。0件/1件/2件以上を明示的に分岐し、2件以上の場合は自動処理せず
 * 監査ログへ競合として記録して要レビュー扱いにする。
 */
@Injectable()
export class CommonEventAccountResolver {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly accountRepository: AccountRepository,
  ) {}

  async resolveByCommonUserId(
    commonUserId: string,
    actionType: string,
    authenticatedSourceSystemKey: string,
  ): Promise<AccountLookupResult> {
    const accounts = await this.accountRepository.findManyByCommonUserId(commonUserId);
    if (accounts.length === 0) return { status: "not_found" };
    if (accounts.length === 1) return { status: "ok", account: accounts[0]! };

    const accountIds = accounts.map((a) => a.id);
    await this.db.auditLog.create({
      data: {
        id: generateId(),
        actorType: "EXTERNAL_SERVICE",
        actorId: authenticatedSourceSystemKey,
        actionType: `${actionType}_COMMON_USER_ID_CONFLICT`,
        targetType: "ove_account",
        targetId: null,
        result: "FAILURE",
        reason: `common_user_id "${commonUserId}" に紐づくOVEアカウントが${accounts.length}件存在するため自動処理を中止 (要レビュー)`,
        afterData: { commonUserId, accountIds },
      },
    });
    return { status: "conflict", accountIds };
  }
}
