import { Injectable } from "@nestjs/common";
import type { OveAccount, Prisma, WalletUserReferral } from "@ove/database";
import { appUrl } from "../common/app-url";
import { isFeatureEnabled } from "../common/feature-flags";
import { AttachWalletUserReferralUseCase } from "./attach-wallet-user-referral.use-case";
import { WalletUserReferralCaptureUseCase } from "./wallet-user-referral-capture.use-case";
import { WalletUserReferralCodeService } from "./wallet-user-referral-code.service";
import { WalletUserReferralRepository } from "./wallet-user-referral.repository";

/** 本人向け画面に出す1件。相手の個人情報は出さず、表示名とアカウントコードまで。 */
export interface MyReferralItem {
  account_code: string;
  display_name: string | null;
  registered_at: string | null;
  /** 代理店システムへ継承を通知済みか。 */
  inherited: boolean;
}

export interface MyReferralSummary {
  enabled: boolean;
  /** 未発行のまま照会した場合 (Flag OFF) は null。 */
  code: string | null;
  url: string | null;
  referred_count: number;
  referrals: MyReferralItem[];
}

/**
 * ウォレット利用者同士の紹介 (`docs/wallet-user-referral.md`) の入口。
 * 個々の責務はuse-case側へ分け、ここは呼び出し元 (controller・AuthService) から
 * 使う窓口に留める (`ReferralsService`と同じ構成)。
 */
@Injectable()
export class WalletUserReferralsService {
  constructor(
    private readonly repository: WalletUserReferralRepository,
    private readonly codes: WalletUserReferralCodeService,
    private readonly captureUseCase: WalletUserReferralCaptureUseCase,
    private readonly attachUseCase: AttachWalletUserReferralUseCase,
  ) {}

  capture(params: { code: string; ipHash?: string; userAgentHash?: string }) {
    return this.captureUseCase.capture(params);
  }

  resolvePendingSession(cookieToken: string | undefined) {
    return this.captureUseCase.resolvePendingSession(cookieToken);
  }

  attachToNewAccount(tx: Prisma.TransactionClient, referral: WalletUserReferral, account: OveAccount) {
    return this.attachUseCase.attachToNewAccount(tx, referral, account);
  }

  excludeForAgencyReferral(tx: Prisma.TransactionClient, referral: WalletUserReferral) {
    return this.attachUseCase.excludeForAgencyReferral(tx, referral);
  }

  /**
   * 本人の紹介コードと紹介実績。Flag OFFのときはコードを**発行せずに**
   * `enabled: false` を返す (OFFのまま照会されてコードだけ増えるのを避ける)。
   */
  async getMySummary(accountId: string): Promise<MyReferralSummary> {
    if (!isFeatureEnabled("ENABLE_WALLET_USER_REFERRAL")) {
      return { enabled: false, code: null, url: null, referred_count: 0, referrals: [] };
    }

    const code = await this.codes.ensureCode(accountId);
    const rows = await this.repository.listByReferrer(accountId);

    return {
      enabled: true,
      code,
      url: buildReferralUrl(code),
      referred_count: rows.length,
      referrals: rows.map((row) => ({
        account_code: row.referred?.accountCode ?? "-",
        display_name: row.referred?.displayName ?? null,
        registered_at: row.registeredAt?.toISOString() ?? null,
        inherited: row.status === "INHERITED",
      })),
    };
  }
}

/**
 * 共有用のURL。`APP_URL`から組み立て、リクエストのホスト名からは作らない
 * (`referrals.controller.ts`のリダイレクト先と同じ理由で、外部入力を混ぜない)。
 */
function buildReferralUrl(code: string): string {
  return appUrl(`/r/${code}`);
}
