# アーキテクチャ概要

## 全体構成

```
ove-wallet-platform/
├─ apps/
│  ├─ user-wallet/   Next.js 14 (App Router) — スマートフォン優先ユーザー画面 (port 3000)
│  ├─ admin-wallet/  Next.js 14 (App Router) — PC向け管理画面 (port 3100)
│  └─ api/           NestJS 10 — REST API + Swagger (port 4000)
├─ packages/
│  ├─ database/      Prisma schema・クライアント・ID/コード採番・seed
│  ├─ shared-types/  enum・zod DTOスキーマ (フロント/バック共通)
│  ├─ shared-ui/     (未使用・将来の共通UIコンポーネント抽出用に確保)
│  ├─ auth/          暗号ユーティリティ・セッション・OTP・SSOモック・HMAC認証
│  ├─ ledger/        台帳コアロジック (CREDIT/DEBIT/REVERSAL/HOLD/RELEASE/整合性チェック)
│  └─ config/        環境変数のzod検証
├─ docs/
└─ tests/            (現状は各パッケージ/アプリ内にテストを配置。ルート直下は未使用)
```

外部サービス (戦国パスポート等) は `apps/api` のREST API経由でのみOVEウォレットと連携し、
DBへ直接アクセスすることはない。フロントエンド2アプリも `apps/api` を経由してのみ
データへアクセスする (Next.jsからPrismaを直接呼び出す実装は存在しない)。

## リクエストフロー例: 外部サービスからのポイント付与

```
戦国パスポート/AIアート教室
   │  POST /api/v1/rewards/grant (HMAC署名)
   ▼
apps/api (NestJS)
   │  ExternalApiAuthGuard: APIキー照合 → HMAC検証 → nonce/リプレイチェック
   │  RewardsService: idempotency確認 → 上限チェック → アカウント自動作成
   ▼
packages/ledger (creditWallet)
   │  行ロック → 重複確認 → 取引作成 → 残高更新 → 監査ログ作成 (1トランザクション)
   ▼
packages/database (Prisma / PostgreSQL)
```

## 技術選定の理由

- **Prisma + PostgreSQL**: 行ロック (`SELECT ... FOR UPDATE`) を `$queryRaw` で明示的に
  発行しつつ、型安全なクエリビルダの恩恵を受けるため。
- **NestJS**: モジュール分割・Guard/Interceptorによる認証/認可の分離・Swagger統合が
  指示書の要件 (入力検証・認証・例外処理・OpenAPI定義の維持) と合致するため。
- **Zod (class-validatorではなく)**: `packages/shared-types` のスキーマをフロントエンド
  (Next.js) とバックエンド (NestJS) の両方で再利用するため。NestJS側は
  `ZodValidationPipe` (`apps/api/src/common/zod-validation.pipe.ts`) で統合している。
- **Vitest (packages) / Jest+ts-jest (apps/api)**: NestJSはデコレータメタデータ
  (`emitDecoratorMetadata`) に依存するDIを使うため、esbuildベースのVitestでは
  コンストラクタインジェクションが正しく動作しない (実装中に実際に確認)。そのため
  `apps/api` のみ実TypeScriptコンパイラを使うts-jestを採用している。

## データフローの原則

正式な残高根拠は常に `ove_transactions` (取引台帳)。`wallets.available_balance` は
キャッシュ値であり、`packages/ledger` の関数を経由した更新でのみ変化する。
定期的に `packages/ledger/src/reconcile.ts` で台帳から再計算した値とキャッシュ値を
突き合わせ、不一致を検知する (自動修正はしない)。
