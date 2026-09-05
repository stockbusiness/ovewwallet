import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import "./common/bigint-json";
import { AccountsModule } from "./accounts/accounts.module";
import { AdminModule } from "./admin/admin.module";
import { AgencyModule } from "./agency/agency.module";
import { AuthModule } from "./auth/auth.module";
import { CommonEventsModule } from "./common-events/common-events.module";
import { CollectiblesModule } from "./collectibles/collectibles.module";
import { CollectibleClaimsModule } from "./collectible-claims/collectible-claims.module";
import { CollectibleImagesModule } from "./collectible-images/collectible-images.module";
import { csrfProtectionMiddleware } from "./common/csrf-protection.middleware";
import { KeyValueStoreModule } from "./common/kv-store.module";
import { maintenanceModeMiddleware } from "./common/maintenance-mode.middleware";
import { PrismaModule } from "./common/prisma.module";
import { RepositoriesModule } from "./common/repositories.module";
import { requestIdMiddleware } from "./common/request-id.middleware";
import { DailyBonusModule } from "./daily-bonus/daily-bonus.module";
import { HealthController } from "./health.controller";
import { LegalModule } from "./legal/legal.module";
import { MailModule } from "./mail/mail.module";
import { OutboxModule } from "./outbox/outbox.module";
import { ReferralsModule } from "./referrals/referrals.module";
import { ReportingModule } from "./reporting/reporting.module";
import { RewardsModule } from "./rewards/rewards.module";
import { SchedulerModule } from "./scheduler/scheduler.module";
import { TransactionsModule } from "./transactions/transactions.module";
import { WalletsModule } from "./wallets/wallets.module";

@Module({
  imports: [
    PrismaModule,
    RepositoriesModule,
    KeyValueStoreModule,
    LegalModule,
    MailModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    AccountsModule,
    WalletsModule,
    RewardsModule,
    TransactionsModule,
    AuthModule,
    AdminModule,
    OutboxModule,
    AgencyModule,
    ReferralsModule,
    ReportingModule,
    DailyBonusModule,
    CommonEventsModule,
    CollectiblesModule,
    CollectibleClaimsModule,
    CollectibleImagesModule,
    SchedulerModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // CSRF対策はAppModule側で登録する。main.tsのbootstrap()ではなくここに置くことで、
    // AppModuleを起動する全てのe2eテストでも本番と同じ経路が有効になる。
    //
    // 順序に意味がある。request_idは503のレスポンスにも必要なので先頭。
    // メンテナンス判定はCSRF検証より前に置く — メンテナンス中に返すのは常に503で、
    // 「メンテナンス中なのにCSRFの403が返る」という紛らわしい応答を避けるため。
    consumer
      .apply(requestIdMiddleware, maintenanceModeMiddleware, csrfProtectionMiddleware)
      .forRoutes("*");
  }
}
