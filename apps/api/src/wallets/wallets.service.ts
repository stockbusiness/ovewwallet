import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { generateId, type PrismaClient } from "@ove/database";
import { getWalletBalance, listWalletTransactions } from "@ove/ledger";
import { PRISMA } from "../common/prisma.module";

@Injectable()
export class WalletsService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  private async requireWalletForAccount(oveAccountId: string) {
    const wallet = await this.db.wallet.findUnique({ where: { oveAccountId } });
    if (!wallet) throw new NotFoundException("wallet not found for this account");
    return wallet;
  }

  async getBalance(oveAccountId: string) {
    const wallet = await this.requireWalletForAccount(oveAccountId);
    const fresh = await getWalletBalance(wallet.id, this.db);
    return {
      ove_account_id: oveAccountId,
      wallet_id: fresh.id,
      wallet_code: fresh.walletCode,
      status: fresh.status,
      available_balance: fresh.availableBalance.toString(),
      pending_balance: fresh.pendingBalance.toString(),
      held_balance: fresh.heldBalance.toString(),
      lifetime_credited: fresh.lifetimeCredited.toString(),
      lifetime_debited: fresh.lifetimeDebited.toString(),
    };
  }

  async listTransactions(oveAccountId: string, limit?: number, before?: string) {
    const wallet = await this.requireWalletForAccount(oveAccountId);
    const rows = await listWalletTransactions(
      wallet.id,
      { limit, before: before ? new Date(before) : undefined },
      this.db,
    );
    return rows.map(serializeTransaction);
  }

  /** 取引詳細画面 (指示書13章) 用。本人のウォレットに属する取引のみ取得できる。 */
  async getTransaction(oveAccountId: string, transactionId: string) {
    const wallet = await this.requireWalletForAccount(oveAccountId);
    const transaction = await this.db.oveTransaction.findFirst({
      where: { id: transactionId, walletId: wallet.id },
    });
    if (!transaction) throw new NotFoundException("transaction not found");
    return serializeTransaction(transaction);
  }

  /**
   * 外部サービス向け残高照会 (開発ガイドライン12章)。任意の oveAccountId ではなく、
   * 認証済みの連携先 (serviceIntegrationId) に紐づく external_user_id だけを起点に解決する
   * ことで、他サービスの利用者を横断的に照会できないようにする。
   */
  async getBalanceForServiceLink(serviceIntegrationId: string, externalUserId: string) {
    const link = await this.db.accountLink.findUnique({
      where: { serviceIntegrationId_externalUserId: { serviceIntegrationId, externalUserId } },
    });
    if (!link || !link.oveAccountId) throw new NotFoundException("no OVE account linked to this external_user_id");
    return this.getBalance(link.oveAccountId);
  }

  /**
   * ウォレット画面の「連携サービス」「OVEを使う」向け。稼働中のサービス連携先を、
   * 本人が連携済みかどうかのフラグ付きで返す。api_key_hash等の機密フィールドは含めない。
   */
  async listLinkedServices(oveAccountId: string) {
    const [integrations, links] = await Promise.all([
      this.db.serviceIntegration.findMany({
        where: { status: "ACTIVE" },
        orderBy: { serviceName: "asc" },
      }),
      this.db.accountLink.findMany({
        where: { oveAccountId, status: "ACTIVE" },
      }),
    ]);
    const linkByServiceId = new Map(links.map((l) => [l.serviceIntegrationId, l]));
    return integrations.map((s) => {
      const link = linkByServiceId.get(s.id);
      return {
        service_code: s.serviceCode,
        service_name: s.serviceName,
        linked: Boolean(link),
        linked_at: link ? link.linkedAt.toISOString() : null,
      };
    });
  }

  /**
   * ウォレットホーム画面「お知らせ」向け。公開中のお知らせを新しい順に返す。
   * 本人の既読状態 (notice_reads) を突き合わせて is_read を付与する
   * (お知らせ自体は全ユーザー共通、既読状態のみアカウント単位)。
   */
  async listPublicNotices(oveAccountId: string) {
    const notices = await this.db.notice.findMany({
      where: { status: "PUBLISHED" },
      orderBy: { publishedAt: "desc" },
      take: 20,
    });
    const reads = await this.db.noticeRead.findMany({
      where: { oveAccountId, noticeId: { in: notices.map((n) => n.id) } },
    });
    const readNoticeIds = new Set(reads.map((r) => r.noticeId));
    return notices.map((n) => ({
      id: n.id,
      title: n.title,
      message: n.message,
      importance: n.importance,
      published_at: n.publishedAt.toISOString(),
      is_read: readNoticeIds.has(n.id),
    }));
  }

  /** お知らせを既読にする (アカウント単位、複数回呼んでも冪等)。 */
  async markNoticeRead(oveAccountId: string, noticeId: string) {
    const notice = await this.db.notice.findUnique({ where: { id: noticeId } });
    if (!notice) throw new NotFoundException("notice not found");

    await this.db.noticeRead.upsert({
      where: { noticeId_oveAccountId: { noticeId, oveAccountId } },
      create: { id: generateId(), noticeId, oveAccountId },
      update: {},
    });
    return { ok: true };
  }

  /**
   * ウォレットホーム画面「保留中残高」の内訳向け。管理者が理由付きで保留した
   * (`WalletHold`, 指示書13章「保留・保留解除」) 現在進行中の保留のみを返す
   * (解除済み・取消済みは含めない)。
   */
  async listActiveHolds(oveAccountId: string) {
    const wallet = await this.requireWalletForAccount(oveAccountId);
    const holds = await this.db.walletHold.findMany({
      where: { walletId: wallet.id, status: "HELD" },
      orderBy: { heldAt: "desc" },
    });
    return holds.map((h) => ({
      id: h.id,
      amount: h.amount.toString(),
      reason: h.reason,
      held_at: h.heldAt.toISOString(),
    }));
  }

  /**
   * 自分の取引履歴CSVエクスポート (docs/transaction-export.md参照)。
   * `GET /me/transactions`(一覧画面用、100件上限)とは別に、全件相当を返す
   * (直近10,000件を上限とし、無制限のフルスキャンは避ける)。
   */
  async exportTransactionsCsv(oveAccountId: string): Promise<string> {
    const wallet = await this.requireWalletForAccount(oveAccountId);
    const transactions = await this.db.oveTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { occurredAt: "desc" },
      take: 10000,
    });

    const header = ["取引コード", "日時", "種別", "方向", "金額", "状態", "取引後残高", "内容"];
    const rows = transactions.map((t) => [
      t.transactionCode,
      t.occurredAt.toISOString(),
      t.transactionType,
      t.direction === "CREDIT" ? "獲得" : "利用",
      t.amount.toString(),
      t.status,
      t.balanceAfter.toString(),
      t.displayName,
    ]);

    // Excel(日本語版)でも文字化けせず開けるよう、UTF-8 BOM付きで返す。
    const BOM = "﻿";
    return BOM + [header, ...rows].map((row) => row.map(csvEscapeField).join(",")).join("\r\n");
  }
}

function csvEscapeField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function serializeTransaction(t: {
  id: string;
  transactionCode: string;
  walletId: string;
  transactionType: string;
  direction: string;
  amount: bigint;
  status: string;
  balanceBefore: bigint;
  balanceAfter: bigint;
  displayName: string;
  description: string | null;
  sourceService?: string | null;
  sourceReferenceId?: string | null;
  relatedTransactionId?: string | null;
  occurredAt: Date;
  completedAt: Date | null;
}) {
  return {
    id: t.id,
    transaction_code: t.transactionCode,
    wallet_id: t.walletId,
    transaction_type: t.transactionType,
    direction: t.direction,
    amount: t.amount.toString(),
    status: t.status,
    balance_before: t.balanceBefore.toString(),
    balance_after: t.balanceAfter.toString(),
    display_name: t.displayName,
    description: t.description,
    source_service: t.sourceService ?? null,
    source_reference_id: t.sourceReferenceId ?? null,
    related_transaction_id: t.relatedTransactionId ?? null,
    occurred_at: t.occurredAt.toISOString(),
    completed_at: t.completedAt ? t.completedAt.toISOString() : null,
  };
}
