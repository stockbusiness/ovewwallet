# 管理画面操作 (指示書13章・14章)

`apps/admin-wallet` (Next.js, PC向け, ポート3100)。

## 実装済み画面

| 画面 | パス | 内容 |
|---|---|---|
| 管理者ログイン | `/login` | メール+パスワード |
| OVEダッシュボード | `/dashboard` | ウォレット数・発行済み残高・累計付与/利用・会員ランク分布・残高整合性チェック結果 |
| アカウント一覧 | `/accounts` | 一覧・状態(PENDING/ACTIVE/RESTRICTED/REVIEWING/LOCKED/CLOSED/MERGED)での絞り込み・ウォレットへのリンク |
| ウォレット一覧 | `/wallets` | 一覧・詳細へのリンク |
| ウォレット詳細 | `/wallets/[walletId]` | 残高・個別付与/減算/保留・保留解除・最近の取引 |
| 取引一覧 | `/transactions` | 全ウォレット横断の検索 (アカウントコード/状態/方向/取引種別)・取消。取引種別で`EXPIRATION`/`DAILY_LOGIN_BONUS`等を絞り込むことで、失効バッチや継続ログインボーナスの実行履歴確認にも使える |
| CSV一括付与 | `/bulk-grants` | CSVアップロード・プレビュー・実行・結果サマリ |
| 外部サービス管理 | `/service-integrations` | 一覧・緊急停止・再開 |
| 既存ユーザー移行 | `/migrations` | CSVアップロード・実行・結果サマリ・検証待ち(REVIEWING)アカウント一覧 (`docs/migration.md`) |
| アカウント統合 | `/accounts/merge` | 統合元→統合先へ残高・連携情報を移管 |
| 二段階承認 | `/approval-requests` | 高額付与・高額減算の承認待ち一覧、承認/却下、履歴 |
| 管理者操作ログ | `/audit-logs` | 監査ログ一覧 (削除UIなし) |
| APIアクセスログ | `/api-access-logs` | 外部サービスAPI (指示書11章) へのリクエスト履歴。認証失敗 (401) も含む。ステータスコードで絞り込み可 |
| アカウント詳細 | `/accounts/[accountId]` | 基本情報・連携ID・外部サービス連携・ウォレットへのリンク・当該アカウントの操作ログ・REVIEWING時は検証者による解消フォーム (`docs/migration.md`) |
| セキュリティ設定 | `/security` | 自分自身のMFA (二要素認証) の設定・有効化・無効化 (`docs/authentication.md` 参照) |
| 外部連携キュー | `/outbox` | Transactional Outboxの一覧・ステータス/連携先での絞り込み・試行回数/最終エラー確認・手動再送・Feature Flag確認 (`docs/integration-outbox.md` 参照) |
| 代理店連携状態一覧 | `/agency-links` | 代理店システム(sengoku-ai.com)との連携状態を一覧・絞り込み・詳細確認 (`docs/agency-integration.md` 参照) |
| 代理店紹介一覧 | `/wallet-referrals` | 紹介トークン受け入れ状況・登録特典の状態を確認 (`docs/agency-referral.md` 参照) |
| お知らせ管理 | `/notices` | ユーザー向けお知らせの作成・公開・アーカイブ。公開中のお知らせは `GET /api/v1/me/notices` 経由でウォレットホーム・お知らせ一覧に表示される |

## 外部サービス緊急停止 (指示書5章)

`POST /api/v1/admin/service-integrations/:id/suspend` で `service_integrations.status`
を `SUSPENDED` にすると、`ExternalApiAuthGuard` はAPIキー照合時に
`status: "ACTIVE"` の連携のみを対象にするため、当該サービスの既存APIキーによる
リクエストは即座に (別途のキャッシュ無効化などを待たず) 401エラーになる。
`POST /api/v1/admin/service-integrations/:id/reactivate` で再開できる。
両操作とも監査ログ (`SERVICE_INTEGRATION_SUSPEND`/`SERVICE_INTEGRATION_REACTIVATE`) に
理由付きで記録される。E2Eテスト
(`apps/api/src/e2e/service-integration-suspend.test.ts`) で、停止後に実際のAPIリクエストが
401になり、再開後に再び成功することを確認済み。

## アカウント統合 (指示書6章・13章)

`POST /api/v1/admin/accounts/merge` は統合を**申請するだけ**で、即座には実行されない。
金額によらず常に二段階承認 (下記「二段階承認」参照) の対象であり、`SUPER_ADMIN` が申請、
別の `SUPER_ADMIN`/`OVE_OPERATOR` が承認して初めて実際の統合が実行される
(`{ result: "PENDING_APPROVAL", approvalRequestId }` を返す)。管理画面
(`/accounts/merge`) では申請送信後、二段階承認画面へのリンクを表示する。

承認 (`POST /api/v1/admin/approval-requests/:id/approve`) が実行されると、
`packages/ledger/src/merge.ts` の `mergeAccounts()` が以下をすべて1つのDBトランザクション内で行う:

1. 統合元・統合先の両ウォレットを (デッドロック回避のためID昇順で) 行ロックする。
2. 統合元の `available_balance` を統合先へ全額移管する
   (`ACCOUNT_MERGE_OUT`/`ACCOUNT_MERGE_IN` の対になる取引を作成)。
3. `account_identities`/`account_links` の所有者 (`ove_account_id`) を統合先へ付け替える。
4. 統合元の有効なセッションをすべて無効化する (統合済みアカウントではログインできない)。
5. 統合元 `ove_accounts.status = MERGED`, `merged_into_account_id = 統合先ID` を設定する。

`idempotencyKey` は `ACCOUNT_MERGE:${sourceId}:${targetId}` で固定するため、同じ統合を
再度申請・承認しても冪等に成功する (二重の残高移管は発生しない)。同じ統合元を**別の**
統合先へ再度統合しようとした場合はエラーになる。
E2Eテスト (`apps/api/src/e2e/account-merge.test.ts`、`apps/api/src/e2e/account-detail.test.ts`)
と、実ブラウザでの操作確認 (2つの別々の管理者セッションで申請→承認まで実行し、残高移管・
identity付け替え・整合性チェックが0件のままであることを確認) を実施済み。

## 二段階承認 (指示書13章)

`packages/database` の `approval_requests` テーブルを使い、高額付与・高額減算・
アカウント統合を対象に基本ワークフローを実装した (`apps/api/src/admin/admin-approval.service.ts`)。

- しきい値方式 (高額付与・高額減算): `HIGH_VALUE_THRESHOLD` 環境変数
  (デフォルト 50,000 OVE)。`POST /api/v1/admin/wallets/grant`/`deduct` は、
  金額がしきい値**以上**の場合、即時実行せず `approval_requests` に
  `status: PENDING` の申請を作成し、`{ result: "PENDING_APPROVAL", approvalRequestId }`
  を返す (しきい値未満は従来通り `{ result: "COMPLETED", transaction: {...} }` で
  即時実行される)。
- 全件対象方式 (アカウント統合): 残高・連携情報の移管を伴い取り消せない操作のため、
  金額によらず常に承認が必要。`POST /api/v1/admin/accounts/merge` は常に
  `{ result: "PENDING_APPROVAL", approvalRequestId }` を返し、即時実行はしない
  (`docs/admin-operations.md` の「アカウント統合」参照)。
- `GET /api/v1/admin/approval-requests` — 一覧 (承認待ち/履歴)。種別ごとに
  `payload` の形が異なる (高額付与/減算は `{ kind, walletId, amount, reason }`、
  アカウント統合は `{ kind: "ACCOUNT_MERGE", sourceAccountCode, targetAccountCode, reason }`)。
- `POST /api/v1/admin/approval-requests/:id/approve` — `approvalRequest.requestType`
  に応じて `creditWallet`/`debitWallet`/`mergeAccounts` のいずれかを実際に実行する。
  **申請者本人は承認できない** (職務分離。同一管理者IDでの承認は400エラー)。
- `POST /api/v1/admin/approval-requests/:id/reject` — 却下 (理由必須)。対象の状態は
  一切変更されない。
- 承認・却下・申請作成はすべて監査ログに記録される
  (`APPROVAL_REQUEST_CREATED`/`APPROVED`/`REJECTED`)。

E2Eテスト (`apps/api/src/e2e/approval-workflow.test.ts`、`apps/api/src/e2e/account-merge.test.ts`、
`apps/api/src/e2e/account-detail.test.ts`) で、しきい値以上の付与・アカウント統合いずれも
保留されること・承認までは対象の状態が変化しないこと・申請者本人による承認が拒否されること・
別の管理者が承認すると実際に反映されること・却下すると状態が変化しないこと・
承認済み申請の再承認が拒否されることを検証済み。加えて、2つの別々の管理者セッションで
実ブラウザから申請→承認まで操作し、動作を確認済み。

**残る制約**: `approval_requests.request_type` にはオンチェーン移行・外部ウォレット変更・
APIサービス上限変更の値も用意しているが、これらを本ワークフローに乗せる実装
(申請→承認の強制) は未着手 (対応する機能自体が本リポジトリにまだ実装されていないため)。

## 取引一覧・取引取消 (指示書13章)

`GET /api/v1/admin/transactions` はアカウントコード・状態 (`COMPLETED`/`HELD`/
`REVERSED`/`FAILED`)・方向 (`CREDIT`/`DEBIT`) でフィルタし、全ウォレット横断で
取引を検索できる (各行に `account_code` を含める)。`COMPLETED` の行には取消ボタンを
表示し、既存の `POST /api/v1/admin/transactions/:transactionId/reverse` を呼び出す。
存在しないアカウントコードで検索した場合はエラーではなく空配列を返す。
E2Eテスト (`apps/api/src/e2e/transactions-list.test.ts`) と実ブラウザでの
フィルタ操作・取消操作を確認済み。

## 付与ルール管理 (指示書13章)

`/reward-rules` 画面から `reward_rules` の作成・状態切替 (ACTIVE/INACTIVE)・
上限値の調整ができる (`GET/POST /api/v1/admin/reward-rules`,
`PATCH /api/v1/admin/reward-rules/:ruleCode`)。作成はSUPER_ADMIN限定、閲覧は
SUPER_ADMIN/OVE_OPERATOR/EVENT_OPERATOR/AUDITORに許可している。

**既知の制約**: `rewards.service.ts` の `RULE_CODE_BY_TRANSACTION_TYPE` が
`transaction_type -> rule_code` を固定的にマッピングしているため、この画面で新規に
作成したルールは、対応する`transaction_type`がそのマッピングに登録されていない限り
外部APIの `/rewards/grant` から自動的には適用されない。既存の2ルール
(`SENGOKU_REGISTRATION_BONUS`, `AIART_ATTENDANCE_REWARD`) の上限・状態変更には
即座に反映される。E2Eテスト (`apps/api/src/e2e/reward-rules-admin.test.ts`) と
実ブラウザでの作成・状態切替を確認済み。

同画面には有効期限日数の設定・失効バッチの手動実行・失効予告レポート
(`docs/credit-expiry.md`参照) もある。

## APIアクセスログ (指示書11章・13章)

外部サービスAPI (`/api/v1/rewards/grant`, `/api/v1/transactions/debit`,
`/api/v1/transactions/:transactionId/reverse`) へのすべてのリクエストを
`api_access_logs` テーブルに記録する。

- 認証段階での拒否 (APIキー不正・署名不正・nonce再利用・タイムスタンプずれ・IP制限など、
  常に401) は `ExternalApiAuthGuard` が記録する。この場合 `service_integration_id` は
  APIキーが特定できていれば設定されるが、キー自体が不正な場合は `null` になる。
  `api_key_prefix` (先頭10文字) のみを記録し、APIキー全体は保存しない。
- 認証成功後の業務ロジックの結果 (成功・バリデーションエラー・残高不足など) は
  `ApiAccessLogInterceptor` が記録する (Guard実行後、Interceptorが実行される
  NestJSの実行順序を利用し、認証成功済みリクエストのみを対象とする)。
- ログ書き込み自体の失敗はAPIリクエストの本来の処理結果に影響しない
  (`try/catch` で握りつぶし、リクエスト処理は継続する)。
- `GET /api/v1/admin/api-access-logs` で一覧取得。`serviceIntegrationId`/
  `statusCode`/`limit` でフィルタ可能。`SUPER_ADMIN`/`AUDITOR`/`INTEGRATION_ADMIN`
  ロールのみ閲覧可能。

`/api-access-logs` 画面ではステータスコードで絞り込んで一覧表示する。
E2Eテスト (`apps/api/src/e2e/api-access-logs.test.ts`) で、認証失敗・認証成功後の
業務エラーの両方が記録されること、管理APIのフィルタが機能すること、権限のない
ロールでは403になることを検証済み。実ブラウザでも一覧表示・フィルタ操作を確認済み。

## アカウント詳細 (指示書13章)

`/accounts/[accountId]` (`GET /api/v1/admin/accounts/:accountId`) は、アカウント一覧
からアカウントコードをクリックすると開く個別画面。以下を1画面にまとめて表示する:

- 基本情報 (メール・電話・本人確認レベル・ウォレットへのリンク)。
- 連携ID (`account_identities`): LINE/メール/電話/パスキーなどログイン手段の一覧。
- 外部サービス連携 (`account_links`): 戦国パスポート・AIアート教室等、どのサービスの
  どの外部ユーザーIDと連携しているか。
- このアカウントに関する操作ログ (`audit_logs` を `targetType: "ove_account"` /
  `targetId: accountId` で絞り込んだもの)。アカウント統合など、このアカウントに対して
  行われた管理操作の履歴を直接確認できる。
- アカウントが統合 (`MERGED`) 済みの場合、統合先アカウントへのリンクを警告バナーで表示する。
- セキュリティ: アクティブセッション数の表示と、「全セッションを無効化」ボタン
  (`POST /api/v1/admin/accounts/:accountId/revoke-sessions`、`docs/security.md` の
  「全セッション無効化」参照)。不正利用が疑われるアカウントを即座に全端末からログアウト
  させられる。

存在しないアカウントIDを指定した場合は404を返す (画面側では「アカウントが見つかりません」
と表示)。E2Eテスト (`apps/api/src/e2e/account-detail.test.ts`) で、基本情報・連携ID・
外部サービス連携が正しく返ること・存在しないIDで404になること・統合済みアカウントで
統合先が表示されることを検証済み。実ブラウザでも通常アカウント・統合済みアカウントの
両方の表示を確認済み。

## 未実装画面 (今後の課題)

なし。発行量の時系列グラフはダッシュボード画面 (`/dashboard`) の`TrendChart`
(過去30日のCREDIT/DEBIT推移) として実装済み。

## 管理者権限

`admin_users.role`: `SUPER_ADMIN` / `OVE_OPERATOR` / `INTEGRATION_ADMIN` /
`EVENT_OPERATOR` / `AUDITOR` / `VIEWER`。付与・減算・保留・保留解除・取消は
`SUPER_ADMIN` と `OVE_OPERATOR` のみ許可 (`apps/api/src/admin/admin.controller.ts` の
`@Roles(...)`)。監査ログ閲覧は `SUPER_ADMIN` と `AUDITOR` のみ。

## CSV一括付与の仕様

CSV形式:

```
external_user_id,amount,transaction_name,reason,event_id,idempotency_key
```

- `external_user_id` は **OVEアカウントコード** (例: `OVE-ACC-00000001`) を指定する
  (指示書のCSV列名をそのまま使っているが、外部サービスIDではなくOVE内部のアカウント
  コードを指す運用とした。理由: CSV列にservice_codeが存在しないため)。
- 処理結果: 総件数・正常件数・重複件数・ユーザー不明件数・エラー件数・合計付与予定OVE。
- 同じCSVを再実行しても、行ごとの `idempotency_key` により二重付与されない
  (実際にCSVを2回投入するテストで確認済み)。
- **プレビュー→実行の2段階フロー**: `POST /api/v1/admin/bulk-grants/preview` が
  ウォレットを一切更新せずに集計結果 (総件数/正常/重複/ユーザー不明/エラー/合計付与予定OVE)
  と `batchId` (`bulk_grant_batches` に `status: PREVIEWED` で保存) を返す。管理者が内容を
  確認した上で `POST /api/v1/admin/bulk-grants/execute` に同じCSVと `batchId` を渡すと
  実際に付与を実行し、対応するバッチを `status: COMPLETED` に更新する。
  (raw CSV行はDBへ保存していないため、実行時も同じCSV本文を送る必要がある)。
  E2Eテスト (`apps/api/src/e2e/bulk-grant.test.ts`) でプレビュー時に残高が変化しないこと、
  実行後に反映されること、再実行しても二重付与されないことを確認済み。

## 二段階承認 (指示書13章)

`approval_requests` テーブルのみ用意し (申請者/承認者を分離できるデータ構造)、
API・画面上のワークフロー実装はフェーズ6の課題として未着手。
