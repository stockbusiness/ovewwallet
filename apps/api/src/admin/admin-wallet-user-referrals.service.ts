import { Injectable, NotFoundException } from "@nestjs/common";
import { AccountRepository } from "../accounts/account.repository";
import { WalletUserReferralRepository } from "../wallet-user-referrals/wallet-user-referral.repository";

/** 一覧の1行。相手の個人情報は返さず、アカウントコードと表示名まで。 */
export interface AdminWalletUserReferralRow {
  id: string;
  account_id: string | null;
  account_code: string | null;
  display_name: string | null;
  status: string;
  captured_at: string;
  registered_at: string | null;
  inherited_at: string | null;
  reason: string | null;
  /**
   * 紹介された側に設定されている紹介代理店。継承申請を送ったあと、代理店システムが
   * 承認して`customer.assignment.changed`を返したかどうかがここで分かる
   * (申請の送信成功は承認を意味しないため、申請済みかどうかとは別に見る必要がある)。
   */
  referred_registration_referrer_agency_id: string | null;
}

export interface AdminWalletUserReferralView {
  /** このアカウントを紹介した関係 (最大1件)。無ければ null。 */
  referred_by: AdminWalletUserReferralRow | null;
  /** このアカウントが紹介した関係。成立しなかったものも含む。 */
  referrals_made: AdminWalletUserReferralRow[];
  /** 成立している件数 (REGISTERED + INHERITED)。画面の見出しに出す。 */
  established_count: number;
}

/**
 * 管理画面向けのウォレット紹介の可視化 (`docs/wallet-user-referral.md`)。
 *
 * 「紹介したはずなのに数に入らない」という問い合わせに答えるための画面なので、
 * 成立した関係だけでなく**成立しなかった関係とその理由**も返す
 * (代理店紹介が優先された `EXCLUDED`、期限切れの `EXPIRED`)。
 */
@Injectable()
export class AdminWalletUserReferralsService {
  constructor(
    private readonly referrals: WalletUserReferralRepository,
    private readonly accountRepository: AccountRepository,
  ) {}

  async forAccount(accountId: string): Promise<AdminWalletUserReferralView> {
    const account = await this.accountRepository.findById(accountId);
    if (!account) throw new NotFoundException(`account ${accountId} not found`);

    const [referredBy, made] = await Promise.all([
      this.referrals.findByReferredForAdmin(accountId),
      this.referrals.listByReferrerForAdmin(accountId),
    ]);

    return {
      referred_by: referredBy ? toRow(referredBy, referredBy.referrer) : null,
      referrals_made: made.map((row) => toRow(row, row.referred)),
      established_count: made.filter((row) => row.status === "REGISTERED" || row.status === "INHERITED")
        .length,
    };
  }
}

/** 相手側のアカウント情報は、紹介された側が登録前の行では null になりうる。 */
function toRow(
  row: {
    id: string;
    status: string;
    capturedAt: Date;
    registeredAt: Date | null;
    inheritedAt: Date | null;
    reason: string | null;
  },
  counterpart:
    | { id: string; accountCode: string; displayName: string | null; registrationReferrerAgencyId?: string | null }
    | null,
): AdminWalletUserReferralRow {
  return {
    id: row.id,
    account_id: counterpart?.id ?? null,
    account_code: counterpart?.accountCode ?? null,
    display_name: counterpart?.displayName ?? null,
    status: row.status,
    captured_at: row.capturedAt.toISOString(),
    registered_at: row.registeredAt?.toISOString() ?? null,
    inherited_at: row.inheritedAt?.toISOString() ?? null,
    reason: row.reason,
    referred_registration_referrer_agency_id: counterpart?.registrationReferrerAgencyId ?? null,
  };
}
