# 千ノ国ウォレット 外部開発者向け連携ガイド

Version: 1.0
対象システム: `千ノ国ウォレット` (OVE Wallet)
対象読者: 千ノ国パスポート、代理店システム(sengoku-ai.com)、AIアート教室、
ショッピングシステム、その他 千ノ国ウォレットと連携する外部サービスの開発担当者

---

## 1. この連携の目的

千ノ国ウォレットは、参加者のポイント・クーポン・ガチャ券・活動特典・OVE表示残高を
一元管理する台帳です。外部サービス側でイベント参加・購入・活動が発生した場合、
このガイドに従って千ノ国ウォレットへ特典付与・利用(減算)・取消を依頼してください。

外部サービス側で実現できること:

- 自サービスの利用者に、ポイント(OVE表示残高)を付与する
- 自サービスの利用者が、ポイントを利用(消費)する
- 誤った付与・利用を取り消す
- 自サービスに紐づく利用者の残高を照会する
- (代理店システムのみ) 代理店情報の同期・SSOログイン・共通顧客HUBとの連携

## 2. 用語

| 用語 | 意味 |
|---|---|
| 千ノ国ウォレット / OVE Wallet | 本ドキュメントの対象システム。ポイント・OVE表示残高の台帳を管理する |
| `service_code` | 連携先を識別するコード。`ServiceCode` enumの値のいずれか (3章参照) |
| `service_integration` | 連携先ごとに発行されるAPIキー・署名鍵・上限額等の設定 (管理画面「外部サービス管理」) |
| `external_user_id` | 連携先システム側でのユーザーID。ウォレット側のOVEアカウントIDとは別 |
| `ove_account_id` | 千ノ国ウォレット内部のアカウントID。外部サービスはこのIDを直接扱わない |
| `idempotency_key` | 同一操作の重複実行を防ぐための一意キー (**HTTPヘッダーではなくリクエストボディのフィールド**) |
| OVE表示残高 | 当面、千ノ国ウォレット内で管理するオフチェーンの表示台帳 (6章参照)。暗号資産・価格保証を意味しない |

## 3. 対象システム (`service_code`)

`ServiceCode` enumの値:

```text
SENGOKU_PASSPORT   千ノ国パスポート
AIART              AIアート教室
SENGOKU_GACHA       戦国ガチャ
SENGOKU_EC          戦国EC
NFT_MARKET          NFTマーケット
SENGOKU_METAVERSE   戦国メタバース
EVENT_SYSTEM        イベントシステム
AGENCY_SYSTEM       代理店システム (sengoku-ai.com)
```

`AGENCY_SYSTEM` のみ認証方式が異なる (4.2章参照)。新しい外部サービスを追加する場合は
`ServiceCode` enumへ値を追加した上で、運用担当者に `service_integrations` 行の作成
(APIキー・署名鍵の発行) を依頼してください (10章参照)。

## 4. 認証方式は2種類あります

連携先ごとに、通信方向に応じてどちらかの認証方式を使います。

### 4.1 HMAC署名認証 (`AGENCY_SYSTEM`以外の全連携先)

5章のポイント付与・利用・取消・残高照会APIで使う、署名付きの認証です。

```http
X-OVE-Api-Key: ovk_...
X-OVE-Timestamp: <UNIXエポックミリ秒>
X-OVE-Nonce: <リクエストごとに変わるランダム文字列>
X-OVE-Signature: HMAC-SHA256(signing_secret, "<timestamp>.<nonce>.<method>:<path>:<raw body>")
```

- 署名対象文字列: `` `${timestamp}.${nonce}.${method}:${path}:${JSON.stringify(body)}` ``
  (`method`は大文字、`path`はクエリ文字列を含むフルパス、`body`はNode.jsの
  `JSON.stringify`と完全一致させること。キー順序・非ASCII文字のエスケープに注意)
- タイムスタンプの許容ずれ: **±5分**。これを超えると401。
- `X-OVE-Nonce` は連携先ごとに一度しか使えない (リプレイ拒否)。同じnonceを2回送ると
  401になる。
- `signing_secret` はAPIキー発行時にのみ平文で渡される (11章参照)。以後は
  ウォレット側もハッシュ・暗号化保存のみで、生値を再取得することはできない。

### 4.2 簡易鍵認証 (`AGENCY_SYSTEM`専用)

代理店システム(sengoku-ai.com)からの同期受信 (`POST /api/integrations/agencies`、
8.1章) のみ、HMAC署名を要求しない簡易な鍵認証を使う
(sengoku-ai.com側がHMAC署名に対応していないため)。

```http
x-api-key: <APIキー>
```

または

```http
Authorization: Bearer <APIキー>
```

## 5. 推奨する基本フロー

### 5.1 新規イベント参加・購入時にポイントを付与する

```text
1. 利用者が外部サービス上でイベント参加・購入等を完了する
2. 外部サービスがウォレットへ POST /api/v1/rewards/grant を送信
   (external_user_id が未登録の場合、ウォレット側でアカウント・ウォレットを自動作成する)
3. ウォレットが amount 分のOVE表示残高を付与し、取引情報を返す
4. 同じ event_id・idempotency_key で再送しても二重付与されない (9章)
```

### 5.2 ポイントを利用(消費)する

```text
1. 利用者が外部サービス上でポイント利用を選択する
2. 外部サービスがウォレットへ POST /api/v1/transactions/debit を送信
3. 残高不足の場合は 409 (InsufficientBalanceError) が返る
4. 成功時、取引情報を返す
```

### 5.3 誤った付与・利用を取り消す

```text
1. 外部サービスが対象の取引ID (grant/debitのレスポンスに含まれる id) を特定する
2. POST /api/v1/transactions/{transactionId}/reverse を送信 (reason必須)
3. REVERSAL取引が追加され、残高が復元される (元の取引は削除・改変されない)
```

## 6. OVE表示残高の定義

千ノ国ウォレットにおけるOVE表示残高は、当面、ウォレット内で管理するオフチェーンの
表示台帳を指します。ブロックチェーン上のトークン残高・暗号資産としての換金価値・
価格保証・元本回収保証・将来の値上がり保証は一切意味しません。外部サービスの
利用者向け画面でも、これらを保証するような表現をしないでください。

## 7. エンドポイント一覧

| メソッド/パス | 認証 | エラー形式 | 説明 |
|---|---|---|---|
| `POST /api/v1/rewards/grant` | HMAC | 新形式 (13.1章) | ポイント付与 |
| `POST /api/v1/transactions/debit` | HMAC | 新形式 | ポイント利用(減算) |
| `POST /api/v1/transactions/{transactionId}/reverse` | HMAC | 新形式 | 取消 |
| `GET /api/v1/service/accounts/{externalUserId}/balance` | HMAC | **旧形式 (13.2章)** | 残高照会 |
| `POST /api/integrations/agencies` (`AGENCY_SYSTEM`専用) | 簡易鍵 | 新形式 | 代理店同期受信 |
| `POST /api/v1/auth/sso/agency` (`AGENCY_SYSTEM`専用) | JWT (RS256) | **旧形式** | 代理店SSOログイン |

Base URL: `${API_URL}` (既定 `http://localhost:4000`)。Swagger: `/api/docs`。

> **注意**: 現時点でエラーレスポンス形式は全エンドポイントで統一されていません。
> 付与・利用・取消・代理店同期受信の4エンドポイントは13.1章の新形式
> (`{ok:false, error:{code,message}}`) ですが、残高照会とSSOログインは13.2章の
> 旧形式のままです。呼び出し側は**エンドポイントごとに形式を切り替えて解釈**する
> 必要があります。

## 8. 各エンドポイントの詳細

### 8.1 `POST /api/v1/rewards/grant`

```json
{
  "service_code": "AIART",
  "external_user_id": "AIART-USER-123",
  "event_type": "ATTENDANCE",
  "event_id": "AIART-20260715-001",
  "amount": 10000,
  "transaction_type": "AIART_ATTENDANCE",
  "display_name": "AIアート教室参加特典",
  "description": "2026年7月15日開催分の参加特典",
  "idempotency_key": "AIART_ATTENDANCE:AIART-20260715-001:AIART-USER-123"
}
```

| フィールド | 必須 | 説明 |
|---|---:|---|
| `service_code` | ○ | 3章のいずれか。認証したAPIキーの`service_code`と一致している必要がある |
| `external_user_id` | ○ | 1〜255文字 |
| `event_type` | ○ | 1〜100文字。自由記述 |
| `event_id` | ○ | 1〜255文字。付与ルールの`per_event_limit`判定にも使われる |
| `amount` | ○ | 正の整数 |
| `transaction_type` | - | 既定 `EVENT_REWARD`。`reward_rules`との紐づけに使う |
| `display_name` | ○ | 1〜255文字。利用者の取引履歴に表示される |
| `description` | - | 1000文字以内 |
| `idempotency_key` | ○ | 1〜255文字。**リクエストボディのフィールド** (HTTPヘッダーではない) |

レスポンス (201、`TransactionResponseSchema`):

```json
{
  "id": "01H...",
  "transaction_code": "TRX-...",
  "wallet_id": "01H...",
  "transaction_type": "AIART_ATTENDANCE",
  "direction": "CREDIT",
  "amount": "10000",
  "status": "COMPLETED",
  "balance_before": "50000",
  "balance_after": "60000",
  "display_name": "AIアート教室参加特典",
  "description": "2026年7月15日開催分の参加特典",
  "occurred_at": "2026-07-15T10:00:00.000Z",
  "completed_at": "2026-07-15T10:00:00.000Z"
}
```

`amount`/`balance_before`/`balance_after` はBigInt値を文字列化して返す (JSONの
数値精度制約を避けるため)。数値としてではなく文字列として受け取り、必要な桁数を
扱えるライブラリでパースしてください。

### 8.2 `POST /api/v1/transactions/debit`

```json
{
  "service_code": "AIART",
  "external_user_id": "AIART-USER-123",
  "amount": 3000,
  "transaction_type": "ITEM_EXCHANGE",
  "display_name": "AIアート素材と交換",
  "source_reference_id": "ORDER-2026-0001",
  "idempotency_key": "ITEM_EXCHANGE:ORDER-2026-0001"
}
```

`source_reference_id`は外部サービス側の注文ID等を紐づけるための任意フィールド。
残高不足の場合、409 `InsufficientBalanceError`が返る (13.1章のエラー形式)。

### 8.3 `POST /api/v1/transactions/{transactionId}/reverse`

```json
{
  "reason": "二重付与のため取消",
  "idempotency_key": "REVERSE:TRX-0001"
}
```

`transactionId`はgrant/debitのレスポンスの`id`。`service_code`はURLに含まれず、
認証したAPIキーの連携先が対象取引と一致しているかをサーバー側で検証する。

### 8.4 `GET /api/v1/service/accounts/{externalUserId}/balance`

```json
{
  "ove_account_id": "01H...",
  "wallet_id": "01H...",
  "wallet_code": "OVE-WLT-...",
  "status": "ACTIVE",
  "available_balance": "60000",
  "pending_balance": "0",
  "held_balance": "0",
  "lifetime_credited": "70000",
  "lifetime_debited": "10000"
}
```

**認証済みの連携先自身に紐づく`external_user_id`のみ**照会できる。他サービスに
紐づく`external_user_id`を指定すると404になる (横断的な残高照会はできない設計)。

## 9. 冪等性

`idempotency_key`は千ノ国ウォレット独自の設計として、**HTTPヘッダーではなく
リクエストボディのフィールド**として扱う (代理店システム側のガイドが定める
`Idempotency-Key`ヘッダー方式とは異なる、千ノ国ウォレット独自の規約)。

同一の`idempotency_key`で再送した場合、新しい取引を作らず**既存の取引をそのまま
返す** (grant/debit/reverseいずれも同じ挙動)。エラーにはならない。ネットワーク
タイムアウト等で結果が不明な場合は、同じ`idempotency_key`で安全に再送してよい。

## 10. 付与ルール (`reward_rules`) による上限

`transaction_type`が`reward_rules`に登録されている場合 (例:
`AIART_ATTENDANCE_REWARD`)、以下をすべて満たさないと付与は拒否される
(`400 VALIDATION_ERROR`、メッセージに具体的な制限内容を含む)。

- `starts_at`/`ends_at`: ルールの有効期間内であること
- `per_user_limit`: そのウォレットに対する当該取引種別のCOMPLETED件数が上限未満
- `per_event_limit`: 同一`event_id`に対するCOMPLETED件数が上限未満
- `monthly_count_limit`/`monthly_amount_limit`: **ルール単位 (全ウォレット横断)**
  の当月合計が上限未満 (ユーザー単位ではないので注意)
- `global_amount_limit`: ルール単位の全期間累計が上限未満

付与ルールの内容は管理画面「付与ルール管理」で確認・設定する。事前にどの
`transaction_type`がどのルールに紐づくか、運用担当者に確認してください。

現在`transaction_type`↔`reward_rules.rule_code`が対応づけられているのは以下のみ
(`apps/api/src/rewards/rewards.service.ts`の`RULE_CODE_BY_TRANSACTION_TYPE`)。
このマッピングに無い`transaction_type`(例: 汎用の`PURCHASE_REWARD`)で付与した場合、
`reward_rules`の上限は一切適用されず、後述の11章のサービス単位の上限のみが
チェックされる (OVE有効期限も付与されない)。

| `transaction_type` | `reward_rules.rule_code` | 対象サービス |
|---|---|---|
| `REGISTRATION_BONUS` | `SENGOKU_REGISTRATION_BONUS` | `SENGOKU_PASSPORT` |
| `AIART_ATTENDANCE` | `AIART_ATTENDANCE_REWARD` | `AIART` |
| `SENGOKU_EC_PURCHASE` | `SENGOKU_EC_PURCHASE_REWARD` | `SENGOKU_EC` |

`SENGOKU_EC`(戦国EC/戦国楽市楽座)向けの購入特典ポイント付与には
**`transaction_type: "SENGOKU_EC_PURCHASE"`** を使用すること。マッピング自体は
実装済みだが、実際の上限額・付与額・有効期限日数を持つ`reward_rules`行
(`rule_code: "SENGOKU_EC_PURCHASE_REWARD"`)は、運用担当者が管理画面
「付与ルール管理」で個別に登録するまで存在しない。登録前は`per_user_limit`等の
制限なしで付与できてしまう点に注意 (11章のサービス単位上限のみ有効)。

## 11. レート制限・上限額

- `service_integrations.per_request_amount_limit`: 1リクエストあたりの上限額。
  grant/debit双方でチェックされる。
- `service_integrations.daily_amount_limit`: 1日あたりの累計付与額の上限
  (grantのみ。debitには日次上限チェックは無い)。
- HTTPレベルのレート制限 (`@Throttle`等) は現状これらのエンドポイントには
  設定されていない。上限は上記の金額ベースの業務ロジックのみで制御される。

## 12. 代理店システム(`AGENCY_SYSTEM`)専用の連携

`AGENCY_SYSTEM`は他の連携先と異なり、以下の3方向の連携を持つ。

### 12.1 同期受信 `POST /api/integrations/agencies`

sengoku-ai.comが代理店情報の作成・更新・停止等、および共通顧客HUBイベント
(`lead_created`/`common_user.merged`/`common_user.assigned_agent.updated`)を
送信してくる。詳細は `docs/agency-integration.md`「イベント種別による分岐」節を
参照。認証は4.2章の簡易鍵認証。

### 12.2 SSOログイン `POST /api/v1/auth/sso/agency`

```json
{ "token": "<sengoku-ai.com発行のRS256 JWT>", "termsAccepted": true }
```

sengoku-ai.comが発行するJWT (RS256、JWKS URL: `https://sengoku-ai.com/api/sso/jwks.php`)
を検証し、成功時は`ove_session`Cookie (HttpOnly/Secure/SameSite=None) を発行して
`{ ove_account_id: "..." }`を返す。詳細は `docs/agency-integration.md` 参照。

### 12.3 送信側: 共通顧客ID解決

千ノ国ウォレット側から`POST /api/common-users/resolve`(sengoku-ai.com側API)を
呼び出し、新規アカウント登録時に`common_user_id`を解決・保存する。これは
sengoku-ai.com側が公開しているAPIであり、千ノ国ウォレットが**呼び出す側**。
sengoku-ai.com側の開発者は、自システムの外部開発者向け連携ガイド (別紙) を参照。
送信先URL・APIキーは千ノ国ウォレット管理画面「共通顧客HUB送信設定」で設定する。

## 13. エラー形式

### 13.1 新形式 (grant/debit/reverse/代理店同期受信)

```json
{
  "ok": false,
  "error": { "code": "VALIDATION_ERROR", "message": "amount must be a positive integer" },
  "request_id": "..."
}
```

主な`code`:

| `code` | HTTPステータス | 意味 |
|---|---:|---|
| `API_KEY_REQUIRED` | 401 | 認証ヘッダー未指定 |
| `INVALID_API_KEY` | 401 | APIキー不正・署名不正・リプレイ検知・IP拒否 |
| `VALIDATION_ERROR` | 400 | リクエスト形式不正、付与ルール上限超過等 |
| `FEATURE_DISABLED` | 503 | 対象機能のFeature Flagが無効 |
| `NOT_FOUND` | 404 | 対象ウォレット・取引・アカウントが存在しない |
| `InsufficientBalanceError` | 409 | 残高不足 |
| `WalletNotActiveError` | 409 | ウォレットが停止中 |
| `TransactionNotReversibleError` | 409 | 既に取消済み等、取消できない状態 |
| `INTERNAL_ERROR` | 500 | 想定外のエラー |

### 13.2 旧形式 (残高照会・代理店SSOログイン)

```json
{ "statusCode": 401, "message": "invalid API key", "error": "Unauthorized", "requestId": "..." }
```

NestJSの標準的なエラー形式に近い。`error`フィールドは13.1章のような安定した
`code`ではなく、例外クラス名または`Unauthorized`等の汎用文字列になる。

## 14. APIキーの発行について

現時点でAPIキー・署名鍵の発行は**運用担当者による手動作業のみ**で、外部サービスが
自分でAPIキーを取得できるセルフサービス機能・管理画面は無い。新しい連携先を
追加する場合は、`service_code`(3章)を運用担当者へ伝え、`service_integrations`
行の作成を依頼すること。発行されたAPIキー・署名鍵はサーバーログへ一度だけ出力
される (再表示不可)。安全な方法で受け取り、以後は自システム側で厳重に保管する。

## 15. セキュリティ

- APIキー・署名鍵・`idempotency_key`の生値・利用者の個人情報をログへ出力しない
- HMAC署名の検証対象文字列にリクエストボディの生JSON文字列をそのまま使うため、
  送信側・受信側でJSON文字列化の実装 (キー順序・エスケープ) を完全一致させること
- 本番連携前に、必ず正常系・異常系 (署名不正・リプレイ・残高不足・付与ルール
  上限超過) の疎通確認を行うこと

## 16. 接続設定チェックリスト

外部サービス側で行うこと:

- `service_code`を運用担当者へ伝え、`service_integrations`行(APIキー・署名鍵・
  上限額)の発行を依頼する
- HMAC署名の生成ロジックを実装し、`X-OVE-Api-Key`/`X-OVE-Timestamp`/
  `X-OVE-Nonce`/`X-OVE-Signature`を付与する
- `idempotency_key`をリクエストボディに含める設計にする (HTTPヘッダーではない)
- 付与したい`transaction_type`が`reward_rules`に登録されているか、運用担当者に
  事前確認する
- 本番接続前に、正常系・異常系のテストリクエストを送信して疎通確認する

(`AGENCY_SYSTEM`のみ追加で)

- 代理店同期受信用の`x-api-key`/`Authorization: Bearer`を保存する
- SSO検証用のJWKS URL・issuer・audienceを確認する
- 共通顧客HUB送信設定 (送信先URL・system_key・APIキー) を管理画面で設定する

---

関連ドキュメント: `docs/external-api.md` (実装詳細・内部向け),
`docs/agency-integration.md` (代理店システム連携の詳細),
`docs/agency-external-developer-guide-status.md` (sengoku-ai.com側ガイドとの差分調査)
