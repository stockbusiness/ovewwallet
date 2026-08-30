// ブラウザ側のエラー収集。設定の実体は src/lib/sentry-options.ts に集約している。
import * as Sentry from "@sentry/nextjs";
import { isSentryEnabled, sentryOptions } from "./src/lib/sentry-options";

if (isSentryEnabled()) {
  Sentry.init(sentryOptions());
}
