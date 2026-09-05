import { Module } from "@nestjs/common";
import { CollectibleImagesController } from "./collectible-images.controller";
import { CollectibleImagesService } from "./collectible-images.service";
import { ObjectStorageService } from "./object-storage";
import { CollectibleImageStorageConfigService } from "./storage-config.service";

@Module({
  controllers: [CollectibleImagesController],
  providers: [CollectibleImagesService, ObjectStorageService, CollectibleImageStorageConfigService],
  // 管理画面 (AdminModule) から設定の読み書きと接続テストに使う。
  exports: [CollectibleImagesService, ObjectStorageService, CollectibleImageStorageConfigService],
})
export class CollectibleImagesModule {}
