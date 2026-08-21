import { Inject, Injectable } from "@nestjs/common";
import type {
  CollectibleEntitlementTombstone,
  Prisma,
  PrismaClient,
} from "@ove/database";
import { PRISMA } from "../common/prisma.module";

type Db = PrismaClient | Prisma.TransactionClient;

export interface CreateTombstoneParams {
  id: string;
  entitlementId: string;
  sourceSystemKey: string;
  eventId: string;
  reason: string;
  reasonCode?: string | null;
  correlationId?: string | null;
  occurredAt?: Date | null;
  revokedAt: Date;
}

/**
 * 千ノ国NFTマーケット契約v2指示書23〜24章。`entitlement.revoked`が対応する
 * `entitlement.granted`より先に届いた場合の記録先。
 */
@Injectable()
export class CollectibleEntitlementTombstonesRepository {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async findByEntitlementId(
    entitlementId: string,
    client: Db = this.db,
  ): Promise<CollectibleEntitlementTombstone | null> {
    return client.collectibleEntitlementTombstone.findUnique({
      where: { entitlementId },
    });
  }

  async create(
    params: CreateTombstoneParams,
    client: Db = this.db,
  ): Promise<CollectibleEntitlementTombstone> {
    return client.collectibleEntitlementTombstone.create({
      data: {
        id: params.id,
        entitlementId: params.entitlementId,
        sourceSystemKey: params.sourceSystemKey,
        eventId: params.eventId,
        reason: params.reason,
        reasonCode: params.reasonCode ?? null,
        correlationId: params.correlationId ?? null,
        occurredAt: params.occurredAt ?? null,
        revokedAt: params.revokedAt,
      },
    });
  }
}
