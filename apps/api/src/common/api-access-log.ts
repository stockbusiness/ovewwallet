import { generateId, type PrismaClient } from "@ove/database";

export interface LogApiAccessParams {
  serviceIntegrationId?: string | null;
  apiKeyPrefix?: string | null;
  method: string;
  path: string;
  statusCode: number;
  sourceIp?: string | null;
  requestId?: string | null;
  errorMessage?: string | null;
}

/**
 * 外部サービスAPIへのリクエストを記録する (指示書13章「APIアクセスログ」画面向け)。
 * ログ書き込み自体が失敗してもAPIリクエスト処理を止めないよう、呼び出し側は
 * このPromiseを待つが例外は握りつぶさない設計にはしていない (呼び出し側で
 * catchすること)。
 */
export async function logApiAccess(db: PrismaClient, params: LogApiAccessParams): Promise<void> {
  await db.apiAccessLog.create({
    data: {
      id: generateId(),
      serviceIntegrationId: params.serviceIntegrationId ?? undefined,
      apiKeyPrefix: params.apiKeyPrefix ?? undefined,
      method: params.method,
      path: params.path,
      statusCode: params.statusCode,
      sourceIp: params.sourceIp ?? undefined,
      requestId: params.requestId ?? undefined,
      errorMessage: params.errorMessage ?? undefined,
    },
  });
}
