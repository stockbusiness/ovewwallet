import {
  type ArgumentsHost,
  BadRequestException,
  Catch,
  type ExceptionFilter,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Response } from "express";
import { ExternalApiAuthError, AgencySsoVerificationError, CommonEventAuthError } from "@ove/auth";
import { LEDGER_ERROR_CLASSIFICATION } from "./ledger-error-classification";
import type { RequestWithId } from "./request-id.middleware";
import { captureException } from "./sentry";

/**
 * 「千ノ国 代理店システム 外部開発者向け連携ガイド」v3.6.78-draft 13章の
 * エラー形式 `{ok:false, error:{code,message}}` に合わせた例外フィルタ。
 * sengoku-ai.com等の外部システムが直接叩くAPI (代理店同期Webhook・報酬付与・
 * 取引デビット/取消) にのみ適用する。ウォレット自身のフロントエンド
 * (apps/user-wallet, apps/admin-wallet の `lib/api.ts`) はレスポンス直下の
 * `message`を読む実装のため、既存の`LedgerExceptionFilter`(グローバル適用)は
 * そのまま維持し、このフィルタは対象コントローラ/メソッドにのみ
 * `@UseFilters()`で個別適用することで影響範囲を限定する。
 */
@Catch()
export class ExternalApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ExternalApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithId>();

    const { status, code, message } = this.classify(exception);
    if (status >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack : exception);
      captureException(exception);
    }

    response.status(status).json({
      ok: false,
      error: { code, message },
      request_id: request.requestId,
    });
  }

  private classify(exception: unknown): { status: number; code: string; message: string } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const message = extractMessage(exception.getResponse(), exception.message);

      if (exception instanceof BadRequestException) {
        return { status, code: "VALIDATION_ERROR", message };
      }
      if (exception instanceof UnauthorizedException) {
        return { status, code: /missing/i.test(message) ? "API_KEY_REQUIRED" : "INVALID_API_KEY", message };
      }
      if (exception instanceof ServiceUnavailableException) {
        return { status, code: "FEATURE_DISABLED", message };
      }
      if (exception instanceof NotFoundException) {
        return { status, code: "NOT_FOUND", message };
      }
      if (exception instanceof ForbiddenException) {
        return { status, code: "FORBIDDEN", message };
      }
      if (exception instanceof UnprocessableEntityException) {
        return { status, code: "UNSUPPORTED_EVENT_VERSION", message };
      }
      return { status, code: exception.constructor.name, message };
    }

    if (exception instanceof ExternalApiAuthError || exception instanceof AgencySsoVerificationError) {
      return { status: HttpStatus.UNAUTHORIZED, code: "INVALID_API_KEY", message: exception.message };
    }
    if (exception instanceof CommonEventAuthError) {
      return { status: HttpStatus.UNAUTHORIZED, code: "INVALID_SIGNATURE", message: exception.message };
    }

    for (const ErrorClass of LEDGER_ERROR_CLASSIFICATION.notFound) {
      if (exception instanceof ErrorClass) {
        return { status: HttpStatus.NOT_FOUND, code: exception.name, message: exception.message };
      }
    }
    for (const ErrorClass of LEDGER_ERROR_CLASSIFICATION.conflict) {
      if (exception instanceof ErrorClass) {
        return { status: HttpStatus.CONFLICT, code: exception.name, message: exception.message };
      }
    }
    for (const ErrorClass of LEDGER_ERROR_CLASSIFICATION.badRequest) {
      if (exception instanceof ErrorClass) {
        return { status: HttpStatus.BAD_REQUEST, code: exception.name, message: exception.message };
      }
    }

    return { status: HttpStatus.INTERNAL_SERVER_ERROR, code: "INTERNAL_ERROR", message: "unexpected error" };
  }
}

function extractMessage(body: unknown, fallback: string): string {
  if (typeof body === "string") return body;
  if (body && typeof body === "object" && "message" in body) {
    const value = (body as Record<string, unknown>).message;
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.join(", ");
  }
  return fallback;
}
