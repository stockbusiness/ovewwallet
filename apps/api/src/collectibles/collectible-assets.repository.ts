import { Inject, Injectable } from "@nestjs/common";
import type { CollectibleAsset, Prisma, PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";

type Db = PrismaClient | Prisma.TransactionClient;

export interface CreateCollectibleAssetParams {
  id: string;
  assetCode: string;
  productCode?: string | null;
  name: string;
  description?: string | null;
  imageUrl: string;
  thumbnailUrl?: string | null;
  imageHash?: string | null;
  rarity?: string | null;
  category?: string | null;
  editionSize?: number | null;
  metadata?: Prisma.InputJsonValue;
}

/**
 * NFTコレクション実装指示書11章。`CollectibleAsset`(カードマスター) への
 * Prismaアクセスを集約する。
 */
@Injectable()
export class CollectibleAssetsRepository {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async findById(id: string, client: Db = this.db): Promise<CollectibleAsset | null> {
    return client.collectibleAsset.findUnique({ where: { id } });
  }

  async findByAssetCode(assetCode: string, client: Db = this.db): Promise<CollectibleAsset | null> {
    return client.collectibleAsset.findUnique({ where: { assetCode } });
  }

  async create(data: CreateCollectibleAssetParams, client: Db = this.db): Promise<CollectibleAsset> {
    return client.collectibleAsset.create({ data });
  }

  /** 管理画面PATCH向け。指示書9章の方針通り、呼び出し元が明示的に渡したフィールドのみ更新する。 */
  async update(
    id: string,
    data: Partial<Omit<CreateCollectibleAssetParams, "id" | "assetCode">> & { status?: "ACTIVE" | "ARCHIVED" },
    client: Db = this.db,
  ): Promise<CollectibleAsset> {
    return client.collectibleAsset.update({ where: { id }, data });
  }

  async list(params: { limit: number }, client: Db = this.db): Promise<CollectibleAsset[]> {
    return client.collectibleAsset.findMany({ orderBy: { createdAt: "desc" }, take: params.limit });
  }
}
