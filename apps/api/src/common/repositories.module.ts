import { Global, Module } from "@nestjs/common";
import { AccountRepository } from "../accounts/account.repository";
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
 */
@Global()
@Module({
  providers: [AccountRepository, RewardRuleRepository],
  exports: [AccountRepository, RewardRuleRepository],
})
export class RepositoriesModule {}
