// PR#2最終修正 P1-2: `COLLECTIBLE_IMAGE_ALLOWED_HOSTS` (カンマ区切り) からNext.js Image
// Optimizerのremote patternsを組み立てる。未設定時は空配列 (リモート画像を一切許可しない、
// Feature Flag既定OFFと同じ「安全側に倒す」方針)。
const collectibleImageAllowedHosts = (process.env.COLLECTIBLE_IMAGE_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((hostname) => hostname.trim())
  .filter((hostname) => hostname.length > 0);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@ove/shared-ui"],
  // 本番Dockerイメージを最小化するため、必要なnode_modulesのみをトレースして
  // .next/standalone に出力させる (apps/admin-wallet/Dockerfile参照)。
  output: "standalone",
  // NFTコレクション実装指示書「画像セキュリティ」。カード画像はHTTPSのみ許可し、SVGは
  // dangerouslyAllowSVGをfalseのまま維持することで最適化経由での配信を禁止する。
  // PR#2最終修正 P1-2: 任意ホストを許可する`hostname: "**"`ワイルドカードは廃止し、
  // `COLLECTIBLE_IMAGE_ALLOWED_HOSTS`で明示された許可ホストのみに限定する。
  images: {
    remotePatterns: collectibleImageAllowedHosts.map((hostname) => ({ protocol: "https", hostname })),
    dangerouslyAllowSVG: false,
  },
};

export default nextConfig;
