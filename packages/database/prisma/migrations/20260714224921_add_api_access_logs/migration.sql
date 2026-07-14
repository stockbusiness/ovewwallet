-- CreateTable
CREATE TABLE "api_access_logs" (
    "id" TEXT NOT NULL,
    "service_integration_id" TEXT,
    "api_key_prefix" TEXT,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status_code" INTEGER NOT NULL,
    "source_ip" TEXT,
    "request_id" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "api_access_logs_service_integration_id_idx" ON "api_access_logs"("service_integration_id");

-- CreateIndex
CREATE INDEX "api_access_logs_created_at_idx" ON "api_access_logs"("created_at");

-- AddForeignKey
ALTER TABLE "api_access_logs" ADD CONSTRAINT "api_access_logs_service_integration_id_fkey" FOREIGN KEY ("service_integration_id") REFERENCES "service_integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
