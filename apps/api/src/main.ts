import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import "./common/bigint-json";
import { AppModule } from "./app.module";
import { LedgerExceptionFilter } from "./common/ledger-exception.filter";
import { assertAuthModeSafeForProduction } from "./common/assert-auth-mode";
import { assertProductionEnvSafe } from "./common/assert-production-env";
import { initSentry } from "./common/sentry";

async function bootstrap() {
  assertAuthModeSafeForProduction();
  assertProductionEnvSafe();
  // SENTRY_DSN未設定時は何もしない (`docs/monitoring.md` 参照)。
  initSentry();

  // rawBody: true (共通イベントHMAC署名検証用)。仕様書「受信bodyを再serializeせずraw bodyを
  // 使う」に対応するため、Nest標準のbody-parserにverifyコールバックを追加させ`req.rawBody`
  // (Buffer)を取得できるようにする (`common-event-auth.guard.ts`参照)。
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // helmetのデフォルトはCross-Origin-Resource-Policy: same-originを付与し、
  // CORSでオリジンを許可していても別オリジンからのfetchをブラウザ側で
  // ブロックしてしまう。このAPIはVercel上の別オリジンのフロントエンドから
  // 呼ばれる構成のため、cross-originを許可する。
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(cookieParser());
  const allowedOrigins = [process.env.APP_URL, process.env.ADMIN_URL].filter(
    (v): v is string => Boolean(v),
  );
  app.enableCors({ origin: allowedOrigins, credentials: true });
  app.useGlobalFilters(new LedgerExceptionFilter());

  const config = new DocumentBuilder()
    .setTitle("OVE Wallet API")
    .setDescription("独立OVEウォレットサービス外部/内部API")
    .setVersion("0.1.0")
    .addCookieAuth("ove_session")
    .addApiKey({ type: "apiKey", name: "X-OVE-Api-Key", in: "header" }, "external-api-key")
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api/docs", app, document);

  // RailwayなどのPaaSはサービスごとに`PORT`を自動注入し、そのポートで
  // リッスンしていないとヘルスチェック/エッジプロキシがコンテナに到達できない。
  // `PORT`を最優先し、未設定時のみ独自の`API_PORT`(ローカル開発用)にフォールバックする。
  const port = Number(process.env.PORT) || Number(process.env.API_PORT) || 4000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`OVE Wallet API listening on port ${port} (Swagger: /api/docs)`);
}

bootstrap();
