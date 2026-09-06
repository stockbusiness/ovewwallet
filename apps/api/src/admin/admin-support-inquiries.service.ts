import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { generateId, Prisma, type PrismaClient, type SupportInquiryStatus } from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import { SupportInquiriesService } from "../support/support-inquiries.service";

/** 一覧に出す件数。増えたら状態で絞る運用にする。 */
const LIST_LIMIT = 100;

/**
 * 管理画面から問い合わせを読み、返信する (docs/support-inquiries.md)。
 *
 * **返信の手段を新しく作っていない。** 既にある個別お知らせ (`notices`の
 * `ove_account_id`が本人のもの) に乗せる。利用者から見れば普段のお知らせと同じ
 * 場所に届くので、返信を読むために新しい画面を覚える必要がない。
 */
@Injectable()
export class AdminSupportInquiriesService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly inquiries: SupportInquiriesService,
  ) {}

  async list(status?: SupportInquiryStatus) {
    const rows = await this.inquiries.listForAdmin({ status, limit: LIST_LIMIT });
    return rows.map(toAdminView);
  }

  async get(id: string) {
    return toAdminView(await this.inquiries.getOrThrow(id));
  }

  /** 状態と運用メモの更新。 */
  async updateStatus(
    id: string,
    params: { status: SupportInquiryStatus; internalNote?: string },
    adminId: string,
  ) {
    const before = await this.inquiries.getOrThrow(id);
    const updated = await this.db.supportInquiry.update({
      where: { id },
      data: {
        status: params.status,
        ...(params.internalNote === undefined ? {} : { internalNote: params.internalNote }),
      },
      include: { account: { select: { accountCode: true, displayName: true, status: true } } },
    });

    await this.db.auditLog.create({
      data: {
        id: generateId(),
        actorType: "ADMIN",
        actorId: adminId,
        actionType: "SUPPORT_INQUIRY_STATUS_CHANGED",
        targetType: "support_inquiry",
        targetId: id,
        result: "SUCCESS",
        beforeData: { status: before.status } as Prisma.InputJsonValue,
        afterData: { status: updated.status } as Prisma.InputJsonValue,
      },
    });

    return toAdminView(updated);
  }

  /**
   * 返信する。本人宛のお知らせを1件作り、問い合わせをANSWEREDにする。
   *
   * 退会済みの相手には返信しない。お知らせを作っても本人はもうログインできず、
   * 「送った」という記録だけが残って対応済みに見えてしまうため。
   */
  async reply(id: string, params: { title: string; message: string }, adminId: string) {
    const inquiry = await this.inquiries.getOrThrow(id);
    if (inquiry.account.status === "CLOSED") {
      throw new BadRequestException("account is closed; the reply would never be read");
    }

    const answeredAt = new Date();
    const updated = await this.db.$transaction(async (tx) => {
      const notice = await tx.notice.create({
        data: {
          id: generateId(),
          title: params.title,
          message: params.message,
          status: "PUBLISHED",
          importance: "NORMAL",
          oveAccountId: inquiry.oveAccountId,
          publishedAt: answeredAt,
          createdBy: adminId,
        },
      });

      const row = await tx.supportInquiry.update({
        where: { id },
        data: {
          status: "ANSWERED",
          replyNoticeId: notice.id,
          answeredAt,
          answeredBy: adminId,
        },
        include: { account: { select: { accountCode: true, displayName: true, status: true } } },
      });

      await tx.auditLog.create({
        data: {
          id: generateId(),
          actorType: "ADMIN",
          actorId: adminId,
          actionType: "SUPPORT_INQUIRY_ANSWERED",
          targetType: "support_inquiry",
          targetId: id,
          result: "SUCCESS",
          afterData: { noticeId: notice.id, title: params.title } as Prisma.InputJsonValue,
        },
      });

      return row;
    });

    return toAdminView(updated);
  }
}

type InquiryWithAccount = Awaited<ReturnType<SupportInquiriesService["getOrThrow"]>> | {
  id: string;
  inquiryCode: string;
  category: string;
  message: string;
  status: string;
  internalNote: string | null;
  replyNoticeId: string | null;
  answeredAt: Date | null;
  answeredBy: string | null;
  createdAt: Date;
  account: { accountCode: string; displayName: string | null };
};

/** 管理画面へ返す形。運用メモはここにだけ含める (利用者向けの経路には出さない)。 */
function toAdminView(row: InquiryWithAccount) {
  return {
    id: row.id,
    inquiry_code: row.inquiryCode,
    account_code: row.account.accountCode,
    display_name: row.account.displayName,
    category: row.category,
    message: row.message,
    status: row.status,
    internal_note: row.internalNote,
    reply_notice_id: row.replyNoticeId,
    answered_at: row.answeredAt?.toISOString() ?? null,
    answered_by: row.answeredBy,
    created_at: row.createdAt.toISOString(),
  };
}
