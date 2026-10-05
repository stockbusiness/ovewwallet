import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { generateId, type PrismaClient } from "@ove/database";
import {
  CommonUserLinkingService,
  type ResolveCommonUserOutcome,
} from "../accounts/common-user-linking.service";
import { PRISMA } from "../common/prisma.module";

export interface ResolveCommonUserView {
  outcome: ResolveCommonUserOutcome["outcome"];
  /** 画面にそのまま出す説明。何が起きたかと、次にやることを含める。 */
  message: string;
  /** 解決された共通ID。未解決なら null。 */
  commonUserId: string | null;
}

/** 結果ごとの説明文。運用者が次の一手を判断できる粒度で書く。 */
const MESSAGES: Record<ResolveCommonUserOutcome["outcome"], string> = {
  linked: "共通IDを取得し、このアカウントに紐付けました。",
  already_linked: "既に同じ共通IDが紐付いていました。変更はありません。",
  conflict:
    "取得した共通IDが別のアカウントに紐付いています。自動では解決しません。どちらが正しいかを確認のうえ、アカウント統合をご検討ください。",
  not_configured:
    "共通顧客HUBへ問い合わせていません。「共通顧客HUB送信設定」が未入力か、Feature Flag ENABLE_PLATFORM_USER_ID がOFFです。",
  hub_unavailable:
    "共通顧客HUBへ問い合わせましたが、共通IDを取得できませんでした。APIキー・system_key が代理店システムの登録値と一致しているか、「代理店連携セットアップ」の接続テストでご確認ください。",
  failed: "処理中にエラーが発生しました。",
};

/**
 * 管理画面からの「共通IDを再解決」。
 *
 * `CommonUserLinkingService.tryLinkCommonUser` は**アカウント新規登録時にしか
 * 呼ばれず**、しかもベストエフォートで失敗しても登録は成功する。そのため
 * 共通顧客HUBの設定が未投入・誤設定だった期間に作られたアカウントは
 * `common_user_id` が空のまま固定され、**あとから解決し直す手段が無かった**。
 *
 * common_user_id が無いと `entitlement.granted` が404になり、カード受取も
 * 確定API手前で止まる。実運用で詰まったため、手動で解決し直せるようにする。
 */
@Injectable()
export class AdminCommonUserResolveService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly linking: CommonUserLinkingService,
  ) {}

  async run(accountId: string, adminId: string, reason: string): Promise<ResolveCommonUserView> {
    const account = await this.db.oveAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new NotFoundException(`account ${accountId} not found`);

    const before = account.commonUserId;
    const result = await this.linking.resolveAndLink(account, "ADMIN", adminId);

    const commonUserId = "commonUserId" in result ? result.commonUserId : null;
    const message =
      result.outcome === "failed" ? `${MESSAGES.failed} ${result.message}` : MESSAGES[result.outcome];

    // 外部へ問い合わせて本人紐付けを変える操作なので、誰がいつ実行したかを残す。
    await this.db.auditLog.create({
      data: {
        id: generateId(),
        actorType: "ADMIN",
        actorId: adminId,
        actionType: "COMMON_USER_RESOLVE_REQUESTED",
        targetType: "ove_account",
        targetId: accountId,
        result: result.outcome === "linked" || result.outcome === "already_linked" ? "SUCCESS" : "FAILURE",
        reason,
        beforeData: { commonUserId: before },
        afterData: { outcome: result.outcome, commonUserId },
      },
    });

    return { outcome: result.outcome, message, commonUserId };
  }
}
