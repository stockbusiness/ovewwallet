# 累計獲得OVEに応じたランク/称号表示

2026-07-19実装。既存の`wallet.lifetime_credited` (`GET /api/v1/me/wallet`が返す
`lifetime_credited`) を、戦国ブランドの階級名に変換して表示するだけの純粋な
表示機能。新しいAPI・DBテーブルは追加していない。

## 階級テーブル (`packages/shared-ui/src/rank.ts`)

| 階級 | 累計獲得OVEのしきい値 |
|---|---|
| 足軽 | 0 |
| 侍 | 5,000 |
| 武将 | 20,000 |
| 大名 | 50,000 |
| 天下人 | 100,000 |

`getWalletRank(lifetimeCredited)`が現在の階級を、`getNextWalletRank(lifetimeCredited)`
が次の階級までの残り必要獲得量を返す (最高位到達済みなら`null`)。しきい値は
コード内の定数のみで管理しており、管理画面からの変更はできない (今後の課題)。

## UI

`RankBadge`共通コンポーネント (`packages/shared-ui/src/components/RankBadge.tsx`) を
ウォレットホーム画面のBalanceCard直下に設置。現在の階級・累計獲得OVE・次の階級までの
残り量を表示する。2026-07-19、次の階級までの到達度を視覚的に示すプログレスバーを
追加した (`(lifetimeCredited - 現在の階級のしきい値) / (次の階級のしきい値 - 現在の
階級のしきい値)`で算出、最高位到達済みなら100%)。

## 動作確認

`getWalletRank`/`getNextWalletRank`のロジックは`tsx`での手動実行で境界値
(しきい値ちょうど・最高位到達時のnull)を確認済み。`packages/shared-ui`には
テストランナーが導入されていないため (`tsc --noEmit`のみ)、自動テストは追加して
いない。

2026-07-19、Playwrightによる実ブラウザ確認を実施し、初期状態で「足軽」と表示される
ことを確認した。その過程で、**継続ログインボーナス受け取り後にランク表示の
累計獲得量が古いまま更新されない不具合**を発見した (`docs/daily-login-bonus.md`
参照)。`wallet/page.tsx`の`claimDailyBonus()`が`available_balance`のみを
楽観的に更新し`lifetime_credited`を更新していなかったことが原因で、修正済み。

## 管理画面: 会員ランク分布 (2026-07-19追加)

`GET /api/v1/admin/dashboard-stats/rank-distribution`: 全ウォレットの
`lifetime_credited`を階級ごとに集計し、階級名と人数の配列を返す。管理ダッシュボード
(`/dashboard`) に横棒グラフで表示する (`apps/admin-wallet/src/app/dashboard/RankDistribution.tsx`)。

しきい値テーブル (`WALLET_RANK_THRESHOLDS`, `apps/api/src/admin/admin.service.ts`) は
`packages/shared-ui/src/rank.ts`の`WALLET_RANKS`と同じ値を持つ独立した定義。バックエンドを
Reactコンポーネント込みのUIパッケージに依存させたくないための意図的な重複であり、
階級を追加・変更する場合は両方を更新する必要がある (今後の課題: 共通パッケージへの
切り出し)。

`apps/api/src/e2e/rank-distribution.test.ts` (1件): 6,000 OVE付与後のウォレットが
「侍」に計上されること、全階級の人数合計が総ウォレット数と一致することを検証済み。
実ブラウザでの確認は未実施 (今後の課題)。
