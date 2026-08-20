import { Module } from "@nestjs/common";
import { CommonEventAccountResolver } from "../common-events/common-event-account-resolver";

/**
 * PR-W2レビュー指摘7: `CommonEventAccountResolver`は`PRISMA`(`@Global()`)と
 * `AccountRepository`(`RepositoriesModule`、`@Global()`)にしか依存しないリーフモジュールから
 * 提供する。以前は`CommonEventsModule`のprovidersに直接置かれていたが、`WalletsModule`側の
 * 新しいcommon_user_id残高APIも同じResolverを使うため、両モジュールが同一インスタンスを
 * importできるようこのモジュールへ切り出した。このモジュール自身は他モジュールをimportしない
 * ため、`CommonEventsModule`・`WalletsModule`のどちらからimportしても循環依存にはならない。
 */
@Module({
  providers: [CommonEventAccountResolver],
  exports: [CommonEventAccountResolver],
})
export class AccountResolutionModule {}
