import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { CollectibleAsset, CollectibleHolding, CollectibleHoldingStatus } from "@ove/database";
import { z } from "zod";
import type { CollectibleHoldingWithAsset } from "../collectibles/collectible-holdings.repository";
import { AdminAuthGuard, type AuthenticatedAdminRequest } from "../common/admin-auth.guard";
import { Roles, RolesGuard } from "../common/roles.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AdminCollectiblesService } from "./admin-collectibles.service";
import {
  CreateCollectibleAssetSchema,
  RevokeCollectibleHoldingSchema,
  UpdateCollectibleAssetSchema,
} from "./dto/admin-collectibles.dto";

/** NFTコレクション実装指示書14章。カードマスター管理と保有検索・手動取消。 */
@ApiTags("admin-collectibles")
@Controller("api/v1/admin/collectible")
export class AdminCollectiblesController {
  constructor(private readonly collectibles: AdminCollectiblesService) {}

  @Get("assets")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "OVE_OPERATOR", "EVENT_OPERATOR", "AUDITOR")
  async listAssets(@Query("limit") limit?: string): Promise<CollectibleAsset[]> {
    return this.collectibles.listAssets(limit ? Number(limit) : undefined);
  }

  @Get("assets/:id")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "OVE_OPERATOR", "EVENT_OPERATOR", "AUDITOR")
  async getAsset(@Param("id") id: string): Promise<CollectibleAsset> {
    return this.collectibles.getAsset(id);
  }

  @Post("assets")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "OVE_OPERATOR")
  async createAsset(
    @Body(new ZodValidationPipe(CreateCollectibleAssetSchema)) body: z.infer<typeof CreateCollectibleAssetSchema>,
  ): Promise<CollectibleAsset> {
    return this.collectibles.createAsset(body);
  }

  @Patch("assets/:id")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "OVE_OPERATOR")
  async updateAsset(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateCollectibleAssetSchema)) body: z.infer<typeof UpdateCollectibleAssetSchema>,
  ): Promise<CollectibleAsset> {
    return this.collectibles.updateAsset(id, body);
  }

  @Get("holdings")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "OVE_OPERATOR", "EVENT_OPERATOR", "AUDITOR")
  async searchHoldings(
    @Query("common_user_id") commonUserId?: string,
    @Query("account_code") accountCode?: string,
    @Query("entitlement_id") entitlementId?: string,
    @Query("order_id") orderId?: string,
    @Query("product_code") productCode?: string,
    @Query("status") status?: string,
    @Query("token_id") tokenId?: string,
    @Query("limit") limit?: string,
  ): Promise<CollectibleHoldingWithAsset[]> {
    return this.collectibles.searchHoldings({
      commonUserId,
      accountCode,
      entitlementId,
      orderId,
      productCode,
      status: status as CollectibleHoldingStatus | undefined,
      tokenId,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get("holdings/:id")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "OVE_OPERATOR", "EVENT_OPERATOR", "AUDITOR")
  async getHolding(@Param("id") id: string): Promise<CollectibleHoldingWithAsset> {
    return this.collectibles.getHolding(id);
  }

  @Post("holdings/:id/revoke")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "OVE_OPERATOR")
  async revokeHolding(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(RevokeCollectibleHoldingSchema)) body: z.infer<typeof RevokeCollectibleHoldingSchema>,
    @Req() req: AuthenticatedAdminRequest,
  ): Promise<CollectibleHolding> {
    return this.collectibles.revokeHolding(id, req.admin.id, body.reason);
  }
}
