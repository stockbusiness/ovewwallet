import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import "./common/bigint-json";
import { AppModule } from "./app.module";
import { LedgerExceptionFilter } from "./common/ledger-exception.filter";
import { assertAuthModeSafeForProduction } from "./common/assert-auth-mode";

async function bootstrap() {
  assertAuthModeSafeForProduction();

  const app = await NestFactory.create(AppModule);

  app.use(helmet());
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

  const port = Number(process.env.API_PORT) || 4000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`OVE Wallet API listening on port ${port} (Swagger: /api/docs)`);
}

bootstrap();
