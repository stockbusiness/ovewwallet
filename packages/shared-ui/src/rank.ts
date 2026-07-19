/**
 * 累計獲得OVE (lifetime_credited) に応じた戦国ブランドの称号演出。
 * 台帳側にランク管理用のテーブルは存在せず、既存の`wallet.lifetime_credited`を
 * クライアント側で階級名に変換するだけの純粋な表示機能 (詳細: docs/wallet-rank.md)。
 */
export interface WalletRank {
  name: string;
  minLifetimeCredited: number;
}

export const WALLET_RANKS: WalletRank[] = [
  { name: "足軽", minLifetimeCredited: 0 },
  { name: "侍", minLifetimeCredited: 5000 },
  { name: "武将", minLifetimeCredited: 20000 },
  { name: "大名", minLifetimeCredited: 50000 },
  { name: "天下人", minLifetimeCredited: 100000 },
];

export function getWalletRank(lifetimeCredited: number): WalletRank {
  let current = WALLET_RANKS[0]!;
  for (const rank of WALLET_RANKS) {
    if (lifetimeCredited >= rank.minLifetimeCredited) current = rank;
  }
  return current;
}

/** 次の階級までの残り獲得OVE量。最高位に到達済みならnull。 */
export function getNextWalletRank(lifetimeCredited: number): { rank: WalletRank; remaining: number } | null {
  const currentRank = getWalletRank(lifetimeCredited);
  const currentIndex = WALLET_RANKS.indexOf(currentRank);
  const next = WALLET_RANKS[currentIndex + 1];
  if (!next) return null;
  return { rank: next, remaining: next.minLifetimeCredited - lifetimeCredited };
}
