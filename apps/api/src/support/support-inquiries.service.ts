import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  generateId,
  nextDisplayCode,
  type PrismaClient,
  type SupportInquiryCategory,
  type SupportInquiryStatus,
} from "@ove/database";
import { PRISMA } from "../common/prisma.module";

const INQUIRY_CODE_COUNTER = "support_inquiry_code";

/** 本人が自分の問い合わせを見返すときの件数。困りごとの数はたかが知れている。 */
const MINE_LIMIT = 20;

/**
 * 利用者からの問い合わせ (docs/support-inquiries.md)。
 *
 * **本人のセッションから受ける。** 「付与されない」「残高が合わない」は、どの
 * アカウントのどの時点の話かが分からないと調べようがない。メールアドレスを
 * 案内するだけでは、その紐付けを利用者の自己申告に頼ることになる。
 */
@Injectable()
export class SupportInquiriesService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async create(params: {
    oveAccountId: string;
    category: SupportInquiryCategory;
    message: string;
  }) {
    const inquiryCode = await nextDisplayCode(this.db, INQUIRY_CODE_COUNTER, "OVE-INQ", 6);
    const created = await this.db.supportInquiry.create({
      data: {
        id: generateId(),
        inquiryCode,
        oveAccountId: params.oveAccountId,
        category: params.category,
        message: params.message,
      },
    });
    return toMineView(created);
  }

  /** 本人が出した問い合わせの一覧。運用メモは含めない。 */
  async listMine(oveAccountId: string) {
    const rows = await this.db.supportInquiry.findMany({
      where: { oveAccountId },
      orderBy: { createdAt: "desc" },
      take: MINE_LIMIT,
    });
    return rows.map(toMineView);
  }

  /** 直近に同じ人から出ていないか。連打での二重登録を防ぐ。 */
  async hasRecentDuplicate(oveAccountId: string, message: string, within: Date): Promise<boolean> {
    const found = await this.db.supportInquiry.findFirst({
      where: { oveAccountId, message, createdAt: { gte: within } },
      select: { id: true },
    });
    return found !== null;
  }

  async getOrThrow(id: string) {
    const found = await this.db.supportInquiry.findUnique({
      where: { id },
      include: { account: { select: { accountCode: true, displayName: true, status: true } } },
    });
    if (!found) throw new NotFoundException("support inquiry not found");
    return found;
  }

  async listForAdmin(params: { status?: SupportInquiryStatus; limit: number }) {
    return this.db.supportInquiry.findMany({
      where: params.status ? { status: params.status } : {},
      // 未対応を先に出す。作成順だけだと、古い対応済みが上に居座る。
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: params.limit,
      include: { account: { select: { accountCode: true, displayName: true } } },
    });
  }
}

/** 利用者へ返す形。`internalNote`は**絶対に含めない**。 */
function toMineView(row: {
  inquiryCode: string;
  category: SupportInquiryCategory;
  message: string;
  status: SupportInquiryStatus;
  createdAt: Date;
  answeredAt: Date | null;
}) {
  return {
    inquiry_code: row.inquiryCode,
    category: row.category,
    message: row.message,
    status: row.status,
    created_at: row.createdAt.toISOString(),
    answered_at: row.answeredAt?.toISOString() ?? null,
  };
}
