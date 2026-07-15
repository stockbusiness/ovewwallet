# UIデザインシステム「戦国ウォレット UIデザイン仕様 v1.0」

ユーザー向け4画面 (ログイン・ウォレットホーム・取引履歴一覧・取引詳細) と、管理画面の
ダッシュボード画面を、戦国ウォレット UIデザイン仕様 v1.0 (黒・濃紺・金・深紅を基調と
したデザイン) で実装した。

## デザイントークン

`packages/shared-ui/src/tokens.ts` を正とし、両アプリの `tailwind.config.ts` の
`theme.extend.colors.sengoku` に同じ値を定義している (Tailwind設定ファイル自体は
ワークスペース間でTSモジュールを直接importせず、値を複製して保守性より安定性を優先した)。

| トークン名 | 値 | 用途 |
|---|---|---|
| `sengoku-bg` | `#0E0E11` | ページ背景 |
| `sengoku-surface` | `#0B0B0D` | ボトムナビ等の重ね面 |
| `sengoku-navy` | `#0F1626` | カード背景 |
| `sengoku-red` | `#B3202A` | 重要操作・選択状態 (プライマリボタン、失効バッジ、選択中タブ) |
| `sengoku-gold` | `#D4AF37` | 主要アクセント (残高・獲得金額・見出しリンク) |
| `sengoku-gold-soft` | `#F5E6B3` | 金の淡色バリアント (単位表示など) |
| `sengoku-muted` | `#BFBFBF` | 補助文字 |
| `sengoku-faint` | `#7A7A7A` | 準備中表示などの弱い文字 |
| `sengoku-border` | `#2A2A2E` | 境界線 |

フォントは `next/font/google` の Noto Sans JP (本文) / Noto Serif JP (見出し、
`font-heading`) を両アプリの `layout.tsx` でCSS変数として読み込んでいる。

## 共通コンポーネント (`packages/shared-ui`)

pnpmワークスペースパッケージとして追加し、両アプリの `next.config.mjs` に
`transpilePackages: ["@ove/shared-ui"]` を設定してTSソースのまま利用している
(ビルドステップなし)。Tailwindの content にも `packages/shared-ui/src` を追加し、
クラス名がスキャン対象になるようにしている。

- `BalanceCard` — 残高強調カード (ウォレットホーム・管理ダッシュボードで使用)
- `TransactionItem` — 取引1行 (アイコン・タイトル・金額・方向で色分け)
- `PrimaryButton` / `SecondaryButton` — 深紅塗り / 金縁取りのボタン
- `BottomNavigation` — スマートフォン下部固定ナビ
- `SectionHeader` — セクション見出し + 「すべて見る」導線
- `StatusBadge` — 状態ピル (success=金塗り, warning=金縁取り, danger=深紅塗り, neutral=枠線)
- `ServiceLinkCard` — クイックアクション/連携サービスカード
- `icons.tsx` — 独自SVGアイコン一式 (元画像やLINE公式ロゴを複製しない、線画ベースの自作アイコン)
- `transaction-status.ts` — 取引ステータス→日本語ラベル・バッジ色調の共通マッピング

## 対象画面と実データ接続

| 画面 | パス | 使用API |
|---|---|---|
| ログイン | `apps/user-wallet` `/login` | `POST /api/v1/auth/{email,line,sso/sengoku}/...` (すべて実装済みAPIに接続) |
| ウォレットホーム | `/wallet` | `GET /api/v1/accounts/me`, `GET /api/v1/wallets/:id/balance`, `.../transactions` |
| 取引履歴一覧 | `/wallet/transactions` | 上記 `.../transactions` (クライアント側で獲得/利用/失効フィルタ) |
| 取引詳細 | `/wallet/transactions/[transactionId]` | **新設** `GET /api/v1/wallets/:oveAccountId/transactions/:transactionId` |
| 管理ダッシュボード | `apps/admin-wallet` `/dashboard` | 既存API + **新設** `GET /api/v1/admin/dashboard-stats` (総アカウント数・本日付与/利用OVE・過去30日推移) |

残高・取引履歴・ダッシュボードの集計値はすべて実際のDBから取得した値であり、固定値は
一切使用していない (指示書の禁止事項に準拠)。

### LINE / 戦国パスポートIDログインの扱い

`apps/api` 側は指示書10章の通りLINE IDトークン検証・戦国パスポートSSOコード交換を
**モック実装**している (本番のLINE Login SDK・戦国パスポート側リダイレクトは未接続)。
UI側もこの制約に合わせ、ブラウザのlocalStorageに保存した擬似ユーザーIDで
`mock.<id>` 形式のIDトークンを送るモック接続とした (コード内に明記)。本番連携時は
このモック送信部分をLINE Login SDK / 実SSOリダイレクトへ差し替える。

### 取引種別アイコンについて

`TransactionItem` のアイコンは、指示書の禁止事項 (アイコンを画像化しない) に従い、
`direction` (CREDIT/DEBIT) に基づき自作SVGアイコン (ギフト/カート) を出し分けている。
取引種別ごとの個別アイコン割り当ては今後の拡張課題。

## 管理ダッシュボードのスコープ

「PC向け管理ダッシュボード」として指示書で明示された対象は `/dashboard` 画面のみ。
既存の管理画面共通ナビ (`AdminNav`, 全12画面で共用、ライトテーマの横並びナビ) は
対象外のため変更していない。そのため `/dashboard` の**コンテンツ領域のみ**を
戦国ウォレットの配色に刷新しており、ナビゲーションバー自体は従来のライトテーマの
ままである。

**既知の制約**: `AdminNav` は元々レスポンシブ設計ではなく、375px幅では横スクロールが
発生する。管理画面のレスポンシブ対象は指示書上「PC管理画面：1280px以上」のみであり、
`/dashboard` のコンテンツ領域自体は1280/768pxで崩れなく表示されることを確認済み
(375pxでの崩れは `AdminNav` 側の既存制約であり、今回のスコープ外)。

## 折れ線グラフ (OVE発行・利用推移)

外部チャートライブラリを追加せず、インラインSVGで自作した (`TrendChart.tsx`,
`apps/admin-wallet/src/app/dashboard/`)。発行OVE=金、利用OVE=深紅の2系列固定色、
2px線・端点マーカー・直近値のダイレクトラベル・ホバー時のクロスヘア&ツールチップを
実装。データは `GET /api/v1/admin/dashboard-stats` が返す過去30日分の実データのみで
描画しており、固定値は使用していない。

配色は dataviz スキルの `validate_palette.js` で検証したところ、金は暗背景での
輝度バンド、深紅は背景とのコントラスト比の両方で自動チェックには抵触した
(指示書で固定された8色のみを使うという制約上、グラフ専用の色調整版を新設しなかった
ため)。その代わり、direct label (線端の数値表示)・凡例・ホバーツールチップを必須で
表示することで、色だけに依存しない可読性を確保している。

## レスポンシブ確認

Playwrightで実際に本番ビルドを起動し、375px/768px/1280pxの3ブレークポイントで
5画面すべてをスクリーンショット確認した。ユーザー向け4画面は `max-w-md` で
スマートフォン幅に固定されるため、768px/1280pxでも中央にモバイル幅のカードとして
表示される (指示書の「スマートフォン表示を優先する」に対応)。ボトムナビと
最下部コンテンツの重なりがないことも、実際のDOM座標を計測して確認済み。
