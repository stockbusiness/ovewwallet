# 代理店紹介トークン受け入れ・登録特典 (実装指示書 v1.0, Phase 1)

対象仕様: 「OVEウォレット 代理店紹介連携機能 実装指示書」v1.0、
「OVEウォレット 紹介Cookie発行方式に関する技術判断」。

## 実装範囲 (Phase 1)

指示書19章のPhase区分のうち、外部APIキーが無くても実施できるPhase 1のみを実装した。

- `/invite/{token}` の受付 (ウォレット側は即時リダイレクトのみ)
- APIサーバー側での紹介セッションCookie発行
- LINEログイン・新規登録時の紹介関係の紐付け
- 紹介・特典状態テーブル (専用テーブル、指示書10章の方針通り)
- `integration_outbox` への登録 (実際の送信はPhase 2)
- 二重登録・二重付与防止 (DB制約)
- 管理画面の確認機能 (一覧・詳細) と、後付けの紐付け (下記)

**Phase 2 (代理店システム接続: APIキー・署名設定・自動送信・確認結果反映・特典確定)、
Phase 3 (管理者の手動確定・取消・紹介者訂正)は未実装。** 3,000 OVEは今回は
確定付与されず、常にPENDINGのまま保留される (Phase 2で確認結果を受け取ってから
確定する設計)。

## 全体フロー

```text
1. ユーザーが代理店紹介URLへアクセス
   GET https://wallet.example.jp/invite/{token}
2. ウォレット側 (Next.js) が即座にAPIサーバー側へリダイレクト
   GET https://api.example.jp/api/v1/referrals/capture?token={token}
3. APIサーバー側:
   - ENABLE_WALLET_REFERRAL_TOKEN が false なら何もせず4へ
   - トークンの形式チェック (英数字と ._~- のみ、1〜255文字)
   - wallet_referrals に CAPTURED で1行作成 (紹介トークンは暗号化保存、
     検索用ハッシュも保存。生値はログに出さない)
   - 不透明な紹介セッショントークンを生成し、そのハッシュを保存
   - 紹介セッションCookie (Cookie自体には生のトークンのみ、DBにはハッシュのみ) を発行
4. ウォレット側の /login へ302リダイレクト
5. ユーザーがLINEログインを実行 (Cookieは自動的にAPIへ送られる)
6. 新規登録の場合のみ、アカウント作成と同一トランザクションで:
   - wallet_referrals を PENDING へ更新 (wallet_user_id・registered_at・used_at設定)
   - wallet_referral_benefits を PENDING (3,000 OVE) で作成
   - integration_outbox へ wallet.referral.registered イベントを登録
7. 紹介Cookieは新規/既存いずれの結果でも使い切りとして削除する
```

既存ユーザーが紹介URLを開いた場合は、上記6が実行されない (`findOrCreateByIdentity`
が既存アカウントを早期returnするため) ため、紹介者が上書きされることはない。

## Cookie発行方式 (別ドメイン構成への対応)

`apps/user-wallet` (Vercel) と `apps/api` (Railway) は別ドメインで動作するため、
既存のセッションCookie (`packages/auth/src/session.ts`) と同じ理由で、紹介セッション
Cookieも **APIサーバー側のドメインで発行する**。ウォレット側の `/invite/{token}`
(`apps/user-wallet/src/app/invite/[token]/route.ts`) はCookieを一切発行せず、
`GET /api/v1/referrals/capture` へ即時リダイレクトするだけの薄いルートにしてある。

- Cookie名: `referral_session`
- `HttpOnly` / `Secure` / `SameSite=None` (セッションCookieと同じ、別ドメイン構成のため)
- `Domain`: `APP_URL`から導出した共有ドメイン (下記)。導出できないときは付けない
- 有効期限: `REFERRAL_SESSION_TTL_HOURS` (コード上の既定24時間、本番は30日=720)
- Cookieに保存するのは不透明なランダムトークンのみで、紹介トークン本体は保存しない
  (サーバー側の`wallet_referrals.session_token_hash`と照合する、セッションCookieの
  `token`/`tokenHash`と同じ設計)
- オープンリダイレクト対策: `/referrals/capture`のリダイレクト先は`APP_URL`環境変数由来の
  固定値のみで、リクエストパラメータからは組み立てない

### `Domain`を付けて両ホストへ届かせる (2026-09-05修正)

導入当初は`domain`を指定しておらず、Cookieが**発行元ホスト専用**になっていた。
その結果、`api.sennokuni-wallet.com`で発行したCookieが、ウォレットドメイン宛の
ログインリクエストへ送られず、**紹介URLから登録しても代理店に紐付かない**
状態だった。登録自体は成功して見えるため、運用では気づけない。

なぜログインのセッションCookieは同じ問題を起こしていなかったのか:

| | 経路 | Cookieが付くホスト |
|---|---|---|
| ログイン | `sennokuni-wallet.com/api/...` → Next.jsのrewriteがサーバー側でAPIへ中継 | ウォレット |
| 紹介のcapture | ブラウザが`api.sennokuni-wallet.com`へ**直接**リダイレクト | API |

captureだけがrewriteを経由せず、ブラウザを直接APIドメインへ飛ばしていた。

`referral-cookie.ts`が`APP_URL`から共有ドメインを導出して`domain`に指定する。
ただし**リクエストのホストがそのドメイン配下だと確認できたときだけ**付ける。
APIを別ドメイン (例: Railwayの既定ホスト名) で受けている場合に無関係な`Domain`を
指定すると、ブラウザがCookieを**丸ごと拒否**して今より悪くなるため。確認できない
ときは従来どおりホスト専用で発行する。

`res.cookie`と`res.clearCookie`は同じ関数から属性を取る。指定が食い違うと
ブラウザが削除を無視するため。

**E2E (Playwright) で検出できなかった理由**: ローカルは`localhost:3000` /
`localhost:4000`で動き、**Cookieはポートを区別しない**ので同一ホスト扱いになる。
`apps/api/src/e2e/referral-cookie-domain.test.ts`はHostヘッダーを差し替えて
本番と同じホスト構成を再現し、実際に出る`Set-Cookie`ヘッダーを検証する。

## データモデル

専用テーブルを新設した (開発ガイドライン4.3章/9.1章の「既存の仕組みを再利用する」方針は
代理店システムとの外部API連携 (`service_integrations`等) に対するものであり、紹介関係は
そもそも該当する既存の仕組みが無いため、指示書10章の方針通り新設した)。

- `wallet_referrals`: 紹介トークンの受付 (登録前の一時セッション) と、登録後の紹介関係を
  同一テーブル・同一行で管理する (`status`と`wallet_user_id`の有無で区別し、
  「紹介トークン」「紹介セッション」を別テーブルへ分割しない)。
  - `session_token_hash`: Cookie照合用 (一意)
  - `referral_token_encrypted` / `referral_token_hash`: 代理店発行トークン本体
    (暗号化) とその検索用ハッシュ
  - `wallet_user_id`: 登録完了までnull。1アカウントにつき有効な行は1件のみ
    (nullable unique制約)
  - `status`: CAPTURED → PENDING → (Phase 2で) CONFIRMED/REJECTED、他に
    MANUALLY_CONFIRMED/CANCELLED/ERROR/EXPIRED
- `wallet_referral_benefits`: 初回登録特典の状態。`benefit_type`+`wallet_user_id`、
  `benefit_type`+`line_user_id_hash` の両方にユニーク制約を持たせ、DBレベルでも
  二重付与を防止する。台帳への冪等キーは `REFERRAL_SIGNUP_BONUS:{wallet_user_id}`。

## Feature Flag

`ENABLE_WALLET_REFERRAL_TOKEN` (既定`false`) がOFFの間、`/referrals/capture`は
何も保存せずログイン画面へ戻すだけになる (`/invite/{token}`にアクセスしても紹介は
記録されない)。既存のFeature Flag基盤 (`docs/integration-outbox.md`) をそのまま使う。

`ENABLE_WALLET_REGISTRATION_BONUS`はPhase 1では未参照 (特典を実際に確定付与する
コード自体がまだ無いため)。Phase 2で確定付与を実装する際にこのフラグで制御する想定。

## 環境変数

| 変数名 | 内容 | 既定値 |
|---|---|---|
| `REFERRAL_SESSION_TTL_HOURS` | 紹介URLを開いてから登録を終えるまでの猶予(時間)。紹介URL自体の寿命ではない | `24` (本番は`720`) |
| `REFERRAL_SIGNUP_BONUS_AMOUNT` | 初回登録特典の額(OVE) | `3000` |

## セキュリティ

- 紹介トークンの生値・Cookie値・LINEユーザーIDの生値はログへ一切出力しない
  (`referral_token_encrypted`で暗号化保存、`line_user_id_hash`でハッシュ保存)
- IP/UAも一方向ハッシュのみ保存 (`created_ip_hash`/`user_agent_hash`)
- 管理画面 (`/wallet-referrals`) では紹介トークン本体・そのハッシュ・セッション
  Cookieのハッシュを一切表示しない (Prismaの`select`で明示的に除外)

## テスト

`apps/api/src/e2e/agency-referral.test.ts` で以下を検証済み:

- Feature Flag無効時は何も保存されない
- 有効なトークンでCAPTURED行とCookieが作られる
- 不正な形式のトークンは何も保存されない
- 新規登録時に紹介関係(PENDING)・特典(PENDING、3,000 OVE)・outboxイベントが
  同一トランザクションで作られ、紹介トークンがoutbox送信用に平文へ復号できる
- 紹介Cookieが無い通常のログインでは紹介関係が作られない
- 既存ユーザーが紹介URLを開いても紹介関係が上書きされない (セッションも未使用のまま)
- 使用済みの紹介セッションを2回目の登録に使い回せない

`apps/api/src/referrals/referral-cookie.test.ts` (9件): 共有ドメインの導出
(サブドメイン配下なら付ける・同一ホストや別ドメインには付けない・似ているだけの
ドメインに広げない・ローカルや`APP_URL`未設定では付けない)と、Cookie属性

`apps/api/src/e2e/referral-cookie-domain.test.ts` (4件): Hostヘッダーを本番と同じ
構成に差し替えて、実際に出る`Set-Cookie`に`Domain`が付くこと・別ドメインでは
付かないこと・従来の属性が変わらないこと

実ブラウザ (Playwright) でも、`/invite/{token}` → 別ドメインでのCookie発行 → LINE
登録 → 管理画面での確認まで一連の流れを確認済み。

## 後付けの紐付け (管理画面)

```
POST /api/v1/admin/wallet-referrals/:id/attach   { "account": "ORI-ACC-...", "reason": "..." }
```

紹介の紐付けは**新規アカウント作成時にしか起きない** (`AuthService` が
`onNewAccountCreated` でのみ `attachToNewAccount` を呼ぶ)。そのため
「先にウォレットへ登録した人が、後から代理店の紹介URLを踏んだ」場合は紹介が成立せず、
代理店の成果にならない。

**退会させても救済にならない。** 退会は `status = CLOSED` にするだけで identity は残り、
同じLINEアカウントでの再登録は明示的に拒否される
(`AccountRegistrationService.findOrCreateByIdentity`)。つまり退会させると、その利用者は
ウォレットを一切使えなくなる。そのため個別救済はこの操作で行う。

| | |
|---|---|
| 対象 | `CAPTURED` のみ。`EXPIRED` 等の終端状態からは復帰させない (状態遷移の不変条件を崩さないため)。単に猶予 (既定30日) を過ぎただけの行は `CAPTURED` のまま残るので紐付けできる |
| 前提 | 代理店システムの紹介セッション (`referral_session_key` + `canonical_referral_token`) が揃っていること。無いと確定を通知できないため拒否する |
| 遷移後 | **`PENDING`** (`CONFIRMED` にはしない) |
| 権限 | `SUPER_ADMIN` / `INTEGRATION_ADMIN` (閲覧専用の `AUDITOR` には開けない) |
| 記録 | `source = "admin"`、`reason`、監査ログ `WALLET_REFERRAL_ATTACHED_MANUALLY` |

**`CONFIRMED` にしない理由**: 成果を認めるかどうかの正本は代理店システム側にある。
ウォレットの管理画面から確定済みにすると連携先の記録と食い違う。確定自体は通常フローと
同じ経路 (Outbox `wallet.referral.registered` → `AgencyReferralOutboxHandler` →
代理店システムの `POST /api/referrals/confirm`) に委ね、先方が認めて初めて `CONFIRMED`
になる。冪等キーも通常フローと同じなので二重送信にならない。

1アカウントに紐付けられる紹介は1件まで (`@@unique([walletUserId])`)。

## 今後の課題 (Phase 2・Phase 3)

- `AgencyReferralClient`: sengoku-ai.comへの実際の送信・確認結果の反映
  (代理店システム側の送信用APIキー発行が前提。`docs/agency-referral-decisions.md`参照)
- 確認結果 (`confirmed`/`rejected`) を受けての3,000 OVE確定付与・LINE認証条件の適用
- 管理者による取消・紹介者訂正 (後付けの紐付けは実装済み。下記「後付けの紐付け」)
- outboxの自動再送 (現状`/admin/outbox`からの手動dispatchのみ)
