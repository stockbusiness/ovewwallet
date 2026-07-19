# お知らせのLINE配信連携

2026-07-19実装。管理画面でお知らせを公開すると、LINE Messaging APIの
[broadcast](https://developers.line.biz/ja/reference/messaging-api/#send-broadcast-message)
(このMessaging APIチャネルを友だち追加した全ユーザーへの一斉配信) でも同じ内容を
テキストメッセージとして配信する。

## 実装

- `apps/api/src/notices/line-broadcast.service.ts` の `LineBroadcastService`。
  `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN` 未設定時は何もしない
  (`SENTRY_DSN`未設定時のno-opと同じ方針)。
- `AdminNoticesService.create()` がお知らせ作成後に呼び出す。LINE配信が失敗しても
  お知らせ作成自体は失敗させない (`wallet/page.tsx`のお知らせ取得を本体データ取得と
  別try/catchにしているのと同じ「補助的な機能は本体を巻き込まない」方針)。失敗時は
  ログに警告を出すのみ。
- 配信するテキストは `【お知らせ】{title}\n{message}` (LINEのテキストメッセージ上限
  5000文字に切り詰める)。

## 既知の制約

- **配信対象はLINE公式アカウントの友だち全員**であり、OVEウォレットの利用者や
  LINEログイン済みユーザーとは必ずしも一致しない (LINE Messaging APIの仕組み上の
  制約)。個別ユーザー宛のpush/multicastを使うには、対象ユーザーのLINEユーザーID
  (`account_identities`の`identityType=LINE`の`providerSubject`) を使って
  `/v2/bot/message/push`または`/v2/bot/message/multicast`へ切り替える必要があるが、
  お知らせは全体告知が主目的のため今回はbroadcastを採用した。
- LINE Login用のチャネル (`LINE_CHANNEL_ID`) とMessaging API用のチャネル
  (`LINE_MESSAGING_CHANNEL_ACCESS_TOKEN`が対応するチャネル) は別物であり、
  同じLINE公式アカウント/プロバイダーに属していても、Messaging API用の
  チャネルアクセストークンは別途LINE Developersコンソールで発行する必要がある。
- 実際のLINE Messaging APIチャネルを使った結合テストは未実施 (単体テストで
  `fetch`をモックした範囲のみ検証済み、`apps/api/src/notices/line-broadcast.service.test.ts`)。
  2026-07-19、Playwrightによる実ブラウザ確認では`LINE_MESSAGING_CHANNEL_ACCESS_TOKEN`
  未設定の環境で重要度`IMPORTANT`のお知らせ作成を実行し、no-op経路でエラーなく
  お知らせ作成自体が成功することを確認した。実際のLINEチャネルへの配信確認は
  引き続き未実施。

## 設定

`.env` に `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN` を設定する
(`.env.example`参照)。未設定なら従来通りアプリ内お知らせのみで、LINEへの配信は
スキップされる。
