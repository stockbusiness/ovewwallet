import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";
import {
  HoldNotActiveError,
  HoldNotFoundError,
  InsufficientBalanceError,
  InvalidAmountError,
  TransactionNotFoundError,
  TransactionNotReversibleError,
  WalletNotActiveError,
  WalletNotFoundError,
} from "@ove/ledger";
import { ExternalApiAuthError } from "@ove/auth";
import type { RequestWithId } from "./request-id.middleware";

const NOT_FOUND_ERRORS = [WalletNotFoundError, TransactionNotFoundError, HoldNotFoundError];
const CONFLICT_ERRORS = [
  WalletNotActiveError,
  InsufficientBalanceError,
  TransactionNotReversibleError,
  HoldNotActiveError,
];

/**
 * 台帳コア (@ove/ledger) と外部API認証 (@ove/auth) が投げる例外を
 * 適切なHTTPステータスへマッピングする。機密情報 (スタックトレース等) は
 * レスポンスへ含めない。
 */
@Catch()
export class LedgerExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(LedgerExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithId>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      response.status(status).json({
        ...toErrorBody(exception.getResponse()),
        requestId: request.requestId,
      });
      return;
    }

    if (exception instanceof InvalidAmountError) {
      response.status(HttpStatus.BAD_REQUEST).json({
        error: exception.name,
        message: exception.message,
        requestId: request.requestId,
      });
      return;
    }

    if (exception instanceof ExternalApiAuthError) {
      response.status(HttpStatus.UNAUTHORIZED).json({
        error: exception.name,
        message: exception.message,
        requestId: request.requestId,
      });
      return;
    }

    for (const ErrorClass of NOT_FOUND_ERRORS) {
      if (exception instanceof ErrorClass) {
        response.status(HttpStatus.NOT_FOUND).json({
          error: exception.name,
          message: exception.message,
          requestId: request.requestId,
        });
        return;
      }
    }

    for (const ErrorClass of CONFLICT_ERRORS) {
      if (exception instanceof ErrorClass) {
        response.status(HttpStatus.CONFLICT).json({
          error: exception.name,
          message: exception.message,
          requestId: request.requestId,
        });
        return;
      }
    }

    this.logger.error(exception instanceof Error ? exception.stack : exception);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: "InternalServerError",
      message: "unexpected error",
      requestId: request.requestId,
    });
  }
}

function toErrorBody(body: unknown): Record<string, unknown> {
  if (typeof body === "string") return { message: body };
  return body as Record<string, unknown>;
}
