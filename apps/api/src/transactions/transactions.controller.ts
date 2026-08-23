import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  DebitRequestSchema,
  ReverseRequestSchema,
  type DebitRequest,
  type ReverseRequest,
} from "@ove/shared-types";
import type { Response } from "express";
import { ApiAccessLogInterceptor } from "../common/api-access-log.interceptor";
import {
  ExternalApiAuthGuard,
  type AuthenticatedServiceRequest,
} from "../common/external-api-auth.guard";
import { ExternalApiExceptionFilter } from "../common/external-api-exception.filter";
import {
  RequireServiceScope,
  ServiceScopeGuard,
} from "../common/service-scope.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { TRANSACTION_SERVICE_SCOPES } from "./transaction-service-scopes";
import { TransactionsService } from "./transactions.service";

@ApiTags("transactions")
@Controller("api/v1/transactions")
@UseFilters(ExternalApiExceptionFilter)
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  /** POST /api/v1/transactions/debit (指示書11章) */
  @Post("debit")
  @UseGuards(ExternalApiAuthGuard)
  @UseInterceptors(ApiAccessLogInterceptor)
  async debit(
    @Body(new ZodValidationPipe(DebitRequestSchema)) body: DebitRequest,
    @Req() req: AuthenticatedServiceRequest,
  ) {
    return this.transactions.debit(body, req.serviceIntegration);
  }

  /** POST /api/v1/transactions/{transactionId}/reverse (指示書11章) */
  @Post(":transactionId/reverse")
  @UseGuards(ExternalApiAuthGuard)
  @UseInterceptors(ApiAccessLogInterceptor)
  async reverse(
    @Param("transactionId") transactionId: string,
    @Body(new ZodValidationPipe(ReverseRequestSchema)) body: ReverseRequest,
    @Req() req: AuthenticatedServiceRequest,
  ) {
    return this.transactions.reverse(
      transactionId,
      body.reason,
      body.idempotency_key,
      {
        type: "EXTERNAL_SERVICE",
        id: req.serviceIntegration.id,
      },
    );
  }
}

function parseRequiredDateQueryParam(
  rawValue: string | undefined,
  paramName: string,
): Date {
  if (!rawValue) throw new BadRequestException(`${paramName} is required`);
  const parsed = new Date(rawValue);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(
      `${paramName} ("${rawValue}") is not a valid date`,
    );
  }
  return parsed;
}

/**
 * 外部サービス向け取引照会 (千ノ国パスポート等との日次照合用)。認証済みの連携先が
 * 自ら付与・利用した取引のみを対象にし、他サービスの取引を横断的に照会できないようにする
 * (`ServiceAccountsController`の残高照会APIと同じ方針)。
 */
@ApiTags("service")
@Controller("api/v1/service/transactions")
@UseFilters(ExternalApiExceptionFilter)
export class ServiceTransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  /**
   * idempotency_key単発照会。応答喪失時 (送信は成功したが応答が受け取れなかった場合)
   * に、Wallet側で取引が成立しているかを確認する復旧手段として使う。
   */
  @Get("by-idempotency-key/:idempotencyKey")
  @UseGuards(ExternalApiAuthGuard, ServiceScopeGuard)
  @RequireServiceScope(TRANSACTION_SERVICE_SCOPES.TRANSACTIONS_READ)
  @UseInterceptors(ApiAccessLogInterceptor)
  async byIdempotencyKey(
    @Req() req: AuthenticatedServiceRequest,
    @Param("idempotencyKey") idempotencyKey: string,
  ) {
    return this.transactions.findByIdempotencyKeyForService(
      idempotencyKey,
      req.serviceIntegration,
    );
  }

  /**
   * 日次照合用CSV一括ダウンロード。period_from/period_toは必須、rule_codeは任意の絞り込み。
   * 1ページ最大10,000件。超過分は無言で切り捨てず、応答ヘッダー`X-Has-More: true`と
   * `X-Next-Cursor`で続きを示す(次回呼び出しの`cursor`クエリパラメータにそのまま渡す)。
   */
  @Get("export")
  @UseGuards(ExternalApiAuthGuard, ServiceScopeGuard)
  @RequireServiceScope(TRANSACTION_SERVICE_SCOPES.TRANSACTIONS_EXPORT)
  @UseInterceptors(ApiAccessLogInterceptor)
  async export(
    @Req() req: AuthenticatedServiceRequest,
    @Res() res: Response,
    @Query("period_from") periodFrom?: string,
    @Query("period_to") periodTo?: string,
    @Query("rule_code") ruleCode?: string,
    @Query("cursor") cursor?: string,
  ) {
    const result = await this.transactions.exportServiceTransactionsCsv(
      {
        periodFrom: parseRequiredDateQueryParam(periodFrom, "period_from"),
        periodTo: parseRequiredDateQueryParam(periodTo, "period_to"),
        ruleCode,
        cursor,
      },
      req.serviceIntegration,
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="transactions.csv"',
    );
    res.setHeader("X-Has-More", result.hasMore ? "true" : "false");
    if (result.nextCursor) res.setHeader("X-Next-Cursor", result.nextCursor);
    res.send(result.csv);
  }
}
