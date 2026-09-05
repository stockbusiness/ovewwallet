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

会員券を扱う千ノ国マーケット (`sengoku-commerce`) は現時点で対応表に無く、
`entitlement.granted` / `entitlement.revoked` は拒否される。

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
