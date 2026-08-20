import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { PrismaClient } from "@ove/database";
import { logApiAccess } from "./api-access-log";
import type { AuthenticatedServiceRequest } from "./external-api-auth.guard";
import { PRISMA } from "./prisma.module";
import type { RequestWithId } from "./request-id.middleware";

export const SERVICE_SCOPE_KEY = "serviceScopes";
export const RequireServiceScope = (...scopes: string[]) =>
  SetMetadata(SERVICE_SCOPE_KEY, scopes);

/**
 * PR-W2: `ExternalApiAuthGuard`(認証、401)の後段で実行し、
 * `req.serviceIntegration.allowedScopes`に必要scopeが含まれるか検証する(403)。
 * `RolesGuard`(管理API向け)と同じ`SetMetadata`+`Reflector`の形。
 *
 * NestJSではGuardが投げた例外はInterceptor(`ApiAccessLogInterceptor`)を経由せず
 * 直接ExceptionFilterへ渡る(Guard→Interceptorの順で実行されるため)。そのため
 * `ExternalApiAuthGuard.safeLog()`が401を自分で記録しているのと同じ理由で、
 * このGuardも403を自分で`api_access_logs`へ記録する。scope不足のログには
 * 残高・APIキー・署名値・common_user_id(bodyの中身)を一切含めない。
 */
@Injectable()
export class ServiceScopeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(PRISMA) private readonly db: PrismaClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredScopes = this.reflector.getAllAndOverride<
      string[] | undefined
    >(SERVICE_SCOPE_KEY, [context.getHandler(), context.getClass()]);
    if (!requiredScopes || requiredScopes.length === 0) return true;

    const req = context
      .switchToHttp()
      .getRequest<AuthenticatedServiceRequest & Partial<RequestWithId>>();
    const allowedScopes = req.serviceIntegration.allowedScopes;
    const hasAllRequiredScopes = requiredScopes.every((scope) =>
      allowedScopes.includes(scope),
    );
    if (hasAllRequiredScopes) return true;

    const error = new ForbiddenException(
      `service integration "${req.serviceIntegration.serviceCode}" is missing required scope(s): ${requiredScopes.join(", ")}`,
    );
    await this.safeLog(req, error);
    throw error;
  }

  private async safeLog(
    req: AuthenticatedServiceRequest & Partial<RequestWithId>,
    error: Error,
  ): Promise<void> {
    try {
      await logApiAccess(this.db, {
        serviceIntegrationId: req.serviceIntegration.id,
        method: req.method,
        path: req.originalUrl,
        statusCode: 403,
        sourceIp: req.ip,
        requestId: req.requestId,
        errorMessage: error.message,
      });
    } catch {
      // ログ記録自体の失敗でAPIリクエストの本来の処理結果を左右しない
    }
  }
}
