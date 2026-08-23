/**
 * 千ノ国パスポート等との日次照合用API (`/api/v1/service/transactions/*`) の
 * `ServiceIntegration.allowedScopes`向け識別子。`wallets/wallet-service-scopes.ts`と
 * 同じ理由(Guard・運用手順・テストの3箇所で同じ文字列リテラルを重複させない)で分離する。
 */
export const TRANSACTION_SERVICE_SCOPES = {
  /** GET /api/v1/service/transactions/by-idempotency-key/:idempotencyKey */
  TRANSACTIONS_READ: "transactions.read",
  /** GET /api/v1/service/transactions/export */
  TRANSACTIONS_EXPORT: "transactions.export",
} as const;
