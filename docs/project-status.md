# 独立OVEウォレット 実装状況整理 (2026-07-15時点)

このドキュメントは、現時点までに実装が完了している機能・未着手の機能・今後の連携方針を
1枚で把握できるように整理したものです。個別の詳細仕様は各 `docs/*.md` を参照してください。

## 1. 全体構成

```
apps/
  api/            NestJS製REST API (ユーザー向け・外部サービス向け・管理者向けを統合)
  user-wallet/    ユーザー向けNext.jsアプリ (スマートフォン優先, 戦国ウォレットデザイン)
  admin-wallet/   管理者向けNext.jsアプリ (PC向け)
packages/
  database/       Prisma schema・マイグレーション
  ledger/         台帳コア (CREDIT/DEBIT/REVERSAL/HOLD/RELEASE・整合性チェック)
  auth/           セッション・OTP・SSO・HMAC認証・TOTP等の暗号/認証ユーティリティ
  shared-types/   共通enum・Zodスキーマ
  shared-ui/      戦国ウォレットデザインシステム (共通UIコンポーネント)
  config/         環境変数検証
```

PostgreSQL 16 + Redis (KVストア、未設定時はインメモリへフォールバック) を使用。
DBスキーマ・API・管理画面・ユーザー画面のすべてに対して、実DBに対する自動テスト
(現時点で API 55件 + `packages/auth` 25件 + `packages/ledger` 21件 = 計101件、すべて成功)
と、実ブラウザ (Playwright) での動作確認を行っています。

## 2. 実装済み機能

### 2.1 台帳・ウォレット基盤
- OVEアカウント・ウォレットの自動作成、CREDIT/DEBIT/REVERSAL/HOLD/RELEASEの5種類の
  取引タイプ、idempotencyキーによる二重実行防止、行ロックによる並行更新の安全性。
- 残高整合性チェック (`GET /api/v1/admin/reconciliation`)。
- 取引の直接UPDATE/DELETEを一切行わない設計 (訂正は必ずREVERSALで記録)。
- 詳細: `docs/ledger-rules.md`, `docs/database.md`

### 2.2 認証・アカウント
- ログイン手段: メールOTP (実装済み・本番相当)、LINE (**モック実装**、後述)、
  戦国パスポートSSO (**モック実装**)。
- OVE独自セッション (HttpOnly Cookieトークン)。
- **利用規約同意の永続化**: 新規アカウント作成時に同意を必須化し、`ove_accounts` に
  同意日時・バージョンを記録 (既存アカウントの再ログインでは再同意不要)。
- **全セッション無効化**: 管理者がアカウント単位で全端末のセッションを即座に失効させる
  機能 (不正利用時の対応用)。
- 詳細: `docs/authentication.md`

### 2.3 外部サービスAPI連携 (代理店システム等の連携もこの仕組みを利用する想定)
- `service_integrations` テーブルで連携先ごとにAPIキー・署名シークレット・
  1日あたり/1リクエストあたりの上限を管理。
- HMAC-SHA256署名 + タイムスタンプ + nonceによるリプレイ防止 (`docs/external-api.md`)。
- 主要エンドポイント: ポイント付与 (`/rewards/grant`)、利用 (`/transactions/debit`)、
  取消 (`/transactions/{id}/reverse`)、残高照会・取引履歴照会。
- 連携先の緊急停止・再開機能 (即座にAPIキーを無効化)。
- APIアクセスログ (成功・認証失敗の両方を記録、管理画面で検索可能)。
- **この仕組みは戦国パスポート/AIアート教室などの想定連携先に限定されておらず、
  新しい連携先 (代理店システムなど) を `service_integrations` に1行追加するだけで
  同じ認証・上限管理・ログの仕組みに乗せられます** (下記4章を参照)。

### 2.4 管理画面 (`apps/admin-wallet`, PC向け)
実装済み画面: ダッシュボード (KPI・過去30日推移グラフ・最近の取引・整合性チェック、
戦国ウォレットデザイン刷新済み)、アカウント一覧・アカウント詳細 (連携ID・外部サービス
連携・操作ログ・全セッション無効化)、ウォレット一覧・詳細、取引一覧・取消、CSV一括付与、
付与ルール管理、外部サービス管理、既存ユーザー移行、アカウント統合、二段階承認
(高額操作の職務分離)、操作ログ、APIアクセスログ、セキュリティ設定 (**管理者MFA**:
RFC 6238準拠のTOTP二要素認証、外部ライブラリ非依存で自前実装)、**外部連携キュー**
(Transactional Outboxの一覧・ステータス/連携先での絞り込み・手動再送・Feature Flag確認)。

### 2.5 ユーザー向けウォレット画面 (`apps/user-wallet`, スマートフォン優先)
「戦国ウォレット UIデザイン仕様 v1.0」(黒・濃紺・金・深紅を基調としたデザイン) で
以下の画面を実装済み: ログイン (LINE/メール/戦国パスポートIDの3方式 + 利用規約同意)、
ウォレットホーム、取引履歴一覧 (獲得/利用/失効フィルタ)、取引詳細。
共通コンポーネント (`packages/shared-ui`) として切り出し済み。375px/768px/1280pxで
レスポンシブ確認済み。詳細: `docs/ui-design.md`

### 2.6 セキュリティ
入力値検証・SQLインジェクション対策・XSS対策・CSRF対策・ブルートフォース対策・
レート制限・監査ログ (削除不可)・高額操作の二段階承認・管理者MFA・全セッション無効化まで
実装済み。詳細と既知の残課題は `docs/security.md`。

## 3. LINE連携について (現在保留)

LINEログインは指示書に基づき **モック実装** の状態です
(`packages/auth/src/sso.ts` の `MockLineAuthVerifier`。`mock.<lineUserId>` 形式の
IDトークンをそのまま信用する開発用の仮実装で、LINE Platform APIとの実通信は行っていません)。

インターフェース (`LineAuthVerifier`) は確定済みで、本番実装は実装クラスの差し替えのみで
対応可能な設計にしていますが、**LINE本番連携(LIFF/LINE Login SDK・実際のチャネル発行等)
は、今回の方針転換によりいったん着手を保留**しています。ユーザー向けログイン画面の
「LINEでログイン」ボタン自体は残していますが、引き続きモック接続のままです。

戦国パスポートSSO (`SengokuSsoService`) についても同様にモック実装のままです。

## 4. 代理店システムなど外部システム連携に向けて

ご要望の「代理店システムなどとの連携」は、LINE個人向けログインとは別の話で、
**2.3で説明した外部サービスAPI連携の仕組み (`service_integrations` + HMAC認証)** が
そのまま使えます。想定される拡張ステップ:

1. `service_integrations` に代理店システム用のAPIキー・署名シークレット・上限を発行
   (`ServiceCode` enumへの追加、または既存の仕組みを流用する形での識別子追加)。
2. 代理店システム側は、HMAC署名を付けて `/rewards/grant` (付与) や
   `/transactions/debit` (利用消し込み) 等を呼び出すだけで連携可能。
3. 代理店側ユーザーとOVEアカウントの対応付けは `account_links` テーブル
   (`findOrCreateByServiceLink`) で、初回付与時に自動的にアカウント・ウォレットが
   作られる設計のため、代理店側で個別のアカウント発行APIを別途呼ぶ必要はありません。
4. 代理店ごとのAPIアクセスログ・緊急停止・上限管理はすでに管理画面から行えます。

つまり、**代理店連携そのものの土台はすでに用意されている**状態です。実際に着手する際は、
代理店システム側の認証方式 (HMAC方式でよいか、IPアドレス制限が必要か等) や、
付与/消し込みの粒度・レート制限値の要件をヒアリングした上で、`service_integrations` への
登録とドキュメント整備 (`docs/external-api.md` への連携先追加) を行う想定です。

## 5. 「OVEウォレット開発・連携上の留意事項 v1.0」への対応状況

代理店システム等の外部連携を見据えたガイドライン文書 (2026-07-15付) を踏まえ、
その17章のPhase区分に沿って以下の対応を行っています。

- **Phase 1 (本番前セキュリティ) — 完了**:
  - 本人向けAPIを `GET /api/v1/me/wallet` / `/me/transactions` / `/me/transactions/{id}`
    に分離し、URLでOVEアカウントIDを受け取らずセッションから本人を特定する方式へ変更。
  - 外部サービス向け残高照会 `GET /api/v1/service/accounts/{externalUserId}/balance`
    を新設し、認証済みの連携先自身に紐づく利用者のみ照会できるようにした
    (他サービスの利用者は404)。
  - 旧 `GET /api/v1/wallets/{oveAccountId}/...` (誰でも`oveAccountId`を知っていれば
    参照できた実装) は廃止。
  - `NODE_ENV=production` かつ `AUTH_MODE` が `production` 以外ならアプリ起動を
    失敗させるガードを追加 (モック認証のまま本番稼働することを防止)。
  - 詳細: `docs/security.md`, `docs/external-api.md`, `docs/authentication.md`
- **Phase 1.5 (素地インフラ: Transactional Outbox・Feature Flag) — 完了**:
  代理店システム側の実装と並行して進められる、契約仕様に依存しない基盤部分のみ着手
  (ガイドライン10章・13章)。
  - `integration_outbox` テーブルと `OutboxService` を実装。`enqueue()`は既存の業務トランザクション
    内から呼び出す想定の冪等な登録 (同一`idempotencyKey`では重複登録しない)、
    `processPendingEvents()`は宛先ハンドラへの送信・失敗時の指数バックオフ再送
    (最大8回、最終的に`FAILED`)を行う。宛先ハンドラは`registerDestination()`で後から
    差し込む方式 (LINE/SSOのモック→実装差し替えパターンと同様)。実際の代理店連携先
    ハンドラはまだ登録されていない (キューの土台のみ)。
  - Feature Flag基盤 (`ENABLE_PLATFORM_USER_ID`等7個、すべて既定false) を実装。
    どのコードもまだこれらのフラグを参照しておらず、OFFのままで既存機能に影響しないことを
    自動テストで確認済み。
  - 管理画面に「外部連携キュー」画面を追加 (キュー一覧・ステータス/連携先での絞り込み・
    試行回数・最終エラー内容・手動再送・Feature Flag確認)。
  - **紹介情報受入 (ref_token/referral_session) や代理店システムとの実際の通信は含まれない**。
    これらはガイドライン19章の指示通り、代理店システム側の仕様が固まった時点で改めて
    現状調査と影響範囲をMarkdownにまとめてから着手します。
- **Phase 2以降 (紹介情報受入基盤・代理店紹介同期・登録特典連動・外部サービス本番連携) —
  未着手**: `referral_session`/`agency_referral_links`はまだ存在しません。

## 6. 未実装・今後の課題

- LINE本番連携・戦国パスポート本番SSO交換 (今回保留)。
- 二段階承認のアカウント統合・オンチェーン移行・APIサービス上限変更への拡張
  (現状は高額付与/高額減算のみ対象、`docs/admin-operations.md` 参照)。
- 既存ユーザー移行の検証者フロー・文字コード対応の強化。
- インフラ整備は一通り対応済み: `audit_logs`のDBレベルDELETE/UPDATE禁止、ログイン系
  エンドポイントのレート制限強化、`ENCRYPTION_KEY`ローテーション手順・CORS本番設定の
  文書化、3アプリの本番用Dockerfile。ただし本番用Dockerfileは、このリポジトリの開発
  コンテナにDockerデーモンが無く `docker build`/`docker run` そのものは未実行
  (各ビルドステップに相当する処理は個別に成功確認済み。`docs/deployment.md`
  「Dockerイメージ (本番)」の「検証状況」参照)。実際にDockerが使える環境での
  エンドツーエンド検証が必要。詳細は`docs/security.md`・`docs/deployment.md`参照。
- Playwright E2Eのリポジトリ内自動化 (現状は手動実行での確認)。
- 負荷テスト。

## 7. 参考: 主要ドキュメント一覧

| ドキュメント | 内容 |
|---|---|
| `docs/architecture.md` | 全体構成・技術選定理由 |
| `docs/database.md` | データモデル詳細 |
| `docs/authentication.md` | 認証設計 (MFA・利用規約同意を含む) |
| `docs/ledger-rules.md` | 台帳ルール・整合性チェック |
| `docs/external-api.md` | 外部サービスAPI仕様 (代理店連携の土台) |
| `docs/integration-outbox.md` | Transactional Outbox・Feature Flag基盤 |
| `docs/admin-operations.md` | 管理画面の全画面説明 |
| `docs/ui-design.md` | 戦国ウォレットデザインシステム |
| `docs/security.md` | セキュリティ対策と既知の課題 |
| `docs/test-plan.md` | テスト計画と実施結果 |
| `docs/migration.md` | 既存ユーザー移行 |
| `docs/deployment.md` | デプロイ手順 |
| `docs/implementation-plan.md` | 初期実装計画・フェーズ進行状況 |
| `docs/development-guardrails.md` | 代理店システム等の外部連携に向けた開発基準 (このドキュメントの元) |
