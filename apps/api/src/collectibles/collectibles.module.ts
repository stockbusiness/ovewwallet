import { Module } from "@nestjs/common";
import { CollectibleAssetsRepository } from "./collectible-assets.repository";
import { CollectibleHoldingsRepository } from "./collectible-holdings.repository";
import { CollectiblesQueryService } from "./collectibles-query.service";
import { GrantCollectibleUseCase } from "./grant-collectible.use-case";
import { RevokeCollectibleUseCase } from "./revoke-collectible.use-case";

/**
 * NFTコレクション実装指示書。`CollectibleAsset`/`CollectibleHolding`まわりの
 * Repository・UseCase・Query Serviceをまとめるモジュール (`CommonEventsModule`の
 * entitlement系Handler・User/Admin Controllerから利用する)。
 */
@Module({
  providers: [
    CollectibleAssetsRepository,
    CollectibleHoldingsRepository,
    CollectiblesQueryService,
    GrantCollectibleUseCase,
    RevokeCollectibleUseCase,
  ],
  exports: [
    CollectibleAssetsRepository,
    CollectibleHoldingsRepository,
    CollectiblesQueryService,
    GrantCollectibleUseCase,
    RevokeCollectibleUseCase,
  ],
})
export class CollectiblesModule {}
