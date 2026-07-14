export class WalletNotFoundError extends Error {
  constructor(walletId: string) {
    super(`Wallet not found: ${walletId}`);
    this.name = "WalletNotFoundError";
  }
}

export class WalletNotActiveError extends Error {
  constructor(walletId: string, status: string) {
    super(`Wallet ${walletId} is not ACTIVE (status=${status})`);
    this.name = "WalletNotActiveError";
  }
}

export class InsufficientBalanceError extends Error {
  constructor(walletId: string, available: bigint, requested: bigint) {
    super(
      `Insufficient balance on wallet ${walletId}: available=${available.toString()}, requested=${requested.toString()}`,
    );
    this.name = "InsufficientBalanceError";
  }
}

export class InvalidAmountError extends Error {
  constructor(amount: unknown) {
    super(`Amount must be a positive integer: ${String(amount)}`);
    this.name = "InvalidAmountError";
  }
}

export class TransactionNotFoundError extends Error {
  constructor(transactionId: string) {
    super(`Transaction not found: ${transactionId}`);
    this.name = "TransactionNotFoundError";
  }
}

export class TransactionNotReversibleError extends Error {
  constructor(transactionId: string, status: string) {
    super(`Transaction ${transactionId} cannot be reversed (status=${status})`);
    this.name = "TransactionNotReversibleError";
  }
}

export class HoldNotFoundError extends Error {
  constructor(holdId: string) {
    super(`Wallet hold not found: ${holdId}`);
    this.name = "HoldNotFoundError";
  }
}

export class HoldNotActiveError extends Error {
  constructor(holdId: string, status: string) {
    super(`Wallet hold ${holdId} is not HELD (status=${status})`);
    this.name = "HoldNotActiveError";
  }
}
