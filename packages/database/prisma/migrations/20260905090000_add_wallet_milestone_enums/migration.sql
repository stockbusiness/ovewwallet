-- ウォレット内の出来事を条件にORIを付与するための種別を足す
-- (docs/milestone-rewards.md)。
--
-- 付与ルールの登録は次のマイグレーションで行う。PostgreSQLは、追加した直後の
-- enum値を同じトランザクション内で使えないため、値の追加と使用を別ファイルに分ける。
ALTER TYPE "ServiceCode" ADD VALUE 'OVE_WALLET';

-- 既存の REGISTRATION_BONUS は戦国パスポートの登録特典なので、ウォレット自身への
-- 新規登録特典は別の種別にする (付与ルール別の発行量集計が混ざらないように)。
ALTER TYPE "TransactionType" ADD VALUE 'WALLET_SIGNUP_BONUS';
ALTER TYPE "TransactionType" ADD VALUE 'PROFILE_COMPLETION_BONUS';
