/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@ove/shared-ui"],
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
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
    dangerouslyAllowSVG: false,
  },
};

export default nextConfig;
