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
残り量を表示する。

## 動作確認

`getWalletRank`/`getNextWalletRank`のロジックは`tsx`での手動実行で境界値
(しきい値ちょうど・最高位到達時のnull)を確認済み。`packages/shared-ui`には
テストランナーが導入されていないため (`tsc --noEmit`のみ)、自動テストは追加して
いない。実ブラウザでの表示確認は未実施 (今後の課題)。
