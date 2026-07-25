import type { CollectibleHoldingStatus } from "./api";

/**
 * NFTコレクション実装指示書「Mint前後の表示文言」。ブロックチェーンMintは未実装
 * (Phase 5で戦国マーケットとの実連携を待つ) のため、Mint前は必ず
 * 「千ノ国ウォレット内で保管中」「ブロックチェーン未発行」の文言を使い、
 * 「NFT発行済み」「オンチェーン保有中」等の誤解を招く表現は使わない。
 */
export function collectibleStatusLabel(status: CollectibleHoldingStatus): { primary: string; secondary: string | null } {
  switch (status) {
    case "ACTIVE":
      return { primary: "千ノ国ウォレット内で保管中", secondary: "ブロックチェーン未発行" };
    case "MINT_READY":
    case "MINTING":
      return { primary: "NFT化準備中", secondary: "ブロックチェーン未発行" };
    case "ONCHAIN":
      return { primary: "ブロックチェーンへの登録が完了しました", secondary: null };
    case "TRANSFERRED":
      return { primary: "他のウォレットへ移転済み", secondary: null };
    case "BURNED":
      return { primary: "焼却済み", secondary: null };
    case "REVOKED":
      return { primary: "利用停止 (取消済み)", secondary: null };
    case "ERROR":
      return { primary: "処理中にエラーが発生しました", secondary: null };
    default:
      return { primary: status, secondary: null };
  }
}
