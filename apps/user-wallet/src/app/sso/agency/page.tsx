import { Suspense } from "react";
import type { Metadata } from "next";
import { AgencySsoCallback } from "@/components/AgencySsoCallback";

/**
 * 代理店システム(sengoku-ai.com)のSSO受信URL。連携先の
 * `https://sengoku-ai.com/agent/sso_launch.php?client=orly-wallet` から
 * `?token={JWT}` 付きでリダイレクトされてくる (連携先回答 2026-09-04)。
 *
 * URLに生のJWTが載るため、Refererでの流出を防ぎ、検索エンジンにも載せない。
 */
export const metadata: Metadata = {
  title: "代理店ログイン | 千ノ国ウォレット",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function AgencySsoPage() {
  // useSearchParams()を使うクライアントコンポーネントはSuspense境界を要求する
  // (login/page.tsxと同じ理由)。
  return (
    <Suspense fallback={null}>
      <AgencySsoCallback />
    </Suspense>
  );
}
