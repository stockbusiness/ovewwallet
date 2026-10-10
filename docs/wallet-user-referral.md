# ウォレット利用者同士の紹介

ウォレット利用者が他の人を紹介し、紹介した側が**あとから代理店資格を取得したときに
その紹介関係を代理店システムへ継承する**ための仕組み。

| | Feature Flag | 内容 |
|---|---|---|
| Phase 1 | `ENABLE_WALLET_USER_REFERRAL` | ウォレット内での記録・本人向け画面・管理画面 |
| Phase 2 | `ENABLE_WALLET_USER_REFERRAL_INHERITANCE` | 代理店システムへの継承申請 |

どちらも既定OFF。Phase 2は Phase 1 の記録が無いと対象が生まれないため、
Phase 1 → Phase 2 の順で開ける。

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
| `INHERITED` | 紹介者の代理店資格取得に伴い、継承を**申請済み**。承認されたことを意味しない |
| `EXCLUDED` | 代理店紹介が優先された・自己紹介 |
| `EXPIRED` | 登録に使われないまま期限切れ |

## 紹介記録ID

`wallet_user_referrals.id` は、Phase 2で**代理店システムへ送る外部公開ID**になる
(先方が「紹介記録ID」として保存し、承認結果で参照してくる)。採番し直し・行の削除は
できない。

## Phase 2: 継承の申請

代理店システムと合意済みの方針:

- 紹介顧客としての**紐付け**と、過去の登録・購入に対する**報酬の遡及付与**は分けて扱う
- 成果として認める条件・対象期間は代理店システム側の運用ルールとして決まる
  (無期限の遡及は確約されていない)
- **申請の受付成功は承認を意味しない。** 承認された場合だけ結果が返る
- 既存の紹介代理店は上書きしない
- 継承処理自体ではポイント付与を行わない

### 申請 (ウォレット → 代理店システム)

イベント名 `wallet.referral.inheritance.requested`。

| 項目 | 値 |
|---|---|
| `event_id` | `wri_{紹介記録ID}`。**再送時も同じ値**になるよう、不変の紹介記録IDから決める |
| `source_system_key` | `common_user_hub_config.systemKey` (本番は `orly-wallet`) |
| `referrer_common_user_id` | 紹介した側の `common_user_id` |
| `referred_common_user_id` | 紹介された側の `common_user_id` |
| `referred_at` | `wallet_user_referrals.captured_at` (タイムゾーン付きISO 8601) |
| `referral_record_id` | `wallet_user_referrals.id` (不変) |

送信先ホスト・APIキー・`source_system_key` は既存の代理店連携設定
(`common_user_hub_config`) をそのまま使う。`/api/referrals/capture` /
`/confirm` と同じ `x-api-key` で送るため、新しい資格情報は要らない。
**受信パスだけは `AGENCY_REFERRAL_INHERITANCE_PATH` で設定する** (既定値を置かない。
推測したパスを既定にすると、誤ったURLへ404を再送し続け、設定し忘れと区別できなくなる)。

重複は代理店システム側が `source_system_key` + `referral_record_id` で見る。
ウォレット側も `inherited_at` で二重申請を防ぐので、二重に守られる。

### 昇格の検知

代理店同期 (`POST /api/v1/agency`) が運んでくる `common_user_id` が、既存の
ウォレットアカウントと一致したときに申請する (`AgencyService.syncAgency`)。

同期イベントには「初回の資格取得」を区別する種別が**まだ無い**ため、情報更新の
同期でもこの判定を通る。申請済みの紹介は `inherited_at` で除外されるので、何度
通っても二重に申請しない。区別用の通知が入ったら条件を絞るだけでよい。

共通IDが2アカウントに紐づく異常時は、どちらの紹介実績か決められないため何もしない。

### 承認結果 (代理店システム → ウォレット)

**既存の `customer.assignment.changed` をそのまま使う。** 新しい受信形式は無い。

| 項目 | 値 |
|---|---|
| `common_user_id` | 被紹介者 |
| `registration_referrer_agency_id` | 承認した継承先の代理店識別子 |

`assigned_agency_id` は送られない。受信側 (`CustomerAssignmentChangedHandler`) は
`registration_referrer_agency_id` を「初回のみ設定し、既存値は上書きしない」で
処理しており、先方の方針と一致する。**この経路に追加実装は不要。**

管理画面では「申請済み」と「承認済み」を分けて表示する。承認されると紹介された側に
紹介代理店が設定されるので、それを承認の有無として見る。

### 前提: 双方の common_user_id が解決済みであること

申請には紹介者・被紹介者**両方**の `common_user_id` が必要。共通顧客HUBの
設定が揃っていない時期に登録したアカウントは null のまま固定されるため、
管理画面の「共通IDを再解決」(`admin-common-user-resolve.service.ts`) で
埋めておく必要がある。未解決の間は申請を作らず、解決後の次の同期で拾われる。

### 未確定

代理店システムの受信パス・認証方式 (同じAPIキーで受け付けられるかの確認待ち)、
対象条件・期間 (代理店システム側の判定のため、ウォレットの実装には影響しない)。

## 環境変数

| 変数 | 既定 | 用途 |
|---|---|---|
| `ENABLE_WALLET_USER_REFERRAL` | (未設定=OFF) | 記録・画面の出し分け |
| `ENABLE_WALLET_USER_REFERRAL_INHERITANCE` | (未設定=OFF) | 継承申請の送信 |
| `AGENCY_REFERRAL_INHERITANCE_PATH` | (未設定) | 継承申請の受信パス。未設定なら申請を作らない |
| `REFERRAL_SESSION_TTL_HOURS` | 24 | 紹介セッションCookieの寿命 (代理店紹介と共用) |
| `APP_URL` | `http://localhost:3000` | 共有URL・リダイレクト先の組み立て元 |
