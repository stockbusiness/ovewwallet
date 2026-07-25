import { Module } from "@nestjs/common";
import { CollectibleAssetsRepository } from "./collectible-assets.repository";
import { CollectibleHoldingsRepository } from "./collectible-holdings.repository";

/**
 * NFTコレクション実装指示書。`CollectibleAsset`/`CollectibleHolding`まわりの
 * Repositoryをまとめるモジュール (後続PhaseのHandler/UseCase・User/Admin Controllerから利用する)。
 */
@Module({
  providers: [CollectibleAssetsRepository, CollectibleHoldingsRepository],
  exports: [CollectibleAssetsRepository, CollectibleHoldingsRepository],
})
export class CollectiblesModule {}
