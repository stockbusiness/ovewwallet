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
import { KeyValueStoreModule } from "./common/kv-store.module";
import { PrismaModule } from "./common/prisma.module";
import { RepositoriesModule } from "./common/repositories.module";
import { requestIdMiddleware } from "./common/request-id.middleware";
import { DailyBonusModule } from "./daily-bonus/daily-bonus.module";
import { HealthController } from "./health.controller";
import { OutboxModule } from "./outbox/outbox.module";
import { ReferralsModule } from "./referrals/referrals.module";
import { RewardsModule } from "./rewards/rewards.module";
import { TransactionsModule } from "./transactions/transactions.module";
import { WalletsModule } from "./wallets/wallets.module";

@Module({
  imports: [
    PrismaModule,
    RepositoriesModule,
    KeyValueStoreModule,
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
    DailyBonusModule,
    CommonEventsModule,
    CollectiblesModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(requestIdMiddleware).forRoutes("*");
  }
}
