-- 付与ルールごとの参加方法の案内先URL (LINE友だち追加など)。
-- ウォレットの「ORIを貯める」からここへ誘導する。nullなら導線を出さない。
-- URLはサービス側の都合で変わるためコードに埋めず、管理画面から編集できるようにする
-- (docs/reward-landing-url.md 参照)。
ALTER TABLE "reward_rules" ADD COLUMN "landing_url" TEXT;
