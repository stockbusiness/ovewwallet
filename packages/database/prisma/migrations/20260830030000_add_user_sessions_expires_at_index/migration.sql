-- データ保持ジョブ (apps/api/src/scheduler/data-retention.service.ts) が
-- 期限切れセッションを `expires_at < :threshold` で抽出して削除するため、
-- 全表スキャンにならないよう索引を追加する。
-- 既存の索引は oveAccountId のみで、expires_at では引けなかった。
CREATE INDEX "user_sessions_expires_at_idx" ON "user_sessions"("expires_at");
