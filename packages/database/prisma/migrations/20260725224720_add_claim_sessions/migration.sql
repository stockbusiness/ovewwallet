-- CreateTable
CREATE TABLE "claim_sessions" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_encrypted" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claim_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "claim_sessions_token_hash_key" ON "claim_sessions"("token_hash");
