# 利用できるログイン方法

2026-09-01実装。稼働開始時点で使えるのは **LINEログインだけ**。他は実装または接続が
済んでいないため、既定で閉じている。

## なぜ閉じるのか

| 方法 | 状態 | 本番で開けられない理由 |
|---|---|---|
| **LINE** | ✅ 使える | `AUTH_MODE=production` で実チャネルのIDトークンを検証する。LIFF結合試験済み |
| **メールOTP** | ❌ | **メール送信基盤が実装されていない**。`EmailOtpService.issue()` はコードを生成してKVに保存するだけで、どこにも送信していない |
| **千ノ国パスポートSSO** | ❌ | 正式SSO (RS256/JWKS) が未完成。モック発行エンドポイントは本番で404 |
| **代理店SSO** | ❌ | `SENGOKU_AI_SSO_*` 未設定時は必ず検証に失敗するプレースホルダー値が入る |

### メールOTPが「動いて見える」ことに注意

`NODE_ENV` が本番以外のとき、`POST /auth/email/request-otp` は応答に `devCode` を含め、
ログイン画面がそれを表示する。**この画面表示だけが唯一のコード伝達手段**だった。

```ts
return { devCode: process.env.NODE_ENV !== "production" ? code : undefined };
```

本番にすると `devCode` は返らず、送信基盤も無いため、**コードは発行されるが誰にも
届かない**。ログイン画面にメールの選択肢を残したまま本番へ切り替えると、押しても
先に進めない導線ができてしまう。

## 有効・無効の決め方

| 環境変数 | 既定 |
|---|---|
| `ENABLE_LINE_LOGIN` | **有効** (`false` を明示したときだけ無効) |
| `ENABLE_EMAIL_LOGIN` | 無効 (`true` のときだけ有効) |
| `ENABLE_SENGOKU_PASSPORT_LOGIN` | 無効 |
| `ENABLE_AGENCY_LOGIN` | 無効 |

**LINEだけ既定で有効**にしているのは、唯一使えるログイン方法であり、設定漏れで誰も
ログインできなくなる方が害が大きいため。他はFeature Flagと同じ既定OFF
(`docs/development-guardrails.md` 13章)。

実装・接続が済んだときに**コード変更なしで開けられる**ようにするための環境変数であり、
恒久的な機能スイッチではない。

## 画面から隠すだけでなく、サーバーでも拒否する

無効な方法のエンドポイントは **404** を返す。画面の出し分けだけでは、APIを直接叩けば
動かない経路に入れてしまい、原因の分かりにくい失敗になるため。

404 にするのは「その入口は存在しない」という扱いにするため。401/403 だと「正しい
資格情報があれば通る」と読めてしまう。

| エンドポイント | 対象の方法 |
|---|---|
| `POST /auth/email/request-otp`・`/auth/email/verify-otp` | `email` |
| `POST /auth/sso/sengoku/exchange`・`/auth/sso/sengoku/dev-issue` | `sengoku_passport` |
| `POST /auth/sso/agency` | `agency` |

## 画面はサーバーの設定に従う

`GET /api/v1/auth/methods` (認証不要、真偽値のみ) が、利用できる方法を返す。

```json
{ "line": true, "email": false, "sengoku_passport": false, "agency": false }
```

ログイン画面はこれを取得してからボタンを描く。**取得できるまで何も出さない**
(使えない選択肢を一瞬でも見せないため)。取得に失敗した場合はLINEだけを出す
(ログインの道を残すため)。

ビルド時の環境変数ではなくAPIから取るのは、**設定を変えても再ビルドが要らない**
ようにするため。

## 開けるときの手順

### メールログイン

1. メール配信サービス (SendGrid / SES 等) を契約する
2. `EmailOtpService.issue()` の呼び出し元 (`AuthService.requestEmailOtp`) に送信処理を追加する
3. `ENABLE_EMAIL_LOGIN=true` を設定する

**2を飛ばして3だけ行うと、コードが誰にも届かないまま画面に選択肢が出る**ので注意。

### 千ノ国パスポートSSO / 代理店SSO

接続が完了し、`SENGOKU_AI_SSO_ISSUER` / `SENGOKU_AI_SSO_AUDIENCE` /
`SENGOKU_AI_JWKS_URL` を設定してから、対応する環境変数を `true` にする。

## テスト環境

`.env.test`・CI・Playwright では**全て有効**にしている。機能の実装そのものを検証したい
ため。既定値の検証は `login-methods` のテストが環境変数を明示的に操作して行う。

## 動作確認

- `apps/api/src/auth/login-methods.test.ts` (4件): 既定値、LINEの既定有効、他の既定無効、
  環境変数による有効化
- `apps/api/src/e2e/login-methods.test.ts` (7件): `GET /auth/methods` の内容と未ログインでの
  参照、無効な方法のエンドポイントが404になること (メール・パスポートSSO・代理店SSO)、
  LINEログインが従来どおり通ること、有効化すれば元の挙動に戻ること
