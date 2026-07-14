import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import type { Response } from "express";
import { catchError, Observable, tap, throwError } from "rxjs";
import type { PrismaClient } from "@ove/database";
import { PRISMA } from "./prisma.module";
import { logApiAccess } from "./api-access-log";
import type { AuthenticatedServiceRequest } from "./external-api-auth.guard";
import type { RequestWithId } from "./request-id.middleware";

/**
 * ExternalApiAuthGuard を通過した (認証成功済みの) リクエストについて、
 * 実際のハンドラ実行結果 (成功/業務エラー) を `api_access_logs` に記録する。
 * 認証段階での拒否 (401) は Guard 側で記録している。
 */
@Injectable()
export class ApiAccessLogInterceptor implements NestInterceptor {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<AuthenticatedServiceRequest & Partial<RequestWithId>>();
    const res = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      tap(() => {
        void this.log(req, res.statusCode, undefined);
      }),
      catchError((error: unknown) => {
        const statusCode = error instanceof HttpException ? error.getStatus() : 500;
        const message = error instanceof Error ? error.message : String(error);
        void this.log(req, statusCode, message);
        return throwError(() => error);
      }),
    );
  }

  private async log(
    req: AuthenticatedServiceRequest & Partial<RequestWithId>,
    statusCode: number,
    errorMessage: string | undefined,
  ): Promise<void> {
    try {
      await logApiAccess(this.db, {
        serviceIntegrationId: req.serviceIntegration?.id ?? null,
        method: req.method,
        path: req.originalUrl,
        statusCode,
        sourceIp: req.ip,
        requestId: req.requestId,
        errorMessage,
      });
    } catch {
      // ログ記録自体の失敗でAPIリクエストの本来の処理結果を左右しない
    }
  }
}
