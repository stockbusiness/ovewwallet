import { Inject, Injectable, Logger } from "@nestjs/common";
import { generateId, type PrismaClient } from "@ove/database";
import { z } from "zod";
import { PRISMA } from "../common/prisma.module";
import { IntegrationHttpClient } from "../integrations/integration-http-client";
import { IntegrationConfigProvider } from "../integrations/integration-config-provider";

/** 連携先が何を返しても診断できるよう、形は問わずに受ける。 */
const AnyJsonSchema = z.unknown();

export type ConnectionTestOutcome = "ok" | "unauthorized" | "not_found" | "unreachable" | "server_error" | "not_configured";

export interface ConnectionTestResult {
  outcome: ConnectionTestOutcome;
  /** 管理画面にそのまま出す説明。原因と次にやることを含める。 */
  message: string;
  /** 実際に叩いた先 (APIキーは含めない)。 */
  requestUrl: string | null;
  httpStatus: number | null;
}

/**
 * 管理画面の「接続テスト」。共通顧客HUB送信設定に保存された送信先URLとAPIキーで
 * 代理店システム(sengoku-ai.com)を実際に叩き、疎通と認証だけを確かめる。
 *
 * Feature Flagを**開ける前**に設定の正しさを確認できることが目的なので、
 * Flagは見ない (`resolveAgencySystemConfigIgnoringFlag`)。
 *
 * 副作用を避けるため `create_if_missing: false` で問い合わせる。共通顧客が
 * 見つからない応答は「疎通OK」として扱う (存在しないIDを送っているので当然)。
 * 判定したいのは「URLが正しいか」「APIキーが通るか」の2点だけ。
 */
@Injectable()
export class AdminAgencyConnectionTestService {
  private readonly logger = new Logger(AdminAgencyConnectionTestService.name);

  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly http: IntegrationHttpClient,
    private readonly configProvider: IntegrationConfigProvider,
  ) {}

  async run(adminId: string): Promise<ConnectionTestResult> {
    const config = await this.configProvider.resolveAgencySystemConfigIgnoringFlag();
    if (!config) {
      return {
        outcome: "not_configured",
        message:
          "共通顧客HUB送信設定にAPIキーが未設定です。代理店システムの担当者から受け取ったキーを先に設定してください。",
        requestUrl: null,
        httpStatus: null,
      };
    }

    const requestUrl = `${config.baseUrl.replace(/\/$/, "")}/api/common-users/resolve`;
    const result = await this.http.request({
      baseUrl: config.baseUrl,
      path: "/api/common-users/resolve",
      apiKey: config.apiKey,
      body: {
        system_key: config.systemKey,
        // 実在しないIDで問い合わせる。作成もさせないので、相手側に何も残らない。
        external_user_id: `connection-test-${Date.now()}`,
        create_if_missing: false,
      },
      responseSchema: AnyJsonSchema,
      logger: this.logger,
    });

    const outcome = this.classify(result, requestUrl);
    await this.writeAudit(adminId, config.baseUrl, config.systemKey, outcome);
    return outcome;
  }

  private classify(
    result: Awaited<ReturnType<IntegrationHttpClient["request"]>>,
    requestUrl: string,
  ): ConnectionTestResult {
    if (result.ok) {
      return {
        outcome: "ok",
        message:
          "送信先URLとAPIキーで応答がありました。共通顧客が見つからない旨の応答も、実在しないIDを送っているため正常です。",
        requestUrl,
        httpStatus: 200,
      };
    }

    const status = result.error.status ?? null;
    if (status === 401 || status === 403) {
      return {
        outcome: "unauthorized",
        message:
          `APIキーが受け付けられませんでした (HTTP ${status})。代理店システム側に登録されているキーと、こちらに保存したキーが同じか確認してください。`,
        requestUrl,
        httpStatus: status,
      };
    }
    if (status === 404) {
      return {
        outcome: "not_found",
        message:
          "送信先が見つかりません (HTTP 404)。共通顧客HUB送信設定の「送信先URL」を確認してください。",
        requestUrl,
        httpStatus: status,
      };
    }
    if (result.error.kind === "timeout" || result.error.kind === "network") {
      return {
        outcome: "unreachable",
        message: `代理店システムへ接続できませんでした (${result.error.kind})。送信先URLとネットワークを確認してください。`,
        requestUrl,
        httpStatus: status,
      };
    }
    return {
      outcome: "server_error",
      message: `代理店システムがエラーを返しました${status ? ` (HTTP ${status})` : ""}。時間をおいて再実行するか、代理店システムの担当者へ連絡してください。`,
      requestUrl,
      httpStatus: status,
    };
  }

  /** 本番の認証情報を使う外部への発信なので、誰がいつ実行したかを残す。APIキーは記録しない。 */
  private async writeAudit(
    adminId: string,
    baseUrl: string,
    systemKey: string,
    result: ConnectionTestResult,
  ): Promise<void> {
    await this.db.auditLog.create({
      data: {
        id: generateId(),
        actorType: "ADMIN",
        actorId: adminId,
        actionType: "AGENCY_CONNECTION_TEST",
        targetType: "common_user_hub_config",
        targetId: "default",
        result: result.outcome === "ok" ? "SUCCESS" : "FAILURE",
        afterData: {
          baseUrl,
          systemKey,
          outcome: result.outcome,
          httpStatus: result.httpStatus,
        },
      },
    });
  }
}
