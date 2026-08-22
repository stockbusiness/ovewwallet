import { Module } from "@nestjs/common";
import { ServiceTransactionsController, TransactionsController } from "./transactions.controller";
import { TransactionsService } from "./transactions.service";

@Module({
  controllers: [TransactionsController, ServiceTransactionsController],
  providers: [TransactionsService],
})
export class TransactionsModule {}
