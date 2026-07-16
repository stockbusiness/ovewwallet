import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import "./common/bigint-json";
import { PrismaModule } from "./common/prisma.module";
import { KeyValueStoreModule } from "./common/kv-store.module";
import { requestIdMiddleware } from "./common/request-id.middleware";
import { AccountsModule } from "./accounts/accounts.module";
import { WalletsModule } from "./wallets/wallets.module";
import { RewardsModule } from "./rewards/rewards.module";
import { TransactionsModule } from "./transactions/transactions.module";
import { AuthModule } from "./auth/auth.module";
import { AdminModule } from "./admin/admin.module";
import { OutboxModule } from "./outbox/outbox.module";
import { AgencyModule } from "./agency/agency.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [
    PrismaModule,
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
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(requestIdMiddleware).forRoutes("*");
  }
}
