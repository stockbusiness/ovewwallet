# モジュール化後レビュー対応 完了報告

## 対象
- PR #1 (`refactor/phase8-db-repositories` → `claude/ove-wallet-platform`)
- 対象レビュー文書: OVEWALLET_POST_REFACTOR_REVIEW_INSTRUCTIONS (P0/P1/P2優先度付き)
- 最終コミット: `1412014`

## 対応項目

| ID | 内容 | 対応 |
|---|---|---|
| P0-1 | CI「Circular dependency check」失敗 | **誤診断を修正**。実際の循環依存は存在せず(`pnpm depcruise`/`pnpm depcruise:madge`とも常に0件)、真因は`dependency-cruiser@18`がNode 20 CIランナーと非互換だったこと。`^17.4.3`へ固定して解消 |
| P0-2 | CI全テスト実行確認 | 対応完了(以下「テスト結果」参照) |
| P1-1 | 担当代理店更新+AuditLogの原子化 | `customer.assignment.changed`ハンドラの`updateAssignment`+`auditLog.create`を単一`$transaction`に統合 |
| P1-2 | common_user_id重複生成防止 | `AccountRepository.findConflictingCommonUserLinks`を追加し、`CommonUserResolvedHandler`/`CommonUserLinkingService`の両経路で、他アカウントに設定済みのcommon_user_idへの上書きを防止(検知時はAuditLogに記録し競合として無害化) |
| P1-3 | Reward上限の並行突破防止 | `RewardRuleRepository.lockByRuleCode`(`SELECT...FOR UPDATE`)を追加し、`GrantRewardUseCase`内でidempotency再確認・ルール行ロック・上限判定・CREDITを単一トランザクションに統合 |
| P1-4 | 外部アカウント作成の並行競合修正 | `AccountRegistrationService`/`ExternalAccountProvisioningService`双方でP2002一意制約違反を捕捉し、先に作成された側のアカウントを再検索して返すよう修正(500を返さない) |
| P1-5 | 旧紹介データの自己修復経路追加 | `ConfirmReferralUseCase`で、Phase 3原子化以前由来の「CREDIT既存+PENDING」不整合データを検知した場合、残高を変更せず状態のみ整合させる自己修復パスを追加。内容が想定と異なる場合は`existing_transaction_mismatch_requires_review`として自動修復しない |
| P1-6/P1-7 | Inbox/OutboxのPROCESSING固定解消(lease機構+Worker基盤、新規DBマイグレーション要) | **ユーザー合意の上で本PRからスコープ除外**。別スコープで対応 |
| P1-8 | `CommonEventsModule`の`AdminModule`依存除去 | **意図的に見送り**(理由は下記) |
| P1-9 | `@Global() RepositoriesModule`の再検討 | **意図的に見送り**(理由は下記) |
| P2-1 | イベントDTOの必須フィールド厳格化 | **意図的に見送り**(理由は下記) |
| P2-2 | Adapterのエラー種別伝播 | **意図的に見送り**(理由は下記) |

### P1-8/P1-9/P2-1/P2-2を見送った理由

いずれもP0-1で判明した「実際には循環依存が存在しない」という事実を踏まえて再評価した結果、コード変更を伴わないアーキテクチャ判断とした。

- **P1-8**: `CommonEventsModule`が`AdminModule`をimportしているのは事実だが、`AdminModule`は既に`AdminApprovalService`のみを`exports`しており(Phase 8時点で意図的に絞り込み済み)、循環依存も発生していない。`AdminApprovalService`は高額付与/高額減算・アカウント統合・移行実行という3種類の申請を共有の`approve`/`reject`/`list`ワークフローで扱う一体のサービスであり、「アカウント統合承認だけ」を切り出すには共有ワークフローの分割が必要になる。実際のバグを伴わない module-direction の見た目の改善のために、二段階承認という重要な既存フローに触れる分割リスクを取る価値はないと判断した。
- **P1-9**: `RepositoriesModule`が`@Global()`である理由は、`AccountRepository`/`RewardRuleRepository`が`AdminModule`・`CommonEventsModule`・`ReferralsModule`・`SessionAuthGuard`など多数のモジュールから参照され、モジュール単位のimportで解決しようとすると循環依存が発生するため(Phase 8時点でコード内コメントに明記済み、既存の`PrismaModule`と同一パターン)。`AccountsPersistenceModule`のような名前へ分割しても、この参照元の多さ自体は変わらず、同じ理由で結局`@Global()`が必要になる。実質的な改善にならないため見送り。
- **P2-1**: `event_version`ごとのSchema切り替えは、現状`COMMON_EVENT_SUPPORTED_VERSIONS`が`["1.0"]`のみで複数バージョンが存在しないため、切り替えの対象が無い。加えてPhase 5のコード内コメントで「正式フィールドは後方互換期間中のため任意項目のままとし、各ハンドラがmetadataフォールバックを許容する」と明記されており、これは意図的な設計。今necessaryフィールドをnon-optionalにすると、この後方互換フォールバックが機能しなくなる。
- **P2-2**: `IntegrationHttpClient`は既に`IntegrationErrorResult`(`kind`/`retryable`)を返しているが、唯一の消費者である`OutboxService.recordFailure`は現状エラー種別を見ずに一律指数バックオフ+最大8回試行というポリシー。Adapterからエラー種別を伝播しても、それを利用する実装が無ければ配線するだけの投機的な変更になる。エラー種別に応じた再送ポリシーの分岐が必要になった時点で改めて対応する。

## 変更ファイル(このレビュー対応セグメントのみ、コミット `99f1b46`〜`1412014`)

- `package.json` / `pnpm-lock.yaml` (P0-1)
- `apps/api/src/common-events/handlers/customer-assignment-changed.handler.ts` (P1-1)
- `apps/api/src/accounts/account.repository.ts` (P1-2)
- `apps/api/src/common-events/handlers/common-user-resolved.handler.ts` (P1-2)
- `apps/api/src/accounts/common-user-linking.service.ts` (P1-2)
- `apps/api/src/rewards/reward-rule.repository.ts` (P1-3)
- `apps/api/src/rewards/reward-rule-limits.ts` (P1-3)
- `apps/api/src/rewards/grant-reward.use-case.ts` (P1-3)
- `apps/api/src/accounts/account-registration.service.ts` (P1-4)
- `apps/api/src/accounts/external-account-provisioning.service.ts` (P1-4)
- `apps/api/src/referrals/confirm-referral.use-case.ts` (P1-5)
- `apps/api/src/e2e/common-events.test.ts`, `common-user-hub.test.ts`, `reward-limit-concurrency.test.ts`(新規), `account-provisioning-concurrency.test.ts`(新規), `referral-confirm-atomicity.test.ts` (回帰テスト)

## API変更
なし(既存エンドポイントの契約・レスポンス形状は変更していない)。

## DB変更
なし(新規マイグーションは無し。P1-6/P1-7のスコープ除外に伴い、lease機構用のカラム追加も本PRには含まれない)。

## 循環依存
`pnpm depcruise` / `pnpm depcruise:madge` とも0件(このセグメント開始前・完了後の両方で確認)。レビューが指摘した循環依存は当初から実在しなかった。

## テスト結果
- apps/api (Jest): 55 suites / 217 tests 全てpass
- packages/auth (Vitest): 7 files / 43 tests 全てpass
- packages/ledger (Vitest): 6 files / 29 tests 全てpass
- 合計 289 tests 全てpass
- `pnpm --filter @ove/api lint` (tsc --noEmit): 0 errors
- `npx eslint .`: 0 errors (422 warnings、いずれも本セグメント対象外の既存warning)
- GitHub Actions "test" job: success (最新コミット `1412014` 時点)

## 台帳整合性
P1-3(reward上限)・P1-4(アカウント作成)・P1-5(紹介特典確定)いずれも、行ロックまたは一意制約+再確認パターンにより「二重付与/二重作成が起きない」ことを並行リクエストの回帰テストで直接検証済み。P1-1/P1-2は監査ログ/アカウント紐付けの整合性(トランザクション原子性・重複防止)を検証。

## 未確認事項
- P1-6/P1-7(Inbox/OutboxのPROCESSING固定解消)は本PRのスコープ外。新規DBマイグレーション(lease用カラム追加)とWorkerインフラの設計が必要なため、別スコープでの対応を推奨。

## 既知の制約
- P2-1/P2-2で見送った項目は、将来的に(a) `event_version`が実際に複数サポートされる、または(b) Outbox再送ポリシーがエラー種別で分岐する必要が生じた時点で、改めて着手する前提。

## ロールバック方法
本PRは既存ブランチ(`refactor/phase8-db-repositories`)への追加コミット(`99f1b46`〜`1412014`)なので、必要であればこれら5コミットのみを`git revert`すれば、Phase 0-8の基本リファクタリングには影響を与えずレビュー対応分のみを取り消せる。
