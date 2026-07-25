/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@ove/shared-ui"],
  // 本番Dockerイメージを最小化するため、必要なnode_modulesのみをトレースして
  // .next/standalone に出力させる (apps/admin-wallet/Dockerfile参照)。
  output: "standalone",
  // NFTコレクション実装指示書「画像セキュリティ」。カード画像はHTTPSのみ許可し、SVGは
  // dangerouslyAllowSVGをfalseのまま維持することで最適化経由での配信を禁止する。
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
    dangerouslyAllowSVG: false,
  },
};

export default nextConfig;
