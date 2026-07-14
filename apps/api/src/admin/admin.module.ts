import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { AdminAuthService } from "./admin-auth.service";
import { AdminBulkGrantService } from "./admin-bulk-grant.service";
import { AdminServiceIntegrationsService } from "./admin-service-integrations.service";
import { AdminMigrationService } from "./admin-migration.service";
import { AccountsModule } from "../accounts/accounts.module";

@Module({
  imports: [AccountsModule],
  controllers: [AdminController],
  providers: [
    AdminService,
    AdminAuthService,
    AdminBulkGrantService,
    AdminServiceIntegrationsService,
    AdminMigrationService,
  ],
})
export class AdminModule {}
