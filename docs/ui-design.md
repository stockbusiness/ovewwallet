# UIデザインシステム「戦国ウォレット UIデザイン仕様 v1.0」

ユーザー向け10画面 (ログイン・ウォレットホーム・取引履歴一覧・取引詳細・メニュー・
連携サービス・貯める・使う・お知らせ・ログイン中の端末) と、管理画面のダッシュボード
画面を、戦国ウォレット UIデザイン仕様 v1.0 (黒・濃紺・金・深紅を基調としたデザイン) で
実装した。ダーク/ライト両モードに対応している (後述)。

## デザイントークン

`packages/shared-ui/src/tokens.ts` (実行時の固定値、グラフの線色など) と、各アプリの
`globals.css` の CSS変数 (ダーク/ライトで値を切り替える実体) の両方を正として参照する。
Tailwind設定 (`tailwind.config.ts`) 自体は両ワークスペース間でTSモジュールを直接
importせず、値を複製して保守性より安定性を優先している。

トークンは `rgb(var(--sengoku-x) / <alpha-value>)` 方式でCSS変数を参照するため、
`bg-sengoku-gold/10` のような透過度モディファイアもそのまま使える
(詳細は後述「ダーク/ライトテーマ」参照)。

| トークン名 | ダーク値 | ライト値 | 用途 |
|---|---|---|---|
| `sengoku-bg` | `#0E0E11` | `#F7F4EC` | ページ背景 |
| `sengoku-surface` | `#0B0B0D` | `#FFFFFF` | ボトムナビ等の重ね面 |
| `sengoku-navy` | `#0F1626` | `#FFFFFF` | カード背景 |
| `sengoku-navy-deep` | `#030304` | `#EFEAD9` | より濃い/淡い背景 (CastleHero空など) |
| `sengoku-red` | `#B3202A` | `#B3202A` | 重要操作・選択状態 (プライマリボタン、失効バッジ、選択中タブ) |
| `sengoku-gold` | `#D4AF37` | `#9A6F0F` | 主要アクセント (残高・獲得金額・見出しリンク) |
| `sengoku-gold-soft` | `#F5E6B3` | `#8A6A2F` | 金の淡色バリアント (単位表示など) |
| `sengoku-green` | `#35B072` | `#1E8F57` | 「獲得(CREDIT)」表示 (取引一覧・詳細で利用=赤と色分け) |
| `sengoku-text` | `#FFFFFF` | `#1A1A1A` | 本文・見出し文字 |
| `sengoku-muted` | `#BFBFBF` | `#5B5B5B` | 補助文字 |
| `sengoku-faint` | `#7A7A7A` | `#8A8A8A` | 準備中表示などの弱い文字 |
| `sengoku-border` | `#2A2A2E` | `#E3DFD3` | 境界線 |
| `sengoku-ink` | `#0F1626` (固定) | `#0F1626` (固定) | テーマに関わらず常に濃紺のまま固定したい箇所 (白背景ボタンの文字色など) |

フォントは `next/font/google` の Noto Sans JP (本文) / Noto Serif JP (見出し、
`font-heading`) を両アプリの `layout.tsx` でCSS変数として読み込んでいる。

## ダーク/ライトテーマ

2026-07-19に追加。CSS変数 + `data-theme`属性による切り替え方式:

- 各アプリの `globals.css` の `:root` にダーク値、`[data-theme="light"]` に
  ライト値を定義 (値は `"R G B"` のスペース区切り)。
- `packages/shared-ui/src/theme.ts`: `Theme`型・`THEME_STORAGE_KEY`
  (`localStorage`キー `ove-theme`)・`applyTheme()`・`getCurrentTheme()`・
  `THEME_INIT_SCRIPT`を提供。
- `THEME_INIT_SCRIPT`は各アプリの`layout.tsx`で`<head>`内に同期実行スクリプトとして
  埋め込み、ハイドレーション前に`data-theme`属性を確定させることでFOUC (テーマの
  一瞬の切り替わり) を防止する。保存済みの選択が無ければOSの`prefers-color-scheme`に従う。
  `layout.tsx`の`<html>`には`suppressHydrationWarning`を設定 (スクリプトによる
  属性書き換えとReactのハイドレーションの不一致を許容するため)。
- `ThemeToggle`コンポーネント (後述) をウォレットホーム・ログイン画面・管理
  ダッシュボードのヘッダーに設置し、ユーザーがいつでも切り替えられる。
- CastleHero (ログイン画面の山並み装飾) は`--hero-sky`/`--hero-mountain-back`/
  `--hero-mountain-front`という専用トークンを持ち、ダークでは夜の山並み、ライトでは
  朝焼けの山並みに配色が変わる。

## 共通コンポーネント (`packages/shared-ui`)

pnpmワークスペースパッケージとして追加し、両アプリの `next.config.mjs` に
`transpilePackages: ["@ove/shared-ui"]` を設定してTSソースのまま利用している
(ビルドステップなし)。Tailwindの content にも `packages/shared-ui/src` を追加し、
クラス名がスキャン対象になるようにしている。

- `BalanceCard` — 残高強調カード (ウォレットホーム・管理ダッシュボードで使用、金枠グロー+城シルエット装飾)
- `TransactionItem` — 取引1行 (アイコン・タイトル・金額・方向で色分け、獲得=緑/利用=赤)
- `PrimaryButton` / `SecondaryButton` — 深紅塗り / 金縁取りのボタン
- `BottomNavigation` — スマートフォン下部固定ナビ (未実装リンクタップ時は「準備中」トーストを表示、無反応にはしない)
- `SectionHeader` — セクション見出し + 「すべて見る」導線
- `StatusBadge` — 状態ピル (success=金塗り, warning=金縁取り, danger=深紅塗り, neutral=枠線, credit=緑塗り)
- `ServiceLinkCard` — クイックアクション/連携サービスカード (現在は未使用、削除はしていない)
- `AppHeader` — ウォレットホーム等の共通ヘッダー (左: ロゴ/戻る、右: 任意のアクション領域)
- `ActionGrid` — 「貯める/使う/履歴/連携サービス」等の2〜4項目グリッド。`href`未指定の項目は
  タップ時に「準備中」トーストを表示するボタンとして描画する
- `InfoCard` — お知らせ・案内表示用の1件カード (タイトル・本文・日付・「すべて見る」導線)
- `AuthButton` — ログイン画面の各認証方式ボタン (LINE/メール/戦国パスポートIDで配色・アイコンを出し分け)
- `ThemeToggle` — ダーク/ライト切り替えボタン (`theme.ts`の`applyTheme()`/`getCurrentTheme()`を使用)
- `icons.tsx` — 独自SVGアイコン一式 (元画像やLINE公式ロゴを複製しない、線画ベースの自作アイコン。`SunIcon`/`MoonIcon`/`MailIcon`等を含む)
- `transaction-status.ts` — 取引ステータス→日本語ラベル・バッジ色調の共通マッピング、連携サービスコード→表示名マッピング (`SERVICE_CODE_LABEL`)
- `theme.ts` — ダーク/ライトテーマの型・切り替え・初期化スクリプト (前節参照)

## 対象画面と実データ接続

| 画面 | パス | 使用API |
|---|---|---|
| ログイン | `apps/user-wallet` `/login` | `POST /api/v1/auth/{email,line,sso/sengoku}/...` (すべて実装済みAPIに接続) |
| ウォレットホーム | `/wallet` | `GET /api/v1/accounts/me`, `GET /api/v1/me/wallet`, `GET /api/v1/me/transactions?limit=5`, `GET /api/v1/me/notices`, `GET /api/v1/me/wallet/holds` (お知らせ・保留内訳は補助情報として別try/catchで取得、失敗してもホーム自体は表示) |
| 取引履歴一覧 | `/wallet/transactions` | `GET /api/v1/me/transactions?limit=100` (クライアント側で獲得/利用/失効フィルタ) |
| 取引詳細 | `/wallet/transactions/[transactionId]` | `GET /api/v1/me/transactions/:transactionId` |
| メニュー | `/wallet/menu` | `GET /api/v1/accounts/me`, `GET /api/v1/me/wallet`, `POST /api/v1/auth/logout` |
| 連携サービス | `/wallet/services` | **新設** `GET /api/v1/me/linked-services` |
| 貯める | `/wallet/earn` | **新設** `GET /api/v1/rewards/public` (公開付与ルール一覧) |
| 使う | `/wallet/use` | `GET /api/v1/me/wallet`, **新設** `GET /api/v1/me/linked-services` |
| お知らせ一覧 | `/wallet/notices` | **新設** `GET /api/v1/me/notices` |
| 管理ダッシュボード | `apps/admin-wallet` `/dashboard` | 既存API + `GET /api/v1/admin/dashboard-stats` (総アカウント数・本日付与/利用OVE・過去30日推移) |
| お知らせ管理 | `apps/admin-wallet` `/notices` | **新設** `GET/POST /api/v1/admin/notices`, `POST /api/v1/admin/notices/:id/archive` |

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
既存の管理画面共通ナビ (`AdminNav`, 全16画面で共用、ライトテーマの横並びナビ) は
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

後発の6画面 (メニュー・連携サービス・貯める・使う・お知らせ一覧・ログイン中の端末) は、
上記4画面と同じ`ActionGrid`/`BottomNavigation`/共通トークンの組み合わせで実装している
ためレイアウト構造上のリスクは低いと判断し、375px幅でのスクリーンショット確認のみ
実施した。768px/1280pxでの個別確認・および管理画面の「お知らせ管理」画面の
1280px確認は未実施 (今後の課題)。
