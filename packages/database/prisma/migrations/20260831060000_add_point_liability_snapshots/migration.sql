-- 月末時点のポイント負債 (発行済み未使用残高) のスナップショット。
-- 会計の期首残高を全期間の取引を遡らずに出すために保存する
-- (docs/point-liability.md 参照)。
CREATE TABLE "point_liability_snapshots" (
    "id" TEXT NOT NULL,
    "period_end" DATE NOT NULL,
    "total_balance" BIGINT NOT NULL,
    "balance_at_capture" BIGINT NOT NULL,
    "movement_after_period" BIGINT NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "point_liability_snapshots_pkey" PRIMARY KEY ("id")
);

-- 1か月につき1行 (同じ月を二重に記録しない)。
CREATE UNIQUE INDEX "point_liability_snapshots_period_end_key" ON "point_liability_snapshots"("period_end");
