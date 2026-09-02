# 代理店システム (sengoku-ai.com) へのご依頼

ORLYウォレット側の実装が完了しました。接続テストに進むにあたって、
**代理店システム側でご対応いただきたいこと**と、**ご確認いただきたいこと**を
まとめました。

ウォレット側の詳細仕様は `AGENCY_POINT_AWARD.md` を併せてご覧ください。

---

## 0. ウォレット側の受け口 (確定値)

| 項目 | 値 |
|---|---|
| ウォレット登録URL | `https://sennokuni-wallet.com/invite` |
| 付与イベント受信エンドポイント | `https://api.sennokuni-wallet.com/api/integrations/agencies/point-awards` |
| 認証 | `Authorization: Bearer {api_key}` または `x-api-key: {api_key}` |
| 受信用APIキー | 別途お渡しします (再発行時に一度だけ表示される値のため、本書には記載しません) |
| HMAC署名 | **不要** |

---

## A. ご対応をお願いしたいこと

### A-1. 紹介URLの遷移先を `/invite` にしてください

```
https://sennokuni-wallet.com/invite?referral_token=...&referral_session_key=...&agency_id=...&source=sengoku-agency
```

- `referral_token` は `rt`、`referral_session_key` は `rs` でも受け付けます。
- `referral_session_key` を載せていただければ、ウォレット側から
  `POST /api/referrals/capture` を呼ばずに紹介関係を保持できます。
- ルート (`https://sennokuni-wallet.com/?referral_token=...`) に付けられた場合も
  `/invite` へ寄せますが、**`/invite` を直接指定していただくのが確実**です。

### A-2. `source_system_key` の値をすり合わせてください

ウォレットから送る登録完了通知 (`POST /api/referrals/confirm`) の
`source_system_key` / `system_key` は、ウォレット管理画面で設定した値を送ります。

ご依頼文書では `orly-wallet` となっていましたが、**現在の設定値は `ove-wallet`** です。

- 代理店システム側に `orly-wallet` で登録済み → ウォレット側を `orly-wallet` に変更します
- `ove-wallet` で登録済み → **そのままで動きます**

**どちらで登録されているかをお知らせください。**

### A-3. 付与は「1件につき1イベント」で送ってください

直接紹介者と上位代理店の両方へ付与する場合、**イベントを2件**送ってください。

| | 1件目 | 2件目 |
|---|---|---|
| `event_id` | 別々の値 | 別々の値 |
| `point_award.award_event_key` | **別々の値** | **別々の値** |
| `point_award.recipient_type` | `direct_referrer` | `upper_director` |
| `point_award.recipient_agent_id` | 直接紹介者 | 上位代理店 |

**`award_event_key` が同じだと、2件目は「同じ付与の再送」とみなされて加算されません。**
ウォレット側はこのキーで二重付与を防いでいるためです。

### A-4. 404 が返ったときは再送してください (ただし条件があります)

付与先の代理店担当者が**まだORIウォレットにログインしていない**場合、
宛先が決まらないため 404 を返します。**この404は再送していただければ解消します。**

ただし、**同じ `event_id` での再送は8回までです。** それを超えると以後 503 を返し、
その `event_id` は受け付けられなくなります。

**8回を超えて再送が必要な場合は、`event_id` を新しく振り直して送ってください。**
`award_event_key` が同じであればウォレット側の台帳で重複を防ぐので、
二重加算にはなりません。

### A-5. 代理店SSOの接続情報をご提供ください

**上位代理店への付与を通すために必要です。**

ウォレットは「代理店の担当者ID (`recipient_agent_id`)」から付与先を決めるとき、
`account_links` を引きます。この紐付けは**代理店SSOログインでのみ**作られます。
代理店同期 (`POST /api/integrations/agencies`) だけでは
「同期のみ受信 (未紐付け)」の状態にとどまり、付与先が決まりません。

以下をご提供ください。

| 項目 | 内容 |
|---|---|
| JWKS URL | SSO用JWTの検証に使う公開鍵の配布先 (例: `https://sengoku-ai.com/api/sso/jwks.php`) |
| issuer (`iss`) | JWTの発行者として期待する値 (例: `https://sengoku-ai.com`) |
| audience (`aud`) | 本連携用に発行していただいた値 |

SSOが接続されるまでの間は、ウォレット管理画面から担当者とORIアカウントを
**手動で紐付ける**ことで個別に救済できますが、恒久的な運用手段ではありません。

### A-6. ウォレットから送信するためのAPIキーをご提供ください

ウォレット → 代理店システムの方向 (下記2つ) を呼ぶために必要です。

```
POST https://sengoku-ai.com/api/referrals/capture
POST https://sengoku-ai.com/api/referrals/confirm
```

既にお渡しいただいている場合は不要です。ウォレット側では未設定のあいだ、
これらの呼び出しは行われません (エラーにはならず、送信されないだけです)。

### A-7. テスト用の紹介URLをご用意ください

接続テストのため、検証環境で使える紹介URL (`referral_token` 入り) を
1本ご発行ください。

---

## B. ご確認いただきたいこと

### B-1. 「コーリーコイン」は ORI 残高という理解で合っていますか

ORLYウォレットが管理する残高は**1種類だけ**で、画面表示は「ORI」です。
`point_code` が `orly` / `ori` / `ove` (または未指定) の付与を、この ORI 残高への
加算として実装しました。

**別種類の通貨を新設するご依頼だった場合は、前提が異なります。**
その場合はお知らせください。

なお `point_code` に上記以外の値が入っている場合は 400 で拒否します
(別通貨の付与を ORI として誤って加算しないためです)。

### B-2. `wallet_address` は送れません

ORLYウォレットは台帳上の残高であり、**利用者に発行されるブロックチェーン
アドレスを持ちません。** そのため登録完了通知に `wallet_address` は含めません。

ご依頼文書では「ある場合は送ってください」とのことでしたので、
仕様上は問題ないと理解しています。

### B-3. テスト用ユーザーID / ウォレットアドレスについて

固定のテスト用IDは用意していません (本番と検証で別のDBのため)。
接続テスト時に、検証環境で実際にログインしたアカウントのIDをお伝えします。

ウォレットアドレスは B-2 のとおり存在しません。

---

## C. 接続テストの進め方

ご依頼文書7章の順番でそのまま進められます。

| # | 内容 | 担当 |
|---|---|---|
| 1 | 代理店URLからウォレット登録画面へ遷移できる | 両者 |
| 2 | ウォレット側で `referral_token` を保持できる | ウォレット |
| 3 | 登録完了時に `POST /api/referrals/confirm` を送信できる | ウォレット |
| 4 | 代理店システム側で紹介関係が確定する | 代理店 |
| 5 | 付与候補が pending になる | 代理店 |
| 6 | 付与イベントがウォレットへ届く | 代理店 |
| 7 | 二重付与せず加算される | ウォレット |
| 8 | 成功レスポンスに `wallet_event_id` が返る | ウォレット |
| 9 | 付与状態が delivered になる | 代理店 |

**7 の確認方法**: 同じ `event_id` のイベントをもう一度送ってください。
応答の `cached` が `true` になり、`wallet_event_id` が1回目と同じ値で返れば、
台帳に触れずに冪等に処理できています。残高は増えません。

### 応答形式

成功:

```json
{
  "ok": true,
  "event_id": "orly_wallet_123",
  "wallet_event_id": "<ORI取引ID>",
  "status": "credited",
  "cached": false
}
```

失敗:

```json
{
  "ok": false,
  "error": { "code": "VALIDATION_ERROR", "message": "..." },
  "request_id": "..."
}
```

| HTTP | `error.code` | 意味 | 再送 |
|---|---|---|---|
| 400 | `VALIDATION_ERROR` | 本文の誤り | ✗ 直らない |
| 401 | `API_KEY_REQUIRED` / `INVALID_API_KEY` | 認証ヘッダー無し / キー不一致 | ✗ |
| 404 | `NOT_FOUND` | 付与先が未解決 (未ログイン等) | **○ A-4参照** |
| 409 | `COMMON_USER_ACCOUNT_CONFLICT` | 同じ `event_id` で本文が違う | ✗ |
| 503 | `FEATURE_DISABLED` | ウォレット側で受信がまだ有効化されていない | ○ |

---

## D. ウォレット側の実装内容 (ご参考)

| ご依頼 | 対応 |
|---|---|
| 1章 紹介URLのパラメータ | `referral_token`/`rt`、`referral_session_key`/`rs`、`agency_id`、`source` を受け付け |
| 2章 登録完了通知 | ご指定の項目名と共通実装契約の項目名の**両方**を送信 |
| 3-4章 付与イベント受信 | 上記エンドポイントで受信し、ORI残高へ加算 |
| 5章 認証 | `Authorization: Bearer` / `x-api-key` |
| 6章 冪等性 | `event_id` と `award_event_key` の**2段構え**で二重付与を防止 |
| 8章 共有情報 | `AGENCY_POINT_AWARD.md` 8章 |
