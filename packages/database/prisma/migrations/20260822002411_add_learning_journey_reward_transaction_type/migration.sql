-- 千ノ国パスポート「はじまりの旅」学習ミッション専用の取引種別を追加する。
-- 追加型のみ (既存値の変更・削除なし)。
-- PostgreSQLの ALTER TYPE ... ADD VALUE は、追加した値を同一トランザクション内で
-- 使用しない限り通常のトランザクション内DDLとして問題なく実行できる。

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'LEARNING_JOURNEY_REWARD';
