import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { AdminAuthService } from "./admin-auth.service";
import { AdminBulkGrantService } from "./admin-bulk-grant.service";

@Module({
  controllers: [AdminController],
  providers: [AdminService, AdminAuthService, AdminBulkGrantService],
})
export class AdminModule {}
