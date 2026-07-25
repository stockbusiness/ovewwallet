import { Module } from "@nestjs/common";
import { CollectibleAssetsRepository } from "./collectible-assets.repository";
import { CollectibleHoldingsRepository } from "./collectible-holdings.repository";
import { GrantCollectibleUseCase } from "./grant-collectible.use-case";
import { RevokeCollectibleUseCase } from "./revoke-collectible.use-case";

/**
 * NFTコレクション実装指示書。`CollectibleAsset`/`CollectibleHolding`まわりの
 * Repository・UseCaseをまとめるモジュール (`CommonEventsModule`のentitlement系Handler・
 * 後続PhaseのUser/Admin Controllerから利用する)。
 */
@Module({
  providers: [CollectibleAssetsRepository, CollectibleHoldingsRepository, GrantCollectibleUseCase, RevokeCollectibleUseCase],
  exports: [CollectibleAssetsRepository, CollectibleHoldingsRepository, GrantCollectibleUseCase, RevokeCollectibleUseCase],
})
export class CollectiblesModule {}
