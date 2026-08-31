import { TermsReconsentGate } from "@/components/TermsReconsentGate";

/**
 * ウォレット配下の全画面に規約の再同意の関門を挟む (docs/terms-consent.md)。
 * ページごとに入れると追加時に付け忘れるため、レイアウトで一括して掛ける。
 */
export default function WalletLayout({ children }: { children: React.ReactNode }) {
  return <TermsReconsentGate>{children}</TermsReconsentGate>;
}
