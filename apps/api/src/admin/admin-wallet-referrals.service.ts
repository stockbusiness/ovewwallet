import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { generateId, type PrismaClient, type WalletReferral } from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import { OutboxService } from "../outbox/outbox.service";
import { assertValidReferralTransition } from "../referrals/referral-state-machine";

/**
 * 代理店紹介トークン受け入れの確認画面 (実装指示書 v1.0 14章「管理画面の確認機能」)。
 * 一覧・詳細の確認に加え、管理者による後付けの紐付け (14.3章) を提供する。
 */
// 紹介トークン全文・そのハッシュ・セッションCookieのハッシュは管理画面へ一切出さない
// (実装指示書14.1章)。IP/UAは元から一方向ハッシュのみ保存しているため、そのまま返してよい。
const SAFE_SELECT = {
  id: true,
  walletUserId: true,
  commonUserId: true,
  agencyId: true,
  status: true,
  source: true,
  capturedAt: true,
  expiresAt: true,
  usedAt: true,
  registeredAt: true,
  confirmedAt: true,
  rejectedAt: true,
  revokedAt: true,
  lastErrorCode: true,
  lastErrorMessage: true,
  createdIpHash: true,
  userAgentHash: true,
  reason: true,
  createdAt: true,
  updatedAt: true,
  account: { select: { id: true, accountCode: true, displayName: true } },
  benefits: true,
} as const;

@Injectable()
export class AdminWalletReferralsService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly outbox: OutboxService,
  ) {}

  async list(params: { status?: string; limit?: number }): Promise<unknown> {
    return this.db.walletReferral.findMany({
      where: params.status ? { status: params.status as never } : undefined,
      orderBy: { createdAt: "desc" },
      take: Math.min(params.limit ?? 100, 500),
      select: SAFE_SELECT,
    });
  }

  async detail(id: string): Promise<unknown> {
    const referral = await this.db.walletReferral.findUnique({ where: { id }, select: SAFE_SELECT });
    if (!referral) throw new NotFoundException("wallet referral not found");
    return referral;
  }

  /**
   * 紹介URLは踏まれたのに登録へ紐付かなかった紹介を、管理者が後からORIアカウントへ
   * 紐付ける。
   *
   * 紹介の紐付けは**新規アカウント作成時にしか起きない** (`AuthService`が
   * `onNewAccountCreated`でのみ`attachToNewAccount`を呼ぶ)。そのため
   * 「先にウォレットへ登録してしまった人が、後から代理店の紹介URLを踏んだ」場合は
   * 紹介が成立せず、代理店の成果にならない。退会させても救済にならない
   * (退会済みのidentityでは再登録できない、`AccountRegistrationService`)。
   * その個別救済のための操作。
   *
   * 状態は`CONFIRMED`ではなく`PENDING`にし、確定自体は通常と同じ経路
   * (Outbox → `AgencyReferralOutboxHandler` → 代理店システムの
   * `POST /api/referrals/confirm`) に委ねる。**成果を認めるかどうかの正本は
   * 代理店システム側**にあり、ウォレットの管理画面から確定済みにしてしまうと
   * 連携先の記録と食い違うため。
   */
  async attachManually(params: {
    id: string;
    account: string;
    adminId: string;
    reason: string;
  }): Promise<unknown> {
    const referral = await this.requireReferral(params.id);

    if (referral.walletUserId) {
      throw new ConflictException("この紹介は既にORIアカウントへ紐付いています");
    }
    // 救済するのは CAPTURED (登録に使われないまま残っている) だけ。確定済み・否認済み・
    // 期限切れは終端状態で、そこから復帰させると状態遷移の不変条件
    // (`referral-state-machine.ts`「終端状態からは一切遷移できない」) を崩す。
    //
    // 実運用ではこれで足りる。status が EXPIRED になるのは `resolvePendingSession` が
    // 期限後に呼ばれたときだけで、単に猶予 (既定30日) を過ぎただけの行は CAPTURED の
    // まま残るため、そちらは紐付けできる。
    if (referral.status !== "CAPTURED") {
      throw new BadRequestException(
        `状態が ${referral.status} の紹介は手動で紐付けできません (CAPTURED のみ)`,
      );
    }
    // confirm送信には代理店システムが発行した紹介セッションが要る
    // (`ConfirmReferralUseCase.attemptConfirm`)。無いまま紐付けても連携先へ伝わらず、
    // PENDINGのまま残るだけなので、ここで止めて理由を示す。
    if (!referral.referralSessionKey || !referral.canonicalReferralTokenEncrypted) {
      throw new BadRequestException(
        "この紹介には代理店システム側の紹介セッションが紐付いていないため、確定を通知できません",
      );
    }

    const account = await this.resolveAccount(params.account);

    // 1アカウントにつき有効な紹介関係は1件だけ (schemaの@@unique([walletUserId]))。
    // DB制約に任せると一意制約違反という分かりにくい失敗になるため、先に確認する。
    const existing = await this.db.walletReferral.findUnique({
      where: { walletUserId: account.id },
    });
    if (existing) {
      throw new ConflictException(
        `ORIアカウント "${account.accountCode}" には既に紹介 (${existing.id}) が紐付いています`,
      );
    }

    assertValidReferralTransition(referral.status, "PENDING");
    const now = new Date();

    return this.db.$transaction(async (tx) => {
      const updated = await tx.walletReferral.update({
        where: { id: referral.id },
        data: {
          walletUserId: account.id,
          status: "PENDING",
          // schemaが定めている値。通常フローの`invite_url`と区別できるようにする。
          source: "admin",
          registeredAt: now,
          usedAt: now,
          reason: params.reason,
        },
        select: SAFE_SELECT,
      });

      // 確定の送信は通常フローと同じOutboxに乗せる。冪等キーも同じにしてあるので、
      // 何らかの理由で既にイベントが積まれていれば二重にはならない。
      await this.outbox.enqueue(tx, {
        eventType: "wallet.referral.registered",
        aggregateType: "wallet_referral",
        aggregateId: referral.id,
        destinationService: "AGENCY_SYSTEM",
        idempotencyKey: `WALLET_REFERRAL_REGISTERED:${referral.id}`,
        // ハンドラは本文を使わず`aggregateId`からDBを読み直すため、紹介トークンの
        // 平文はここに載せない (載せる必要が無いものを増やさない)。
        payload: {
          request_id: generateId(),
          event_type: "wallet.referral.registered",
          wallet_user_id: account.id,
          referred_at: referral.capturedAt.toISOString(),
          registration_completed_at: now.toISOString(),
          source: "admin_manual_attach",
          attached_by_admin_id: params.adminId,
        },
      });

      await tx.auditLog.create({
        data: {
          id: generateId(),
          actorType: "ADMIN",
          actorId: params.adminId,
          actionType: "WALLET_REFERRAL_ATTACHED_MANUALLY",
          targetType: "wallet_referral",
          targetId: referral.id,
          result: "SUCCESS",
          reason: params.reason,
          beforeData: { status: referral.status, walletUserId: null, source: referral.source },
          afterData: { status: "PENDING", walletUserId: account.id, source: "admin" },
        },
      });

      return updated;
    });
  }

  private async requireReferral(id: string): Promise<WalletReferral> {
    const referral = await this.db.walletReferral.findUnique({ where: { id } });
    if (!referral) throw new NotFoundException("wallet referral not found");
    return referral;
  }

  /** 紐付け先のORIアカウント。コード (ORI-ACC-...) でもIDでも指定できる。 */
  private async resolveAccount(value: string) {
    const account =
      (await this.db.oveAccount.findUnique({ where: { accountCode: value } })) ??
      (await this.db.oveAccount.findUnique({ where: { id: value } }));
    if (!account) {
      throw new NotFoundException(`ORIアカウント "${value}" が見つかりません`);
    }
    if (account.status !== "ACTIVE") {
      throw new BadRequestException(
        `ORIアカウント "${account.accountCode}" は ${account.status} のため紐付けできません`,
      );
    }
    return account;
  }
}
