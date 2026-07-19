/**
 * 千ノ国ウォレットのロゴマーク (千輪紋: 小さな円環を輪状に並べたモチーフ + 中央にウォレットの意匠)。
 * 戦国ブランド時代の兜(KabutoMark)・城シルエットを置き換える、国を限定しない共通ロゴ。
 */
export function WalletLogo({ className }: { className?: string }) {
  const ringCount = 16;
  const rings = Array.from({ length: ringCount }, (_, i) => {
    const angle = (i / ringCount) * Math.PI * 2 - Math.PI / 2;
    const cx = 50 + 38 * Math.cos(angle);
    const cy = 50 + 38 * Math.sin(angle);
    return { cx, cy, key: i };
  });

  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      {rings.map((r) => (
        <circle key={r.key} cx={r.cx} cy={r.cy} r="6.5" fill="none" stroke="currentColor" strokeWidth="2.6" />
      ))}
      <rect x="34" y="38" width="32" height="24" rx="4" fill="none" stroke="currentColor" strokeWidth="3" />
      <path d="M34 46h32" stroke="currentColor" strokeWidth="3" />
      <circle cx="58" cy="54" r="2.6" fill="currentColor" />
    </svg>
  );
}
