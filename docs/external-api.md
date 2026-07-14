# 外部サービスAPI (指示書11章)

Base URL: `${API_URL}` (デフォルト `http://localhost:4000`)。Swagger: `/api/docs`。

## エンドポイント

| メソッド/パス | 認証 | 説明 |
|---|---|---|
| `POST /api/v1/rewards/grant` | HMAC (外部サービス) | ポイント付与。idempotency必須 |
| `POST /api/v1/transactions/debit` | HMAC (外部サービス) | ポイント利用 (減算) |
| `POST /api/v1/transactions/{transactionId}/reverse` | HMAC (外部サービス) | 取消 |
| `GET /api/v1/wallets/{oveAccountId}/balance` | なし (MVP) | 残高照会 |
| `GET /api/v1/wallets/{oveAccountId}/transactions` | なし (MVP) | 取引履歴 |

> 残高照会・取引履歴は現状 `oveAccountId` を知っていれば誰でも参照できる実装になっている。
> 本番投入前に、サービス連携ごとのアクセス制御 (自サービスに紐付くアカウントのみ参照可) を
> 追加する必要がある (既知の課題として `docs/security.md` にも明記)。

## 外部API認証 (HMAC)

`packages/auth/src/external-api-auth.ts` の `ExternalApiAuthenticator` が検証するヘッダー:

```
X-OVE-Api-Key: ovk_...
X-OVE-Timestamp: <epoch millis>
X-OVE-Nonce: <ランダム文字列>
X-OVE-Signature: HMAC-SHA256(signing_secret, "<timestamp>.<nonce>.<method>:<path>:<raw body>")
```

- タイムスタンプの許容ずれ: ±5分。
- nonce はサービス単位でRedis (`REDIS_URL` 未設定時はインメモリ) に記録し、再利用 (リプレイ)
  を拒否する。
- 署名対象文字列の組み立ては `Node.js` の `JSON.stringify(req.body)` と完全一致させる必要が
  ある (キー順序・エスケープに注意。非ASCII文字はエスケープしないこと)。
- サービス別上限 (`daily_amount_limit`) と1リクエスト上限 (`per_request_amount_limit`) を
  `service_integrations` テーブルの値でチェックする。

## リクエスト例 (`POST /api/v1/rewards/grant`)

```json
{
  "service_code": "AIART",
  "external_user_id": "AIART-USER-123",
  "event_type": "ATTENDANCE",
  "event_id": "AIART-20260715-001",
  "amount": 10000,
  "transaction_type": "AIART_ATTENDANCE",
  "display_name": "AIアート教室参加特典",
  "idempotency_key": "AIART_ATTENDANCE:AIART-20260715-001:AIART-USER-123"
}
```

初回呼び出し時、`external_user_id` に対応するOVEアカウントが存在しなければ
アカウント・ウォレット・連携をまとめて自動作成する
(`apps/api/src/accounts/accounts.service.ts` の `findOrCreateByServiceLink`)。

## 付与ルール (reward_rules) の上限enforcement

`transaction_type: REGISTRATION_BONUS / AIART_ATTENDANCE` については、対応する
`reward_rules` 行 (`SENGOKU_REGISTRATION_BONUS` / `AIART_ATTENDANCE_REWARD`) の
以下の制約をすべて検証する (`apps/api/src/rewards/rewards.service.ts`):

- `starts_at`/`ends_at`: ルールの有効期間外なら拒否
- `per_user_limit`: そのウォレットに対する当該取引種別のCOMPLETED件数が上限以上なら拒否
- `per_event_limit`: 同一 `event_id` に対するCOMPLETED件数が上限以上なら拒否
- `monthly_count_limit`/`monthly_amount_limit`: **ルール単位 (キャンペーン全体、
  全ウォレット横断) の当月合計** が上限に達する/超えるなら拒否
- `global_amount_limit`: ルール単位の全期間累計が上限を超えるなら拒否

`monthly_count_limit`/`monthly_amount_limit` は `per_user_limit` (ユーザー単位) とは
異なり、当初の実装では誤ってウォレット単位で集計してしまうバグがあった
(実装中にテストで発見・修正。`docs/test-plan.md` 参照)。

## 動作確認済みの内容

実際にHTTPリクエストを送って以下を確認済み (シミュレーションではなく実通信):

- 正しい署名でのリクエスト成功、アカウント自動作成、残高加算
- 同一 `idempotency_key` を異なるnonceで再送 → 同一取引が返り二重加算されない
- 同一nonceでの完全リプレイ → 401エラー
- `reward_rules.per_event_limit` の超過拒否
- debit / reverse の一連の流れ (残高減算 → 取消で復元)
