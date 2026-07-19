# 継続ログイン/デイリーボーナス

2026-07-19実装。1アカウント・1暦日につき1回、ウォレットホーム画面から手動で
「受け取る」ボタンを押すと継続日数に応じたOVEを獲得できる。

## 仕組み

- `DailyBonusClaim`テーブル (`ove_account_id`+`claimed_date`でunique): 請求1回に
  つき1行。`streak_count`は請求時点の連続日数、`amount`は実際に付与した額を記録する
  (後でスケジュールを変更しても過去の記録は変わらない、既存の`WalletReferralBenefit`
  等と同じ設計方針)。
- 7日サイクルの固定スケジュール (`packages/api/src/daily-bonus/daily-bonus.service.ts`
  の`DAILY_BONUS_SCHEDULE`): 1・2日目=10 OVE、3・4日目=20 OVE、5・6日目=30 OVE、
  7日目=50 OVE。8日目以降は1日目からループする。
- 前日分の請求記録が無い状態 (初回、または途中で1日以上空いた場合) で請求すると
  `streak_count`は1にリセットされる。
- 台帳への計上は`transactionType: "DAILY_LOGIN_BONUS"`のCREDITとして
  `creditWallet()`を通常通り呼ぶ (`idempotencyKey: DAILY_LOGIN_BONUS:{oveAccountId}:{日付}`
  により同日の二重付与を防ぐ)。

## API

- `GET /api/v1/me/daily-bonus/status`: 請求せずに現在の状態を返す
  (`claimed_today`, `current_streak`, `next_streak`, `next_amount`)。
- `POST /api/v1/me/daily-bonus/claim`: 本日分を請求する。既に請求済みなら409を返す。
- `GET /api/v1/me/daily-bonus/history` (2026-07-19追加): 直近90日分の請求記録
  (`claimed_date`, `streak_count`, `amount`) を新しい順で返す。受け取り履歴
  カレンダー表示用。連続していない日はレコード自体が存在しない (「飛んだ日」は
  クライアント側でカレンダーのマス目が空欄になることで表現する)。

## UI

ウォレットホーム画面のランク表示直下に「継続ログインボーナス」カードを設置。
未請求なら「{n}日目・{金額} OVE」と「受け取る」ボタン、請求済みなら
「本日は受け取り済み ({streak}日連続)」と非活性ボタンを表示する。受け取り成功時は
トースト表示 + 残高を即時反映する (完全な残高再取得はしない軽量な楽観的更新)。

カードから「受け取り履歴を見る」リンクで`/wallet/daily-bonus/history`
(2026-07-19追加) に遷移できる。月単位のカレンダーグリッドで、受け取った日を
金色でハイライトし、ホバー(タップ)で連続日数・金額をツールチップ表示する。
前月・翌月ボタンで移動できるが、APIが90日分しか返さないため過去2ヶ月までに
制限している。

## 動作確認

`apps/api/src/e2e/daily-bonus.test.ts` (3件): 初回請求のstreak=1・同日2回目の409、
前日分の記録がある状態からの請求でstreakが積み上がること、受け取り履歴が
新しい順で返ることを検証済み。

2026-07-19、Playwrightによる実ブラウザ確認を実施し、「受け取る」ボタンの表示・
クリック後のトースト表示・ボタンの非活性化 (受取済み表示への切り替え) を確認した。
この確認の過程で、`wallet/page.tsx`の`claimDailyBonus()`が残高の楽観的更新で
`lifetime_credited`を更新し忘れていたためランク表示 (`docs/wallet-rank.md`) が
古い累計獲得量のまま止まって見える不具合を発見・修正した。

## 既知の制約

- 日付境界はサーバーのローカルタイムゾーン基準 (`new Date()`のgetFullYear/getMonth/
  getDate)。他の月次上限判定 (`rewards.service.ts`の`monthStart`計算) と同じ方式に
  揃えており、JST等の特定タイムゾーンを明示的に指定する仕組みは無い。
- スケジュール (何日目にいくら付与するか) はコード内の定数のみで管理しており、
  管理画面からの変更はできない (今後の課題)。
