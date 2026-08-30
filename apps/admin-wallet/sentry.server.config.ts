// サーバー側 (SSR・Route Handler) のエラー収集。
import * as Sentry from "@sentry/nextjs";
import { isSentryEnabled, sentryOptions } from "./src/lib/sentry-options";

if (isSentryEnabled()) {
  Sentry.init(sentryOptions());
}
