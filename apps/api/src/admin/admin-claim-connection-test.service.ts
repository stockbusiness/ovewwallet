import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { generateId, type PrismaClient } from "@ove/database";
import { z } from "zod";
import { PRISMA } from "../common/prisma.module";
import { IntegrationHttpClient } from "../integrations/integration-http-client";
import {
  buildSignedHeaders,
  resolveMarketClaimConfigIgnoringFlag,
  type MarketClaimConfig,
} from "../integrations/sengoku-market-claim.adapter";

/** 連携先が何を返しても診断できるよう、形は問わずに受ける。 */
const AnyJsonSchema = z.unknown();

export type ClaimConnectionTestOutcome =
  | "ok"
  | "token_not_found"
  | "endpoint_not_found"
  | "unauthorized"
  | "unreachable"
  | "server_error"
  | "not_configured";

export interface ClaimConnectionTestResult {
  outcome: ClaimConnectionTestOutcome;
  /** 管理画面にそのまま出す説明。原因と次にやることを含める。 */
  message: string;
  /** 実際に叩いた先 (鍵は含めない)。 */
  requestUrl: string | null;
  httpStatus: number | null;
  /** 連携先が返した本文の抜粋 (先頭300文字)。原因の切り分け用。 */
  partnerResponse: string | null;
}

/**
 * 管理画面の「カード受取の接続テスト」。保存済みの接続先と鍵で千ノ国マーケットの
 * Claim状態照会APIを実際に叩き、**生のHTTPステータスと応答本文をそのまま見せる**。
 *
 * 受取ページ (`/claim/{token}`) は、設定不足・通信エラー・先方401・応答形式不正を
 * **すべて503にまとめてしまう** (get-claim-overview.use-case.ts の default節)。
 * 利用者に理由を見せない設計としては妥当だが、運用者が原因を追えない。実際に
 * 「404が返るが、トークンが無いのか経路が無いのか分からない」という切り分けで
 * 詰まったため (2026-09-26)、その判別をこの画面だけで済むようにする。
 *
 * Feature Flagは見ない。開ける**前**に設定の正しさを確認できることが目的
 * (代理店の `AdminAgencyConnectionTestService` と同じ方針)。
 */
@Injectable()
export class AdminClaimConnectionTestService {
  private readonly logger = new Logger(AdminClaimConnectionTestService.name);

  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly http: IntegrationHttpClient,
  ) {}

  /**
   * `token` を省略すると実在しないダミーを使う。**実トークンを指定できる**のは、
   * 「この1件だけ受け取れない」という調査がいちばん多いため。照会のみで
   * 確定はしないので、指定しても受取は進まない。
   */
  async run(adminId: string, token?: string): Promise<ClaimConnectionTestResult> {
    const config = resolveMarketClaimConfigIgnoringFlag();
    if (!config) {
      return {
        outcome: "not_configured",
        message:
          "接続先が未設定です。SENGOKU_MARKET_CLAIM_BASE_URL / _KEY_ID / _HMAC_SECRET の3つが揃って初めて有効になります。1つでも空だとこのテストは送信自体を行いません。",
        requestUrl: null,
        httpStatus: null,
        partnerResponse: null,
      };
    }

    const rawToken = token?.trim() || `connection-test-${randomUUID()}`;
    const path = `/api/collectible-claims/${encodeURIComponent(rawToken)}`;
    const requestUrl = `${config.baseUrl}${path}`;
    const result = await this.probe(config, path);

    const classified = this.classify(result, requestUrl, Boolean(token?.trim()));
    await this.writeAudit(adminId, config, classified);
    return classified;
  }

  /** 状態照会 (GET) だけを行う。確定 (POST .../confirm) は叩かないので副作用は無い。 */
  private async probe(
    config: MarketClaimConfig,
    path: string,
  ): Promise<Awaited<ReturnType<IntegrationHttpClient["request"]>>> {
    const correlationId = randomUUID();
    return this.http.request({
      baseUrl: config.baseUrl,
      path,
      method: "GET",
      extraHeaders: buildSignedHeaders({
        keyId: config.keyId,
        secret: config.hmacSecret,
        method: "GET",
        path,
        rawBody: "",
        correlationId,
      }),
      correlationId,
      timeoutMs: 5000,
      responseSchema: AnyJsonSchema,
      logger: this.logger,
    });
  }

  /** 連携先の応答本文を切り分け材料として少しだけ残す。長い本文やHTMLは切り詰める。 */
  private summarizePartnerResponse(
    result: Awaited<ReturnType<IntegrationHttpClient["request"]>>,
  ): string | null {
    if (result.ok) return null;
    const body = result.error.body;
    if (body === undefined || body === null) return null;
    return JSON.stringify(body).slice(0, 300);
  }

  private classify(
    result: Awaited<ReturnType<IntegrationHttpClient["request"]>>,
    requestUrl: string,
    usedRealToken: boolean,
  ): ClaimConnectionTestResult {
    const partnerResponse = this.summarizePartnerResponse(result);
    if (result.ok) {
      return {
        outcome: "ok",
        message: usedRealToken
          ? "このトークンの受取情報を取得できました。接続・署名ともに問題ありません。"
          : "接続と署名は問題ありません。実在しないトークンを送ったにもかかわらず200が返っている点は、先方の実装をご確認ください。",
        requestUrl,
        httpStatus: 200,
        partnerResponse,
      };
    }

    const status = result.error.status ?? null;
    if (status === 401 || status === 403) {
      return {
        outcome: "unauthorized",
        message: `署名が受け付けられませんでした (HTTP ${status})。key_id / secret が先方の登録値と一致しているか、サーバーの時刻がずれていないか (許容±5分) を確認してください。`,
        requestUrl,
        httpStatus: status,
        partnerResponse,
      };
    }
    if (status === 404) return this.classifyNotFound(requestUrl, partnerResponse, usedRealToken);
    if (status === 410) {
      return {
        outcome: "token_not_found",
        message:
          "このトークンは期限切れです (HTTP 410)。接続と署名は通っているので、設定の問題ではありません。",
        requestUrl,
        httpStatus: status,
        partnerResponse,
      };
    }
    if (result.error.kind === "timeout" || result.error.kind === "network") {
      return {
        outcome: "unreachable",
        message: `先方へ接続できませんでした (${result.error.kind})。SENGOKU_MARKET_CLAIM_BASE_URL の綴り (末尾スラッシュを付けていないか) とネットワークを確認してください。`,
        requestUrl,
        httpStatus: status,
        partnerResponse,
      };
    }
    return {
      outcome: "server_error",
      message: `先方がエラーを返しました${status ? ` (HTTP ${status})` : ""}。時間をおいて再実行するか、下の「連携先の応答」を添えて先方へ連絡してください。`,
      requestUrl,
      httpStatus: status,
      partnerResponse,
    };
  }

  /**
   * 404は原因が2つあり、**受取ページからは区別できない**のでここで分ける。
   * 本文に契約の`CLAIM_TOKEN_INVALID`があればトークン側の話、無ければ経路自体が
   * 無い疑い (先方が状態照会APIを未実装、URLの綴り違い等)。
   */
  private classifyNotFound(
    requestUrl: string,
    partnerResponse: string | null,
    usedRealToken: boolean,
  ): ClaimConnectionTestResult {
    if (partnerResponse?.includes("CLAIM_TOKEN_INVALID")) {
      return {
        outcome: "token_not_found",
        message: usedRealToken
          ? "先方が「このトークンは無効」と回答しました。接続と署名は通っているので設定の問題ではありません。トークンが使用済みでないか、発行元の環境が本番かを先方にご確認ください。"
          : "接続と署名は問題ありません。実在しないトークンを送ったので、無効と返るのが正しい結果です。",
        requestUrl,
        httpStatus: 404,
        partnerResponse,
      };
    }
    return {
      outcome: "endpoint_not_found",
      message:
        "404が返りましたが、契約のエラーコード (CLAIM_TOKEN_INVALID) が本文にありません。**経路自体が無い可能性**があります。先方が GET /api/collectible-claims/{token} を実装済みか (確定用の POST .../confirm だけになっていないか)、URLの綴りが正しいかを確認してください。",
      requestUrl,
      httpStatus: 404,
      partnerResponse,
    };
  }

  /** 本番の鍵を使う外部への発信なので、誰がいつ実行したかを残す。鍵は記録しない。 */
  private async writeAudit(
    adminId: string,
    config: MarketClaimConfig,
    result: ClaimConnectionTestResult,
  ): Promise<void> {
    await this.db.auditLog.create({
      data: {
        id: generateId(),
        actorType: "ADMIN",
        actorId: adminId,
        actionType: "COLLECTIBLE_CLAIM_CONNECTION_TEST",
        targetType: "market_claim_config",
        targetId: "default",
        result: result.outcome === "ok" || result.outcome === "token_not_found" ? "SUCCESS" : "FAILURE",
        afterData: {
          baseUrl: config.baseUrl,
          keyId: config.keyId,
          outcome: result.outcome,
          httpStatus: result.httpStatus,
        },
      },
    });
  }
}
