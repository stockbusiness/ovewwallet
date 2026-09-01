"use client";

import { GiftIcon } from "@ove/shared-ui";
import type { RewardRulePublic } from "@/lib/api";

/**
 * ホームに出す「獲得機会」カード (docs/reward-landing-url.md)。
 *
 * 出す条件は次の3つを満たすルールのうち、獲得額がいちばん大きい1件だけ。
 *
 * - **案内先が設定されている** — リンク先が無ければ誘導にならない
 * - **まだ受け取っていない** — 参加特典は1回限りのものがあり、受け取り済みの人に
 *   「もらえます」と出し続けるのは事実に反する
 *
 * 1件に絞るのは、ホームが残高確認の画面であり、獲得機会を並べる場所ではないため
 * (一覧は「ORIを貯める」にある)。
 */
export function pickEarnOpportunity(rules: RewardRulePublic[]): RewardRulePublic | null {
  const candidates = rules.filter((r) => r.landing_url && !r.already_earned);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, r) => (BigInt(r.reward_amount) > BigInt(best.reward_amount) ? r : best));
}

/** 計測用のパラメータ。設置場所ごとに変えて、どこが効いたか分かるようにする。 */
function withTracking(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}utm_source=ori_wallet&utm_medium=dashboard`;
}

export function EarnOpportunityCard({ rule }: { rule: RewardRulePublic }) {
  return (
    <a
      href={withTracking(rule.landing_url!)}
      target="_blank"
      // 遷移先から window.opener 経由でこの画面を操作されないようにする
      rel="noopener noreferrer"
      className="flex items-center gap-3 rounded-xl border border-sengoku-gold/40 bg-sengoku-navy p-4 transition-colors active:bg-sengoku-text/5"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sengoku-gold/15 text-sengoku-gold">
        <GiftIcon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-sengoku-text">{rule.display_name}</p>
        <p className="mt-0.5 text-xs text-sengoku-muted">
          参加すると <span className="font-bold text-sengoku-green">
            {Number(rule.reward_amount).toLocaleString("ja-JP")} ORI
          </span> がもらえます
        </p>
      </span>
      <span className="shrink-0 text-xs font-semibold text-sengoku-gold">参加する →</span>
    </a>
  );
}
