import { Inject, Injectable, Logger } from "@nestjs/common";
import { generateId, type PrismaClient } from "@ove/database";
import { z } from "zod";
import { PRISMA } from "../common/prisma.module";
import { IntegrationHttpClient } from "../integrations/integration-http-client";
import { IntegrationConfigProvider } from "../integrations/integration-config-provider";

/** 連携先が何を返しても診断できるよう、形は問わずに受ける。 */
const AnyJsonSchema = z.unknown();

export type ConnectionTestOutcome = "ok" | "unauthorized" | "not_found" | "unreachable" | "server_error" | "not_configured";

/** APIキーの渡し方。連携先がどちらを受け付けるか実測するために使い分ける。 */
export type AuthStyle = "x-api-key" | "bearer";

export interface ConnectionTestResult {
  outcome: ConnectionTestOutcome;
  /** 管理画面にそのまま出す説明。原因と次にやることを含める。 */
  message: string;
  /** 実際に叩いた先 (APIキーは含めない)。 */
  requestUrl: string | null;
  httpStatus: number | null;
  /** 疎通できたときに、どの渡し方で通ったか。通らなかった場合はnull。 */
  acceptedAuthStyle: AuthStyle | null;
  /** 連携先が返した本文の抜粋 (先頭300文字)。原因の切り分け用。 */
  partnerResponse: string | null;
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
        acceptedAuthStyle: null,
        partnerResponse: null,
      };
    }

    const requestUrl = `${config.baseUrl.replace(/\/$/, "")}/api/common-users/resolve`;

    // まず通常経路と同じ `x-api-key` で試す。認証で弾かれた場合だけ
    // `Authorization: Bearer` でも試し、**どちらなら通るのか**を実測する。
    // 連携先はORIへ送るときBearerを使うと明言しており、受け口もBearerしか
    // 受けない可能性がある。その場合フラグを開けても本番の送信が同じ理由で
    // 失敗するため、開ける前にここで判別できるようにしている。
    let style: AuthStyle = "x-api-key";
    let result = await this.probe(config, style);
    if (this.isAuthFailure(result)) {
      const bearer = await this.probe(config, "bearer");
      if (!this.isAuthFailure(bearer)) {
        style = "bearer";
        result = bearer;
      }
    }

    const outcome = this.classify(result, requestUrl, style);
    await this.writeAudit(adminId, config.baseUrl, config.systemKey, outcome);
    return outcome;
  }

  /** 1回分の問い合わせ。副作用を出さないよう `create_if_missing: false` で送る。 */
  private async probe(
    config: { baseUrl: string; systemKey: string; apiKey: string },
    style: AuthStyle,
  ): Promise<Awaited<ReturnType<IntegrationHttpClient["request"]>>> {
    return this.http.request({
      baseUrl: config.baseUrl,
      path: "/api/common-users/resolve",
      ...(style === "x-api-key"
        ? { apiKey: config.apiKey }
        : { extraHeaders: { authorization: `Bearer ${config.apiKey}` } }),
      body: {
        system_key: config.systemKey,
        // 実在しないIDで問い合わせる。作成もさせないので、相手側に何も残らない。
        external_user_id: `connection-test-${Date.now()}`,
        create_if_missing: false,
      },
      responseSchema: AnyJsonSchema,
      logger: this.logger,
    });
  }

  private isAuthFailure(result: Awaited<ReturnType<IntegrationHttpClient["request"]>>): boolean {
    return !result.ok && (result.error.status === 401 || result.error.status === 403);
  }

  /** 連携先の応答本文を切り分け材料として少しだけ残す。長い本文やHTMLは切り詰める。 */
  private summarizePartnerResponse(result: Awaited<ReturnType<IntegrationHttpClient["request"]>>): string | null {
    if (result.ok) return null;
    const body = (result.error as { body?: unknown }).body;
    if (body === undefined || body === null) return null;
    return JSON.stringify(body).slice(0, 300);
  }

  private classify(
    result: Awaited<ReturnType<IntegrationHttpClient["request"]>>,
    requestUrl: string,
    style: AuthStyle,
  ): ConnectionTestResult {
    const partnerResponse = this.summarizePartnerResponse(result);
    if (result.ok) {
      return {
        outcome: "ok",
        message:
          `送信先URLとAPIキーで応答がありました (${style} で通過)。共通顧客が見つからない旨の応答も、実在しないIDを送っているため正常です。`,
        requestUrl,
        httpStatus: 200,
        acceptedAuthStyle: style,
        partnerResponse,
      };
    }

    const status = result.error.status ?? null;
    if (status === 401 || status === 403) {
      return {
        outcome: "unauthorized",
        message:
          `APIキーが受け付けられませんでした (HTTP ${status})。x-api-key と Authorization: Bearer の両方で試して、どちらも通りませんでした。代理店システム側に登録されているキーと、こちらに保存したキーが同じか確認してください。403の場合、キー自体は認識されていて権限が無い可能性もあります。`,
        requestUrl,
        httpStatus: status,
        acceptedAuthStyle: null,
        partnerResponse,
      };
    }
    if (status === 404) {
      return {
        outcome: "not_found",
        message:
          "送信先が見つかりません (HTTP 404)。共通顧客HUB送信設定の「送信先URL」を確認してください。",
        requestUrl,
        httpStatus: status,
        acceptedAuthStyle: null,
        partnerResponse,
      };
    }
    if (result.error.kind === "timeout" || result.error.kind === "network") {
      return {
        outcome: "unreachable",
        message: `代理店システムへ接続できませんでした (${result.error.kind})。送信先URLとネットワークを確認してください。`,
        requestUrl,
        httpStatus: status,
        acceptedAuthStyle: null,
        partnerResponse,
      };
    }
    return {
      outcome: "server_error",
      message: `代理店システムがエラーを返しました${status ? ` (HTTP ${status})` : ""}。時間をおいて再実行するか、代理店システムの担当者へ連絡してください。`,
      requestUrl,
      httpStatus: status,
      acceptedAuthStyle: null,
      partnerResponse,
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
          acceptedAuthStyle: result.acceptedAuthStyle,
        },
      },
    });
  }
}
