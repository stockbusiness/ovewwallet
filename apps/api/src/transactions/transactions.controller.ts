import { Body, Controller, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { DebitRequestSchema, ReverseRequestSchema, type DebitRequest, type ReverseRequest } from "@ove/shared-types";
import { TransactionsService } from "./transactions.service";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ExternalApiAuthGuard, type AuthenticatedServiceRequest } from "../common/external-api-auth.guard";

@ApiTags("transactions")
@Controller("api/v1/transactions")
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  /** POST /api/v1/transactions/debit (指示書11章) */
  @Post("debit")
  @UseGuards(ExternalApiAuthGuard)
  async debit(
    @Body(new ZodValidationPipe(DebitRequestSchema)) body: DebitRequest,
    @Req() req: AuthenticatedServiceRequest,
  ) {
    return this.transactions.debit(body, req.serviceIntegration);
  }

  /** POST /api/v1/transactions/{transactionId}/reverse (指示書11章) */
  @Post(":transactionId/reverse")
  @UseGuards(ExternalApiAuthGuard)
  async reverse(
    @Param("transactionId") transactionId: string,
    @Body(new ZodValidationPipe(ReverseRequestSchema)) body: ReverseRequest,
    @Req() req: AuthenticatedServiceRequest,
  ) {
    return this.transactions.reverse(transactionId, body.reason, body.idempotency_key, {
      type: "EXTERNAL_SERVICE",
      id: req.serviceIntegration.id,
    });
  }
}
