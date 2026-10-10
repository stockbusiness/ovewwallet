# ウォレット利用者同士の紹介 (Phase 1: 記録まで)

ウォレット利用者が他の人を紹介し、紹介した側が**あとから代理店資格を取得したときに
その紹介関係を代理店システムへ継承する**ための仕組み。この文書時点では **Phase 1
(ウォレット内での記録・本人向け画面) のみ実装済み**で、継承の通知は未実装。

Feature Flag `ENABLE_WALLET_USER_REFERRAL` で出し分ける (既定OFF)。

## 代理店紹介との違い

`docs/agency-referral.md` の「紹介」はこれとは別物。

| | 代理店紹介 (`wallet_referrals`) | ウォレット紹介 (`wallet_user_referrals`) |
|---|---|---|
| 紹介する側 | 代理店 | ウォレット利用者 |
| URL | `/invite/{token}` / `/invite?rt=...` | `/r/{code}` |
| トークンの発行元 | 代理店システム (sengoku-ai.com) | ウォレット |
| Cookie名 | `referral_session` | `wallet_user_referral_session` |
| 成立の判定 | 代理店システム (capture/confirm) | ウォレット |
| 登録特典 | 紹介**された**側へ3,000 ORI (現在は既定で作成しない) | なし |

テーブルを分けているのは、`wallet_referrals` が代理店システムのcapture/confirm APIと
一対一で、`referral_token_encrypted` が必須・状態機械も代理店前提のため。紹介元が
ウォレット利用者である関係を混ぜると、両方の不変条件が曖昧になる。

## 流れ (Phase 1)

```text
1. 紹介する側がメニュー → 「お友達を紹介」を開く
   GET /api/v1/me/wallet-user-referrals
   → 紹介コードが未発行ならこの時点で発行する (全員に前もって振らない)
2. 紹介URL (https://sennokuni-wallet.com/r/{code}) を共有する
   代理店URLと違い、1本のURLを何人へでも共有できる
3. 紹介された側がURLを開く
   /r/{code} (Next.js) → GET /api/v1/wallet-user-referrals/capture?code=... (API)
   → wallet_user_referrals に CAPTURED で1行作成し、紹介セッションCookieを発行
4. ログイン画面へ302リダイレクト
5. 新規登録の場合のみ、アカウント作成と同一トランザクションで
   REGISTERED へ更新 (referred_account_id・registered_at・used_at設定)
6. 紹介Cookieは新規/既存いずれの結果でも使い切りとして削除する
```

既存ユーザーが紹介URLを開いた場合は手順5が実行されない
(`findOrCreateByIdentity` が既存アカウントを早期returnするため)。

## 代理店紹介を上書きしない

代理店紹介リンクとウォレット紹介リンクを続けて開いた人は、両方のCookieを持ちうる。
このとき **代理店紹介を優先し、ウォレット紹介では上書きしない**
(`AuthService.buildReferralAttachHook`)。代理店の成果をウォレット内の紹介が
奪う形にしないため。`OveAccount.registrationReferrerAgencyId` が
「一度設定したら上書きしない」ロックを掛けているのと同じ方針。

優先されなかったウォレット紹介セッションは `EXCLUDED` で閉じる。`CAPTURED` のまま
残すと、次に別のアカウントが同じCookieでログインしたときに拾われてしまう。

自己紹介 (`referrer_account_id === referred_account_id`) も `EXCLUDED` にする。

## 状態

| status | 意味 |
|---|---|
| `CAPTURED` | `/r/{code}` で受け付け、登録未完了 |
| `REGISTERED` | 登録完了、紹介成立。代理店システムへはまだ伝えていない |
| `INHERITED` | 紹介者の代理店資格取得に伴い、継承を通知済み (**Phase 2、未実装**) |
| `EXCLUDED` | 代理店紹介が優先された・自己紹介 |
| `EXPIRED` | 登録に使われないまま期限切れ |

## 紹介記録ID

`wallet_user_referrals.id` は、Phase 2で**代理店システムへ送る外部公開ID**になる
(先方が「紹介記録ID」として保存し、承認結果で参照してくる)。採番し直し・行の削除は
できない。

## Phase 2 (継承、未実装)

代理店システムとの合意済みの方針:

- 紹介顧客としての**紐付け**と、過去の登録・購入に対する**報酬の遡及付与**は分けて扱う
- 成果として認める条件・対象期間は代理店システム側の運用ルールとして決まる
  (無期限の遡及は確約されていない)
- 代理店同期 (`POST /api/v1/agency`) に、初回の代理店資格取得を情報更新・役職昇格と
  区別できる通知を追加してもらう
- ウォレット発の紹介には、既存の `referral_token` を前提としない専用イベントを定義する。
  送る項目は紹介者・被紹介者の `common_user_id`、紹介日時、紹介記録ID
- 承認結果のみを継承する。既存の紹介代理店は上書きしない

未確定 (先方から別途共有される): イベント名・受信項目の詳細・承認結果の通知形式。

### 実装済みの受け口

承認結果は**既存の `customer.assignment.changed`** で受け取れる
(`common_user_id` + `registration_referrer_agency_id`。`CustomerAssignmentChangedHandler`
が初回のみ設定・既存値は上書きしないをトランザクション内で保証済み)。新しい受信形式を
作る必要はない見込み。

### 前提: 双方の common_user_id が解決済みであること

継承イベントには紹介者・被紹介者**両方**の `common_user_id` が必要。共通顧客HUBの
設定が揃っていない時期に登録したアカウントは `common_user_id` が null のまま固定
されるため、管理画面の「共通IDを再解決」(`admin-common-user-resolve.service.ts`) で
埋めておく必要がある。

## 環境変数

| 変数 | 既定 | 用途 |
|---|---|---|
| `ENABLE_WALLET_USER_REFERRAL` | (未設定=OFF) | この機能全体の出し分け |
| `REFERRAL_SESSION_TTL_HOURS` | 24 | 紹介セッションCookieの寿命 (代理店紹介と共用) |
| `APP_URL` | `http://localhost:3000` | 共有URL・リダイレクト先の組み立て元 |
