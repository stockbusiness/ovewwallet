# 退会済みアカウントの匿名化

2026-08-31実装。退会 (`docs/account-closure.md`) から猶予期間を過ぎたアカウントの
個人情報を、復元できない形にする。

導入前の退会は `status = CLOSED` と `closed_at` を立てるだけで、**氏名・メール
アドレス・電話番号・LINEユーザーIDはすべて残ったまま**だった。

## 方針

「取引履歴は残すが、**個人にたどり着く連結情報**を消す」。

台帳システムであるため取引 (`ove_transactions`) と監査ログ (`audit_logs`) は
DBトリガーで削除・更新を禁止しており、会計・監査の要件からも長期保管が前提。
これらに残る `account_id` は、氏名・連絡先・外部IDがすべて消えていれば単体では
個人を特定できない。

## 消すもの・残すもの

| テーブル | 扱い |
|---|---|
| `ove_accounts` | `display_name` / `primary_email` / `primary_phone` を NULL |
| `account_identities` | `email` / `phone` / `metadata` を NULL、`provider_subject` をハッシュに置換 |
| `user_sessions` | **対象外**。退会時に全セッションが失効し、保持ジョブ (`DataRetentionService`) が期限切れ後90日で削除する |
| `audit_logs` / `ove_transactions` | **消さない**。DBトリガーで削除・更新を禁止 (設計どおり) |
| `wallets` | **消さない**。取引から外部キーで参照されている。残高は退会条件により0 |

アカウントとidentityの更新は**同一トランザクション**で行う。途中で落ちて「氏名は
消えたがLINEユーザーIDは残っている」状態を作らないため。

## `provider_subject` を消さずハッシュにする理由

この値は**退会済みアカウントの再登録を拒否するためのキー**でもある
(`docs/account-closure.md`「退会済みアカウントは同じidentityで再ログインしようとしても
拒否される」)。単に消すと同一人物の再登録を検出できなくなり、「退会→再登録の
繰り返しを許さない」方針が静かに壊れる。

ハッシュ (HMAC-SHA256) にすれば、生のLINEユーザーID等を残さないまま照合だけ続けられる。
匿名化済みの値は `anon:` で始まる。

**照合側も2段階にしてある。** `AccountRegistrationService.findIdentity` は生の
`provider_subject` で引き、見つからなければハッシュ値でも引く。生の値だけで照合すると
匿名化済みの行に当たらず、**退会した利用者が新規ユーザーとして再登録できてしまう**。

## ハッシュ鍵 (`ANONYMIZATION_HASH_KEY`)

`ENCRYPTION_KEY` とは**別の鍵**にしている。`ENCRYPTION_KEY` にはローテーション手順が
用意されている (`docs/deployment.md`) が、ハッシュは復号できないため鍵を変えると過去に
匿名化した行と照合できなくなり、**退会済みの利用者が再登録できてしまう**。

- ローテーションしない前提で運用すること。
- **未設定なら、機能が有効でも実行せず中止する** (fail-closed)。鍵が無いまま実行すると
  二度と照合できないハッシュを書き込んでしまうため。エラーログを出すので気づける。

## 安全側の作り

削除は不可逆なので、二重に歯止めを掛けている。

1. **既定OFF**: `ENABLE_ACCOUNT_ANONYMIZATION` (Feature Flagの慣例どおり `true` を
   明示したときだけ有効)。
2. **ドライラン**: `GET /api/v1/admin/accounts/anonymization-preview` (`SUPER_ADMIN`のみ)
   が、対象件数・猶予日数・基準日・Flagと鍵の設定状況を返す。**件数のみで個人情報は
   一切返さない**。有効化する前に必ずこれで確認すること。

```json
{
  "eligibleAccounts": 42,
  "graceDays": 90,
  "closedBefore": "2026-06-02T00:00:00.000Z",
  "enabled": false,
  "hashKeyConfigured": true
}
```

## 猶予期間

退会直後に連絡先を消すと「誤って退会した」「残高の件で問い合わせたい」に一切対応
できなくなるため、猶予を置く。

| 環境変数 | 既定 | 説明 |
|---|---|---|
| `ENABLE_ACCOUNT_ANONYMIZATION` | (未設定=無効) | `true` で有効化 |
| `ANONYMIZATION_HASH_KEY` | (未設定) | ハッシュ鍵。未設定なら実行しない |
| `ACCOUNT_ANONYMIZATION_GRACE_DAYS` | `90` | 退会から何日後に匿名化するか (正の整数以外は既定値) |
| `ANONYMIZATION_CRON` | `30 20 * * *` | 実行時刻 (毎日 05:30 JST) |

**既定の90日は暫定値**。法務・社内規程で保持期間が定まったら上書きすること。

## 法務への確認事項

実装は保持日数を環境変数にしてあるため、下記の回答は**数字の設定だけで反映できる**
(コード変更は不要)。

1. 退会後、氏名・連絡先をどれだけの期間保持してよいか (`ACCOUNT_ANONYMIZATION_GRACE_DAYS`)
2. 取引履歴に `account_id` が残ることが「個人情報の保持」に当たるか
   — 当社の見解は「連結情報が消えていれば当たらない」。なお`ove_transactions`は
   DBトリガーで削除できないため、結論がどちらでも実装は変わらない
3. 会計・税務上、取引記録の保存が義務付けられる年数 (通常7年) との整合

## 実行

`account-anonymization` ジョブ (毎日 05:30 JST、`docs/runbooks/scheduled-jobs.md`)。
1回の実行で最大500アカウント、超過分は翌日に持ち越す。メンテナンスモード中は
他のジョブと同様に見送る。

匿名化のたびに監査ログ (`ACCOUNT_ANONYMIZED`) を残す。**何を消したかは残すが、消した値
そのものは残さない** (`before_data` は空)。

## 動作確認

`apps/api/src/e2e/account-anonymization.test.ts` (12件): 各項目が消えること・
`provider_subject`が生の値を含まないハッシュになること、取引とアカウント行が残ること、
監査ログに消した値が残らないこと、猶予期間内・退会していないアカウントが対象外である
こと、二重実行で作り直さないこと、**匿名化後も同じLINEユーザーIDでの再登録が拒否される
こと**、Flag無効時とハッシュ鍵未設定時に1件も消さないこと、ドライランの内容と権限。

再登録拒否のテストは、2段階照合を外すと `403` のはずが `201` (再登録成功) になることを
確認済み。
