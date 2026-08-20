/**
 * PR-W2: ServiceIntegration.allowedScopes に格納する拡張API操作の識別子。
 * 1箇所にまとめ、Guard・付与手順(docs/runbooks/grant-service-scope.md)・テストの
 * 3箇所で同じ文字列リテラルを重複させない。
 */
export const WALLET_SERVICE_SCOPES = {
  BALANCE_READ_COMMON_USER: "wallet.balance.read.common-user",
} as const;
