import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { generateId, type OveAccount, type Prisma, type PrismaClient } from "@ove/database";
import { creditWallet, reverseTransaction } from "@ove/ledger";
import type { CommonEventBody } from "@ove/shared-types";
import { PRISMA } from "../common/prisma.module";
import { isFeatureEnabled } from "../common/feature-flags";
import { AdminApprovalService } from "../admin/admin-approval.service";
import { serializeTransaction } from "../wallets/wallets.service";
import { ReferralsService } from "../referrals/referrals.service";
import { enforceRewardRuleLimits } from "../rewards/reward-rule-limits";

/**
 * `reward.reversed`受信時、原取引の認証済み送信元 (sourceService) と一致しない場合でも
 * 取消を許可するシステム (中央オーケストレーター等) のsystem_key一覧
 * (次期改修指示書P0-4「中央オーケストレーターだけが取消可能な場合は明示的にallowlist化」)。
 * カンマ区切り、既定は空 (=いかなる代理取消も許可しない、最も安全な既定値)。
 */
function getReversalOrchestratorSystemKeys(): Set<string> {
  return new Set(
    (process.env.COMMON_EVENT_REVERSAL_ORCHESTRATOR_SYSTEM_KEYS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

type AccountLookupResult =
  | { status: "not_found" }
  | { status: "ok"; account: OveAccount }
  | { status: "conflict"; accountIds: string[] };

/**
 * 千ノ国 全体統合 共通実装契約 v1.0 6.2章のうち、ウォレットが実際に反応する
 * イベント種別のハンドラ本体。`InboundEventsService`から冪等性を確保された状態
 * (同一event_idの二重実行なし) で1回だけ呼ばれる前提。各ハンドラは失敗時に例外を
 * 投げるだけでよく (Inbox側がFAILED/リトライへ遷移させる)、成功時はレスポンスに
 * 含めてよい結果オブジェクトを返す。
 *
 * 次期改修指示書P0-1: `authenticatedSourceSystemKey`はガード/コントローラが署名鍵から
 * 検証済みの送信元であり、`body.source_system_key`(本文の自己申告値、コントローラで
 * 一致確認済みのため理論上は同じ値になるはずだが)より常にこちらを信頼して使う。
 */
@Injectable()
export class CommonEventHandlersService {
  private readonly logger = new Logger(CommonEventHandlersService.name);

  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly approvals: AdminApprovalService,
    private readonly referrals: ReferralsService,
  ) {}

  async dispatch(eventType: string, body: CommonEventBody, authenticatedSourceSystemKey: string): Promise<unknown> {
    switch (eventType) {
      case "common_user.resolved":
        return this.handleCommonUserResolved(body, authenticatedSourceSystemKey);
      case "common_user.merged":
        return this.handleCommonUserMerged(body);
      case "customer.assignment.changed":
        return this.handleCustomerAssignmentChanged(body, authenticatedSourceSystemKey);
      case "referral.confirmed":
        return this.handleReferralConfirmed(body);
      case "reward.granted":
        return this.handleRewardGranted(body, authenticatedSourceSystemKey);
      case "reward.reversed":
        return this.handleRewardReversed(body, authenticatedSourceSystemKey);
      default:
        // 契約6.2章の必須イベントのうち、ウォレットが反応しないもの (order.*/payment.*/
        // entitlement.*等、正本は他システム) はここに到達する。受信自体は成功として扱い
        // (200)、送信元のOutboxを詰まらせない。監査目的で記録のみ行う。
        return { note: `no handler registered for event_type "${eventType}"; recorded only` };
    }
  }

  /**
   * `common_user_id`でOveAccountを解決する。次期改修指示書P0-5: `common_user_id`は
   * INDEXのみでUNIQUE制約が無いため、`findFirst`で任意の1件を扱わない。0件/1件/2件以上を
   * 明示的に分岐し、2件以上の場合は自動処理せず監査ログへ競合として記録して要レビュー扱いにする。
   */
  private async resolveAccountByCommonUserId(
    commonUserId: string,
    actionType: string,
    authenticatedSourceSystemKey: string,
  ): Promise<AccountLookupResult> {
    const accounts = await this.db.oveAccount.findMany({ where: { commonUserId } });
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

  /**
   * 契約4.1章の本人照合優先順位1.「指定済みcommon_user_idと正当なsystem link」に対応。
   * source_user_id (=ウォレット側のOveAccount.id、common-user-hub.client.tsが
   * external_user_idとして送っている値) でアカウントを特定し、未設定ならcommon_user_id
   * を保存する。既に別のcommon_user_idが設定済みの場合は上書きせず競合として記録する
   * (禁止事項3.2「未検証情報だけで自動的に人物統合しない」)。
   */
  private async handleCommonUserResolved(body: CommonEventBody, authenticatedSourceSystemKey: string) {
    if (!body.common_user_id) throw new BadRequestException("common_user_id is required");
    const sourceUserId = body.source_user_id;
    if (!sourceUserId) return { action: "skipped", reason: "source_user_id not provided" };

    const account = await this.db.oveAccount.findUnique({ where: { id: sourceUserId } });
    if (!account) return { action: "account_not_found", ove_account_id: sourceUserId };

    if (account.commonUserId === body.common_user_id) {
      return { action: "already_linked", ove_account_id: account.id, common_user_id: body.common_user_id };
    }

    if (account.commonUserId && account.commonUserId !== body.common_user_id) {
      await this.db.auditLog.create({
        data: {
          id: generateId(),
          actorType: "EXTERNAL_SERVICE",
          actorId: authenticatedSourceSystemKey,
          actionType: "COMMON_USER_RESOLVED_CONFLICT",
          targetType: "ove_account",
          targetId: account.id,
          result: "FAILURE",
          reason: "既存のcommon_user_idと異なる値を受信 (自動上書きしない)",
          beforeData: { commonUserId: account.commonUserId },
          afterData: { rejectedCommonUserId: body.common_user_id },
        },
      });
      return { action: "conflict_ignored", ove_account_id: account.id };
    }

    await this.db.oveAccount.update({
      where: { id: account.id },
      data: { commonUserId: body.common_user_id, commonUserLinkedAt: new Date() },
    });
    return { action: "linked", ove_account_id: account.id, common_user_id: body.common_user_id };
  }

  /**
   * common_user.merged。統合先(新common_user_id)・統合元(旧common_user_id、
   * metadata.previous_common_user_idで受け取る) の両方に既存Wallet accountが存在する
   * 場合、指示書5.3章「両方にWallet accountが存在する場合は自動統合しない」に従い
   * 自動マージせず、既存の二段階承認フロー (`AdminApprovalService.requestAccountMerge`)
   * へ申請するだけにとどめる。申請者はシステムsentinel値とし、実際の統合実行は
   * 人間の管理者が承認して初めて行われる (`approval_requests.requested_by`は
   * 外部キーではない文字列のため、実在の管理者IDと衝突しない値を使う)。3件以上存在する
   * 場合も全件をレビュー対象とし、どの2件を統合するか自動判断しない。
   */
  private async handleCommonUserMerged(body: CommonEventBody) {
    if (!body.common_user_id) throw new BadRequestException("common_user_id is required");
    const previousCommonUserId = (body.metadata as Record<string, unknown> | null | undefined)?.[
      "previous_common_user_id"
    ];
    if (typeof previousCommonUserId !== "string" || !previousCommonUserId) {
      return { action: "skipped", reason: "metadata.previous_common_user_id not provided" };
    }

    const accounts = await this.db.oveAccount.findMany({
      where: { commonUserId: { in: [body.common_user_id, previousCommonUserId] } },
    });

    if (accounts.length === 0) {
      return { action: "no_local_accounts" };
    }

    if (accounts.length === 1) {
      const account = accounts[0]!;
      if (account.commonUserId !== body.common_user_id) {
        await this.db.oveAccount.update({
          where: { id: account.id },
          data: { commonUserId: body.common_user_id, commonUserLinkedAt: new Date() },
        });
      }
      return { action: "relinked", ove_account_id: account.id };
    }

    // 2件以上 (3件以上も含む) の既存アカウントが対象common_user_idに紐づいていた場合。
    // 統合先はcommon_user_id (新) に既に紐づく方を優先するが、3件以上ある場合は
    // どの2件を統合すべきか自動判断せず、全件を承認申請の対象として明示する。
    const target = accounts.find((a) => a.commonUserId === body.common_user_id) ?? accounts[0]!;
    const others = accounts.filter((a) => a.id !== target.id);
    if (others.length === 0) return { action: "no_merge_needed", ove_account_id: target.id };

    const requestIds: string[] = [];
    for (const source of others) {
      const requestedBy = `system:common_user.merged:${body.event_id}:${source.id}`;
      const request = await this.approvals.requestAccountMerge({
        sourceAccountId: source.id,
        targetAccountId: target.id,
        sourceAccountCode: source.accountCode,
        targetAccountCode: target.accountCode,
        reason: `common_user.merged (event_id=${body.event_id}) 受信によるアカウント統合申請 (対象${accounts.length}件)`,
        requestedBy,
      });
      requestIds.push(request.id);
    }

    return {
      action: "approval_requested",
      approval_request_ids: requestIds,
      target_ove_account_id: target.id,
      source_ove_account_ids: others.map((a) => a.id),
    };
  }

  /**
   * 契約4.2章のassigned_agency_id (現在の顧客担当代理店、変更可能) を更新する。
   * registration_referrer_agency_idは初回のみ設定しロックする (一度設定した値は
   * イベントからの上書きを許可しない)。変更履歴は別テーブルを持たず、既存のAuditLog
   * のbefore/afterで代替する (指示書5.4章「監査・報酬照合のため保持する」)。
   */
  private async handleCustomerAssignmentChanged(body: CommonEventBody, authenticatedSourceSystemKey: string) {
    if (!body.common_user_id) throw new BadRequestException("common_user_id is required");

    const resolved = await this.resolveAccountByCommonUserId(
      body.common_user_id,
      "CUSTOMER_ASSIGNMENT_CHANGED",
      authenticatedSourceSystemKey,
    );
    if (resolved.status === "not_found") return { action: "account_not_found" };
    if (resolved.status === "conflict") {
      return { action: "conflict_requires_review", account_ids: resolved.accountIds };
    }
    const account = resolved.account;

    const data: Prisma.OveAccountUpdateInput = {};
    if (body.assigned_agency_id && body.assigned_agency_id !== account.assignedAgencyId) {
      data.assignedAgencyId = body.assigned_agency_id;
    }
    if (body.registration_referrer_agency_id && !account.registrationReferrerAgencyId) {
      data.registrationReferrerAgencyId = body.registration_referrer_agency_id;
    }

    if (Object.keys(data).length === 0) {
      return { action: "no_change", ove_account_id: account.id };
    }

    await this.db.oveAccount.update({ where: { id: account.id }, data });
    await this.db.auditLog.create({
      data: {
        id: generateId(),
        actorType: "EXTERNAL_SERVICE",
        actorId: authenticatedSourceSystemKey,
        actionType: "CUSTOMER_ASSIGNMENT_CHANGED",
        targetType: "ove_account",
        targetId: account.id,
        result: "SUCCESS",
        beforeData: {
          assignedAgencyId: account.assignedAgencyId,
          registrationReferrerAgencyId: account.registrationReferrerAgencyId,
        },
        afterData: data as unknown as Prisma.InputJsonValue,
        reason: `event_id=${body.event_id}`,
      },
    });

    return { action: "updated", ove_account_id: account.id };
  }

  /** referral.confirmed。`ReferralsService.confirmBenefitFromEvent`へ委譲する (紹介Phase 2)。 */
  private async handleReferralConfirmed(body: CommonEventBody) {
    return this.referrals.confirmBenefitFromEvent({
      referralSessionKey: body.referral_session_key ?? undefined,
      commonUserId: body.common_user_id ?? undefined,
      eventId: body.event_id,
    });
  }

  /**
   * reward.granted。契約の共通本文にamountフィールドが無いため、metadata.amountで
   * 受け取る。次期改修指示書P0-4: 小数・0・負数を明確に拒否し (`Math.trunc`による暗黙の
   * 丸めは行わない)、`reward_rules`の各種上限 (1回上限相当のper_event_limit、日次相当の
   * per_user_limit、月次件数/金額、累計金額) を商品コード単位のルールで検証する。
   * `ENABLE_EXTERNAL_REWARD_TYPES`が無効な間はOVEを動かさず記録のみ行う。
   */
  private async handleRewardGranted(body: CommonEventBody, authenticatedSourceSystemKey: string) {
    if (!isFeatureEnabled("ENABLE_EXTERNAL_REWARD_TYPES")) {
      return { action: "skipped", reason: "ENABLE_EXTERNAL_REWARD_TYPES is disabled" };
    }
    if (!body.common_user_id) throw new BadRequestException("common_user_id is required");

    const resolved = await this.resolveAccountByCommonUserId(
      body.common_user_id,
      "REWARD_GRANTED",
      authenticatedSourceSystemKey,
    );
    if (resolved.status === "not_found") {
      throw new NotFoundException(`no OVE account linked to common_user_id "${body.common_user_id}"`);
    }
    if (resolved.status === "conflict") {
      // 複数アカウントに紐づく状態でOVEを動かすと誤付与になりうるため、確実に拒否する。
      throw new BadRequestException(
        `common_user_id "${body.common_user_id}" is linked to multiple OVE accounts; refusing to grant until reviewed`,
      );
    }
    const account = resolved.account;
    const wallet = await this.db.wallet.findUniqueOrThrow({ where: { oveAccountId: account.id } });

    const metadata = (body.metadata as Record<string, unknown> | null | undefined) ?? {};
    const rawAmount = metadata["amount"];
    const numericAmount = typeof rawAmount === "number" ? rawAmount : Number(rawAmount);
    if (!Number.isInteger(numericAmount) || numericAmount <= 0 || !Number.isSafeInteger(numericAmount)) {
      throw new BadRequestException("metadata.amount must be a positive integer (decimals/zero/negative are rejected)");
    }
    const amount = BigInt(numericAmount);

    // 商品コード単位でreward_rule_codeを導出する (指示書「商品単位上限」に対応)。
    // 複数商品が同一transactionType (COMMON_EVENT_REWARD) を共有するため、rule_code単位で
    // 発行量を分離しないと月次/累計上限が他商品の発行量と混ざってしまう。
    const ruleCode = `COMMON_EVENT_REWARD:${body.product_code ?? "default"}`;
    await enforceRewardRuleLimits(this.db, {
      ruleCode,
      walletId: wallet.id,
      transactionType: "COMMON_EVENT_REWARD",
      eventId: body.event_id,
      amount,
      // product_codeが無いイベント同士は区別しようがないため、productCode指定時のみ
      // 月次/累計集計をJSONパスで絞り込む (未指定時はtransactionType全体で集計)。
      extraWhere: body.product_code
        ? { metadata: { path: ["productCode"], equals: body.product_code } }
        : undefined,
    });

    const transaction = await creditWallet(
      {
        walletId: wallet.id,
        amount,
        transactionType: "COMMON_EVENT_REWARD",
        idempotencyKey: `COMMON_EVENT_REWARD:${body.event_id}`,
        displayName: "共通イベント連携特典",
        description: `source_system_key=${authenticatedSourceSystemKey} product_code=${body.product_code ?? ""}`,
        sourceService: authenticatedSourceSystemKey,
        sourceReferenceId: body.event_id,
        createdByType: "EXTERNAL_SERVICE",
        createdById: authenticatedSourceSystemKey,
        metadata: this.buildAgencyMetadata(body, authenticatedSourceSystemKey),
      },
      this.db,
    );

    return { ove_account_id: account.id, ...serializeTransaction(transaction) };
  }

  /**
   * reward.reversed。対応する原取引は`sourceReferenceId`にmetadata.original_event_id
   * (無ければ本イベントのentitlement_id/order_id) を格納したCOMMON_EVENT_REWARD取引
   * として検索する。台帳の不変性を守るため、既存取引の変更ではなく`reverseTransaction`
   * によるREVERSAL取引の追加で取り消す。次期改修指示書P0-4: 原取引の送信元
   * (sourceService、付与時に認証済みsource_system_keyを記録済み) と本イベントの認証済み
   * 送信元が一致しない場合、`COMMON_EVENT_REVERSAL_ORCHESTRATOR_SYSTEM_KEYS`に明示的に
   * 登録された中央オーケストレーターでない限り拒否する
   * (他システムが作った付与を別システムから取消できないようにする)。
   */
  private async handleRewardReversed(body: CommonEventBody, authenticatedSourceSystemKey: string) {
    if (!isFeatureEnabled("ENABLE_EXTERNAL_REWARD_TYPES")) {
      return { action: "skipped", reason: "ENABLE_EXTERNAL_REWARD_TYPES is disabled" };
    }

    const metadata = (body.metadata as Record<string, unknown> | null | undefined) ?? {};
    const originalReference =
      (typeof metadata["original_event_id"] === "string" ? (metadata["original_event_id"] as string) : undefined) ??
      body.entitlement_id ??
      body.order_id;
    if (!originalReference) {
      throw new BadRequestException("metadata.original_event_id, entitlement_id, or order_id is required");
    }

    const original = await this.db.oveTransaction.findFirst({
      where: {
        transactionType: "COMMON_EVENT_REWARD",
        sourceReferenceId: originalReference,
        status: "COMPLETED",
      },
    });
    if (!original) {
      throw new NotFoundException(`no reversible COMMON_EVENT_REWARD transaction found for "${originalReference}"`);
    }

    const isSameSource = original.sourceService === authenticatedSourceSystemKey;
    const isOrchestrator = getReversalOrchestratorSystemKeys().has(authenticatedSourceSystemKey);
    if (!isSameSource && !isOrchestrator) {
      throw new ForbiddenException(
        `source_system_key "${authenticatedSourceSystemKey}" is not allowed to reverse a grant originally issued by "${original.sourceService}"`,
      );
    }

    const reversal = await reverseTransaction(
      {
        transactionId: original.id,
        reason: `reward.reversed (event_id=${body.event_id})`,
        idempotencyKey: `COMMON_EVENT_REWARD_REVERSAL:${body.event_id}`,
        createdByType: "EXTERNAL_SERVICE",
        createdById: authenticatedSourceSystemKey,
      },
      this.db,
    );

    return serializeTransaction(reversal);
  }

  /** 指示書5.4章の代理店4役等を、台帳(ove_transactions.metadata)へ構造化保存する。 */
  private buildAgencyMetadata(body: CommonEventBody, authenticatedSourceSystemKey: string): Prisma.InputJsonValue {
    return {
      eventId: body.event_id,
      eventType: body.event_type,
      registrationReferrerAgencyId: body.registration_referrer_agency_id ?? null,
      assignedAgencyId: body.assigned_agency_id ?? null,
      salesAgentId: body.sales_agent_id ?? null,
      closingAgentId: body.closing_agent_id ?? null,
      orderId: body.order_id ?? null,
      orderItemId: body.order_item_id ?? null,
      sourceSystemKey: authenticatedSourceSystemKey,
      referralSessionKey: body.referral_session_key ?? null,
      productCode: body.product_code ?? null,
      entitlementId: body.entitlement_id ?? null,
      correlationId: body.correlation_id ?? null,
    };
  }
}
