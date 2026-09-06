-- 退会時に残った残高を放棄したことを表す取引種別 (docs/account-closure.md)。
--
-- 「使い切ってから退会」という当初の方針は、ORIを使う導線がまだ無いため成り立たない。
-- 段階付与により登録直後から残高が入るため、そのままでは誰も退会できなくなる。
-- 放棄を台帳へ記録したうえで退会できるようにする。
--
-- 有効期限切れの EXPIRATION とは分ける。会計上の意味が違い、失効見込みの
-- 集計 (docs/point-liability.md) を歪めないため。
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'ACCOUNT_CLOSURE_FORFEIT';
