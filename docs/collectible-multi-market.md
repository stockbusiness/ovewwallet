# 複数マーケットからのカード付与

`entitlement_id` の一意性を、テーブル全体から**論理Market単位**へ変えた。

## なぜ必要か

これまで `entitlement_id` は `collectible_holdings` / `collectible_entitlement_tombstones`
のテーブル全体でUNIQUEだった。これは「繋ぐマーケットが1つなのでIDが衝突しない」という
前提に依存している。

**マーケットは互いのID採番を知らない。** 2つ目のマーケットを繋ぐと、偶然同じ
`entitlement_id` を発行した瞬間に、片方のカードがもう片方に上書きされるか、付与が
拒否される。どちらも利用者から見れば「買ったカードが消えた/届かない」になる。

## 一意性の単位は論理Market

生の `source_system_key` ではなく**論理Market**で分ける。

`sennokuni-nft-market` と `sengoku-market` は**同一マーケット(千ノ国NFTマーケット)の
新旧表記**なので、生の値で分けると同じカードを二重に持ってしまう。対応表
(`ENTITLEMENT_SOURCE_SYSTEM_KEY_ALIASES`) で論理Marketへ寄せてから使う。

`source_system_key` 自体は**認証された生の値のまま残す**。監査・調査で「実際にどのキーで
届いたか」が要るため。

## 影響する箇所

| | 変更 |
|---|---|
| 一意制約 | `entitlement_id` → `(logical_market, entitlement_id)` |
| 検索 | `findByEntitlementId(logicalMarket, entitlementId)` |
| 行ロック | `WHERE logical_market = ... AND entitlement_id = ...` |
| advisory lock | `collectible_entitlement:<logical_market>:<entitlement_id>` |

advisory lock に論理Marketを含めるのは、別マーケットが同じ `entitlement_id` を採番した
とき、無関係な処理同士が直列化されて待たされるのを避けるため。

## 挙動が変わった点

**別マーケットの同じ `entitlement_id` には手を出さなくなった。**

マーケットAが付与した `X` に対して、マーケットBが `X` の取消を送ってきた場合:

- **これまで**: 全体で一意だったのでAのHoldingが見つかり、送信元不一致として403で拒否
- **これから**: Bの名前空間に `X` は無いので「revoke先行」と判断し、B側にtombstoneを
  作って2xxで応答する。**AのHoldingは触らない**

後者が正しい。BにとってのXとAにとってのXは別物であり、Bの取消がAのカードに影響しては
ならない。Bが自分の名前空間にtombstoneを作るのはBの都合であり、他に影響しない。

なお**受理していない `source_system_key`** からの取消は、引き続き拒否して監査ログ
(`COLLECTIBLE_REVOKE_SOURCE_CONFLICT`) に残す。どのマーケットのIDか決められないため、
このときだけは絞り込まずに探して記録を残している。

## 2つ目のマーケットを足すとき

1. `ENTITLEMENT_SOURCE_SYSTEM_KEY_ALIASES` に `source_system_key` → 論理Market を足す
2. **論理Marketは既存と別の値にする。** 同じ値にするとID空間を共有する前提になり、
   他方のカードを上書きしうる
3. 管理画面で共通イベントの署名鍵を発行し、先方へ渡す

## 会員券の千ノ国マーケット (2026-09-06 追加)

会員券を扱う千ノ国マーケット (`sengoku-commerce`) を、**論理Market `membership-market`
として受け付ける**。NFTアートマーケット (`nft-art-market`) とは別の値にしてある。同じに
すると ID空間を共有する前提になり、両者が同じ `entitlement_id` を採番したときに他方の
保有権を上書きしうる。

### 種類 (`kind`)

`collectible_holdings.kind` に `DIGITAL_COLLECTIBLE` (カード) と `MEMBERSHIP_PASS`
(会員券) を持つ。マーケットの `metadata.entitlement_type` を正規化した値で、
**画面で分けて出すため**にある (先方の希望、2026-09-06)。

会員券の種別値は**ウォレット側で決めてよい**と回答を得たので `MEMBERSHIP_PASS` を正式値
とした (`membership_pass` も受理する)。

**マーケットごとに受け付ける種類を絞っている** (`LOGICAL_MARKET_ALLOWED_KINDS`)。
アートマーケットの鍵で会員券が送られてきたら、送信元かカード側の設定を取り違えている。
こちら側で気づけるように400で返す。

### 有効期限

会員券には**期限のあるものと無いものがある** (先方回答)。`valid_from` / `valid_to` を
イベントで受け取り、`collectible_holdings` に保存する。未送信なら null で、期限なしとして
扱う。日付として読めない値は**拒否する** — 黙って落とすと期限なしになってしまうため。

**期限切れは日付から都度判定する** (`is_expired`)。`status` は書き換えない。取消
(`REVOKED`) と期限切れは別の事実で、時間の経過だけで状態が変わる更新を持ちたくないため。
期限切れでも保有は取り上げない (持っていた事実は残る)。

判定を日次ジョブにしなかったのは、ジョブが止まると期限切れが期限内に見えてしまうから。
都度計算なら、いつ読んでも正しい。

### 利用者の画面

`/wallet/collection` に「カード」「会員券」の切り替えを置く。一覧では期限切れを画像の上に
出し、期限があるものは日付を添える。詳細では有効期間を表示し、期限切れなら目立つ位置に
出す — 使えるつもりで持ち歩かせないため。

一覧はカーソルページングなので、絞り込みは**サーバー側**で行う
(`GET /api/v1/me/collectibles?kind=MEMBERSHIP_PASS`)。手元で絞ると「もっと見る」が
壊れる。

## 既存データの移行

マイグレーションで `logical_market` を埋めてから一意制約を張り替えている。現在受理して
いるのは上記2キーだけなので `nft-art-market` へ寄せ、それ以外が入っていた場合は生の値を
そのまま論理Market名として使う (別マーケット扱いになり、取り違えない側に倒す)。

## 動作確認

- `entitlement-identity.test.ts` (7件) — 新旧表記が同じ論理Marketへ寄ること、受理しない
  送信元では `null` になること、ロックキーがマーケットごとに別になること
- `collectible-entitlement-tombstones.repository.test.ts` (5件) — **別マーケットが同じ
  entitlement_idを採番しても衝突しないこと**、互いの記録が見えないこと
- `e2e/entitlement-events.test.ts` — 別マーケットのHoldingに手を出さないこと、
  受理しない送信元は拒否して監査ログに残すこと

### テストが無い箇所

**行ロックの絞り込み** (`WHERE logical_market = ...`) には直接のテストがない。絞りを外して
も結果は変わらず (必要以上の行をロックするだけ)、差が出るのは同時実行時の待ち合わせだけ
なので、決定的なテストが書きにくいため。誤りの現れ方は「無関係なマーケットの処理が
待たされる」であり、データが壊れる類ではない。
