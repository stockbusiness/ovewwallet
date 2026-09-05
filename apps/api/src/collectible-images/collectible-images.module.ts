import { Module } from "@nestjs/common";
import { CollectibleImagesController } from "./collectible-images.controller";
import { CollectibleImagesService } from "./collectible-images.service";
import { ObjectStorageService } from "./object-storage";

@Module({
  controllers: [CollectibleImagesController],
  providers: [CollectibleImagesService, ObjectStorageService],
  exports: [CollectibleImagesService],
})
export class CollectibleImagesModule {}
