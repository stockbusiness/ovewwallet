import {
  AccountAlreadyMergedError,
  AccountNotFoundError,
  HoldNotActiveError,
  HoldNotFoundError,
  InsufficientBalanceError,
  InvalidAmountError,
  InvalidMergeError,
  TransactionNotFoundError,
  TransactionNotReversibleError,
  WalletNotActiveError,
  WalletNotFoundError,
} from "@ove/ledger";

/**
 * 台帳コア(@ove/ledger)の例外クラスをHTTPステータス区分ごとにまとめたもの。
 * `LedgerExceptionFilter`(内部向け)と`ExternalApiExceptionFilter`(外部連携向け)
 * の両方が同じ分類を参照する。
 */
export const LEDGER_ERROR_CLASSIFICATION = {
  notFound: [WalletNotFoundError, TransactionNotFoundError, HoldNotFoundError, AccountNotFoundError],
  conflict: [
    WalletNotActiveError,
    InsufficientBalanceError,
    TransactionNotReversibleError,
    HoldNotActiveError,
    AccountAlreadyMergedError,
  ],
  badRequest: [InvalidAmountError, InvalidMergeError],
} as const;
