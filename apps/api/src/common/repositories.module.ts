import { Global, Module } from "@nestjs/common";
import { AccountRepository } from "../accounts/account.repository";
import { CommonUserLinkingUseCase } from "../accounts/common-user-linking.use-case";
import { RewardRuleRepository } from "../rewards/reward-rule.repository";

/**
 * リファクタリング指示書 Phase 8「DBアクセス境界」。`AccountRepository`/
 * `RewardRuleRepository`は、それぞれの所有モジュール (`AccountsModule`/
 * `RewardsModule`) 以外の複数モジュール (`AdminModule`・`CommonEventsModule`・
 * `ReferralsModule`、およびどのモジュールにも登録されていない
 * `SessionAuthGuard`) からも参照される。個別モジュールの`imports`で解決しようと
 * すると (例: `AccountsModule`は既に`ReferralsModule`をimportしているため、
 * 逆に`ReferralsModule`が`AccountsModule`をimportすると循環になる)、循環依存や
 * 迂遠な再exportが発生するため、`PrismaModule`と同様に`@Global()`にして
 * `AppModule`で一度だけ読み込む。
 *
 * 追加整合性対策P0-1: `CommonUserLinkingUseCase`も同じ理由で同居させる。
 * `AccountsModule`の`CommonUserLinkingService`と`CommonEventsModule`の
 * `CommonUserResolvedHandler`/`CommonUserMergedHandler`という、互いにimport
 * 関係のない2モジュールの双方から同一ロジックを使う必要があるため。
 */
@Global()
@Module({
  providers: [AccountRepository, RewardRuleRepository, CommonUserLinkingUseCase],
  exports: [AccountRepository, RewardRuleRepository, CommonUserLinkingUseCase],
})
export class RepositoriesModule {}
