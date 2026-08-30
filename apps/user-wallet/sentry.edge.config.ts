// Edge Runtime (middleware等) のエラー収集。現状Edgeでの処理は無いが、
// 将来middlewareを追加したときに取りこぼさないよう用意しておく。
import * as Sentry from "@sentry/nextjs";
import { isSentryEnabled, sentryOptions } from "./src/lib/sentry-options";

if (isSentryEnabled()) {
  Sentry.init(sentryOptions());
}
