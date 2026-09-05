# 利用できるログイン方法

2026-09-01実装。稼働開始時点で使えるのは **LINEログインだけ**だった。他は実装または
接続が済んでいないため、既定で閉じている。

2026-09-04に**代理店SSOを接続**した。ただしこれは一般の利用者向けではなく、
代理店システム(sengoku-ai.com)の代理店だけが通る入口で、ログイン画面には出ない
(`docs/agency-integration.md`「代理店SSOログイン」)。一般の利用者にとって
使えるログイン方法は引き続きLINEのみである。

## なぜ閉じるのか

| 方法 | 状態 | 本番で開けられない理由 |
|---|---|---|
| **LINE** | ✅ 使える | `AUTH_MODE=production` で実チャネルのIDトークンを検証する。LIFF結合試験済み |
| **メールOTP** | ⚙️ 鍵の設定待ち | 2026-09-05に送信処理を実装した (Resend)。管理画面「メール送信設定」から鍵を入れれば開けられる。**LINEを持っていない利用者のための入口** |
| **千ノ国パスポートSSO** | ❌ | 正式SSO (RS256/JWKS) が未完成。モック発行エンドポイントは本番で404 |
| **代理店SSO** | ✅ 使える | 2026-09-04接続。`SENGOKU_AI_SSO_*` を設定し、連携先がSSO受信URLを登録済み。ただし利用者向けではなく**代理店専用**の入口で、ログイン画面にボタンは出ない (連携先の起動URLから来る) |

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
| `ENABLE_EMAIL_LOGIN` | 無効 (`true` のときだけ有効。`RESEND_API_KEY` が必須) |
| `ENABLE_SENGOKU_PASSPORT_LOGIN` | 無効 |
| `ENABLE_AGENCY_LOGIN` | 無効 (本番は`deploy.yml`で`true`。2026-09-04接続済み) |

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

LINEを持っていない利用者が新規登録するための入口 (2026-09-05実装)。

1. Resend (https://resend.com) でアカウントを作り、**差出人ドメインを検証する**
   (`sennokuni-wallet.com` のDNSへ SPF / DKIM を設定する)
2. APIキーを発行し、**管理画面「メール送信設定」(`/mail-config`) へ登録する**
3. 同じ画面の「テスト送信」で、実際に届くことを確認する
4. `ENABLE_EMAIL_LOGIN=true` にしてデプロイする

### 鍵を管理画面に置く理由

鍵の入れ替えにデプロイを待たせないため。環境変数 `RESEND_API_KEY` でも設定できるが、
**管理画面の値が優先**される。環境変数は管理画面へ入れるまでの初期設定と、
緊急時の逃げ道として残している。

鍵は `CommonUserHubConfig.apiKeyEncrypted` と同じ AES-256-GCM 可逆暗号化
(`ENCRYPTION_KEY`) で `mail_config` に保存し、画面へは末尾4文字だけのマスク表示を
返す。生値は保存後二度と表示しない。

### 未設定なら選択肢を出さない

`GET /auth/methods` は、`ENABLE_EMAIL_LOGIN=true` でも**送信の設定が済むまで
`email: false` を返す**。押してもコードが届かないボタンを見せないため。設定は
管理画面から変わるので、環境変数ではなく毎回確かめる。

APIを直接叩いた場合は、本番なら 503 になる (`MailNotConfiguredError`)。
本番以外では何もせず成功にする — ワンタイムコードは応答の `devCode` で確認できるので、
開発・テストに送信基盤を要求しない (`REDIS_URL` 未設定でインメモリへ落ちるのと同じ考え方)。

### テスト送信

管理画面から、保存済みの設定でテストメールを1通送れる。本番の鍵をそのまま使う
外部への発信なので:

- 参照権限しかない `AUDITOR` には開けない (`SUPER_ADMIN` / `INTEGRATION_ADMIN` のみ)
- 1つの発信元から5分3回までに絞る
- **実行者と宛先を監査ログ (`MAIL_TEST_SENT`) に残す**。宛先はワンタイムコードと
  違い秘密ではなく、誤送信や乱用の追跡に要るため
- 本文にワンタイムコードは含めない (テストに実コードを流さない)

失敗したときは原因の分類 (`not_configured` / `failed`) と、次に何をすればよいかを
画面へ返す (`AdminAgencyConnectionTestService` と同じ方針)。

#### 送信できなかったときは失敗として返す

`AuthService.requestEmailOtp()` は送信失敗を握り潰さず **503** を返す。ここで
握り潰すと画面には「送信しました」と出るのに、利用者は届かないコードを待ち
続けることになる。

発行済みのコードは送信に失敗しても消さない。60秒のクールダウン中に再送を
求められても、KVには最新のコードが残っているため、送信さえ復旧すれば同じ
コードで先へ進める。

#### コード発行は発信元で絞る

`POST /auth/email/request-otp` は **1つのIPから5分に5回まで**。
`EmailOtpService` にはアドレス単位の60秒クールダウンがあるが、宛先を変えれば
回避できるため防御にならない。絞らないとグローバル上限 (120回/60秒) まで
任意の宛先へメールを撃ててしまい、メール爆撃・送信費用・送信ドメインの
評判低下に直結する。

#### メール本文にリンクを置かない

`buildOtpMail()` はプレーンテキストで、URLを一切含めない。「メールのリンクを
踏む」習慣をつけると、同じ見た目の偽メールで誘導されたときに見分けが
つかなくなるため。コードは画面へ手で入力してもらう。

#### 紹介はLINE登録と同じように成立する

`POST /auth/email/verify-otp` はLINEログインと同じく紹介セッションCookieを
読み、新規作成時に紐付ける (`docs/agency-integration.md`)。ここが抜けていると、
紹介URL経由でメール登録した人が代理店に紐付かず、しかも**画面上は普通に
登録成功して見えるため気づけない**。

ただしLINEを通っていないので、代理店へ送る `line_verified` は `false` になり、
初回登録特典の `line_user_id_hash` は空になる。

### 千ノ国パスポートSSO / 代理店SSO

接続が完了し、`SENGOKU_AI_SSO_ISSUER` / `SENGOKU_AI_SSO_AUDIENCE` /
`SENGOKU_AI_JWKS_URL` を設定してから、対応する環境変数を `true` にする。

代理店SSOはこの3つに加えて、**連携先が受信URL
(`https://sennokuni-wallet.com/sso/agency`) を登録し終えていること**が前提になる。
登録前に `ENABLE_AGENCY_LOGIN` を `true` にしても、代理店がウォレットへ
たどり着けないため意味がない。手順は `docs/agency-integration.md`
「代理店SSOログイン」を参照。

## テスト環境

`.env.test`・CI・Playwright では**全て有効**にしている。機能の実装そのものを検証したい
ため。既定値の検証は `login-methods` のテストが環境変数を明示的に操作して行う。

## 動作確認

- `apps/api/src/auth/login-methods.test.ts` (4件): 既定値、LINEの既定有効、他の既定無効、
  環境変数による有効化
- `apps/api/src/e2e/login-methods.test.ts` (7件): `GET /auth/methods` の内容と未ログインでの
  参照、無効な方法のエンドポイントが404になること (メール・パスポートSSO・代理店SSO)、
  LINEログインが従来どおり通ること、有効化すれば元の挙動に戻ること
- `apps/api/src/e2e/email-registration.test.ts` (9件): メールでの新規登録
  (アカウント・ウォレット作成、再ログイン、規約未同意の拒否、誤コードの拒否)、
  紹介URL経由での紐付けと`line_verified: false`、紹介Cookieの使い切り、
  送信失敗時に503を返すこと、コード発行の回数制限
- `apps/api/src/mail/otp-mail.test.ts` (4件): 件名・本文・リンクを置かないこと
- `apps/api/src/mail/resend-mail-sender.test.ts` (6件): 送信内容、APIキーの渡し方、
  失敗時に例外を投げること、例外に鍵・宛先・コードを含めないこと
- `apps/api/src/mail/mail-config.service.test.ts` (7件): 管理画面の値が環境変数より
  優先されること、マスク、空欄保存で鍵を消さないこと
- `apps/api/src/e2e/mail-config.test.ts` (14件): 保存とマスク表示、DBへ暗号化して
  置くこと、監査ログに鍵を残さないこと、権限、テスト送信 (未設定・成功・失敗・
  コードを含めないこと・回数制限)、設定が済むまでログイン画面に出さないこと
