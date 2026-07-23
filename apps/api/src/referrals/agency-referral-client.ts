import { Injectable } from "@nestjs/common";
import {
  AgencyReferralAdapter,
  type CaptureReferralResult,
  type ConfirmReferralParams,
  type ConfirmReferralResult,
} from "../integrations/agency-referral.adapter";

/**
 * リファクタリング指示書 Phase 7により、実際の送信処理は`AgencyReferralAdapter`
 * (`IntegrationHttpClient`/`IntegrationConfigProvider`経由) に移動した。
 * このクラスは既存呼び出し元(`ConfirmReferralUseCase`/`ReferralCaptureUseCase`等)の
 * import/DI/公開メソッド名を変えないための一時Facade。
 */
@Injectable()
export class AgencyReferralClient {
  constructor(private readonly adapter: AgencyReferralAdapter) {}

  async capture(rawReferralValue: string): Promise<CaptureReferralResult | null> {
    return this.adapter.capture(rawReferralValue);
  }

  async confirm(params: ConfirmReferralParams): Promise<ConfirmReferralResult | null> {
    return this.adapter.confirm(params);
  }
}

export type { CaptureReferralResult, ConfirmReferralParams, ConfirmReferralResult };
