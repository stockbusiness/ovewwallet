// PR#2最終修正 P1-2: `COLLECTIBLE_IMAGE_ALLOWED_HOSTS` (カンマ区切り) からNext.js Image
// Optimizerのremote patternsを組み立てる。未設定時は空配列 (リモート画像を一切許可しない、
// Feature Flag既定OFFと同じ「安全側に倒す」方針)。
const collectibleImageAllowedHosts = (process.env.COLLECTIBLE_IMAGE_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((hostname) => hostname.trim())
  .filter((hostname) => hostname.length > 0);

import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@ove/shared-ui"],
  // src/instrumentation.ts (サーバー/Edge用のSentry初期化) を有効にする。
  // Next.js 14 では明示的な指定が必要 (15以降は既定で有効)。
  experimental: { instrumentationHook: true },
  // Sentryのトレース・デバッグ用コードをビルド時に落とす。`tracesSampleRate: 0`で
  // トレースは使わない方針 (src/lib/sentry-options.ts) のため、その分のバイトを
  // スマートフォン優先のこのアプリで配る理由がない。
  webpack: (config, { webpack }) => {
    config.plugins.push(
      new webpack.DefinePlugin({ __SENTRY_DEBUG__: false, __SENTRY_TRACING__: false }),
    );
    return config;
  },
  // 本番Dockerイメージを最小化するため、必要なnode_modulesのみをトレースして
  // .next/standalone に出力させる (apps/user-wallet/Dockerfile参照)。
  output: "standalone",
  // ブラウザからのAPI呼び出し(/api/*)を、このアプリ自身と同一オリジンに見せかけて
  // 実際のAPI(NEXT_PUBLIC_API_URL、Vercel↔Railwayの別ドメイン構成)へ転送する。
  // iOS Safari/WebKitのIntelligent Tracking Prevention(ITP)がクロスサイトの
  // セッションCookie(SameSite=None)を制限し、ログインAPI自体は成功するのに
  // 直後の/walletでのAPI呼び出しがCookie未送信で401になり、ログイン画面へ
  // 差し戻される不具合を実チャネルで確認した(2026-07-18)。同一オリジンに
  // 見せることでこの制限を回避する (apps/user-wallet/src/lib/api.tsは相対パスで
  // 呼び出す設計に変更済み)。NEXT_PUBLIC_API_URL未設定時はリライト自体を無効化する。
  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    if (!apiUrl) return [];
    return [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }];
  },
  // NFTコレクション実装指示書「画像セキュリティ」。カード画像はHTTPSのみ許可し
  // (httpのホストは列挙しない)、SVGはNext.js Image Optimizerの既定挙動通り
  // 最適化を無効化させない限り配信できない(dangerouslyAllowSVGを明示的にfalseのまま維持)。
  // PR#2最終修正 P1-2: 任意ホストを許可する`hostname: "**"`ワイルドカードは廃止し、
  // `COLLECTIBLE_IMAGE_ALLOWED_HOSTS`で明示された許可ホストのみに限定する。
  images: {
    remotePatterns: collectibleImageAllowedHosts.map((hostname) => ({ protocol: "https", hostname })),
    dangerouslyAllowSVG: false,
  },
};

// Sentryのビルド時処理 (ソースマップのアップロード等) は、DSNを設定したときだけ有効に
// する。未設定のまま`withSentryConfig`を通すとビルド手順だけが増えて得るものが無く、
// DSNを払い出すまでは現状とまったく同じビルドにしたいため。
// ソースマップのアップロードには別途`SENTRY_AUTH_TOKEN`が必要で、未設定なら
// アップロードだけがスキップされる (ビルドは成功する)。
export default process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: true,
      // クライアント側のソースマップを広めに収集し、minifyされたスタックトレースを
      // 元のコードに対応付けられるようにする。
      widenClientFileUpload: true,
      disableLogger: true,
    })
  : nextConfig;
