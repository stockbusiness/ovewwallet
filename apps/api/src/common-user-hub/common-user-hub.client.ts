import { Injectable } from "@nestjs/common";
import {
  CommonUserHubAdapter,
  type ResolveCommonUserParams,
  type ResolveCommonUserResult,
  type LinkSystemAccountParams,
} from "../integrations/common-user-hub.adapter";

/**
 * リファクタリング指示書 Phase 7により、実際の送信処理は`CommonUserHubAdapter`
 * (`IntegrationHttpClient`/`IntegrationConfigProvider`経由) に移動した。
 * このクラスは既存呼び出し元(`CommonUserLinkingService`等)のimport/DI/公開メソッド
 * 名を変えないための一時Facade。
 */
@Injectable()
export class CommonUserHubClient {
  constructor(private readonly adapter: CommonUserHubAdapter) {}

  async resolve(params: ResolveCommonUserParams): Promise<ResolveCommonUserResult | null> {
    return this.adapter.resolve(params);
  }

  async linkSystemAccount(params: LinkSystemAccountParams): Promise<boolean> {
    return this.adapter.linkSystemAccount(params);
  }
}

export type { ResolveCommonUserParams, ResolveCommonUserResult, LinkSystemAccountParams };
