import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { generateId, type CommonEventSigningKey, type PrismaClient } from "@ove/database";
import { decryptSecret, encryptSecret } from "@ove/auth";
import { PRISMA } from "../common/prisma.module";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "dev-only-insecure-encryption-key";

export interface CommonEventSigningKeyView {
  id: string;
  keyId: string;
  sourceSystemKey: string;
  status: string;
  createdAt: Date;
  revokedAt: Date | null;
}

function toView(key: CommonEventSigningKey): CommonEventSigningKeyView {
  return {
    id: key.id,
    keyId: key.keyId,
    sourceSystemKey: key.sourceSystemKey,
    status: key.status,
    createdAt: key.createdAt,
    revokedAt: key.revokedAt,
  };
}

/**
 * 千ノ国 全体統合 共通実装契約 6.1章の`X-SenNoKuni-Key-Id`に対応する送信元別
 * HMAC署名鍵の管理。`CommonEventAuthGuard`はここで登録された鍵 (ACTIVEのみ) を
 * `key_id`で引いて署名検証する。ローテーションは新規鍵の追加→旧鍵のrevokeの順で行う
 * (`ServiceIntegration`のAPIキーと同じくAES-256-GCM可逆暗号化で保存する)。
 */
@Injectable()
export class CommonEventSigningKeysService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async list(): Promise<CommonEventSigningKeyView[]> {
    const keys = await this.db.commonEventSigningKey.findMany({ orderBy: { createdAt: "desc" } });
    return keys.map(toView);
  }

  async create(params: { keyId: string; sourceSystemKey: string; secret: string }): Promise<CommonEventSigningKeyView> {
    const existing = await this.db.commonEventSigningKey.findUnique({ where: { keyId: params.keyId } });
    if (existing) throw new ConflictException(`key_id "${params.keyId}" already exists`);

    const created = await this.db.commonEventSigningKey.create({
      data: {
        id: generateId(),
        keyId: params.keyId,
        sourceSystemKey: params.sourceSystemKey,
        secretEncrypted: encryptSecret(params.secret, ENCRYPTION_KEY),
        status: "ACTIVE",
      },
    });
    return toView(created);
  }

  async revoke(keyId: string): Promise<CommonEventSigningKeyView> {
    const existing = await this.db.commonEventSigningKey.findUnique({ where: { keyId } });
    if (!existing) throw new NotFoundException(`key_id "${keyId}" not found`);

    const updated = await this.db.commonEventSigningKey.update({
      where: { keyId },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
    return toView(updated);
  }

  /** `CommonEventAuthGuard`専用。ACTIVEな鍵のみ返し、復号済みシークレットを含む。 */
  async resolveActiveSecret(keyId: string): Promise<{ sourceSystemKey: string; secret: string } | null> {
    const key = await this.db.commonEventSigningKey.findUnique({ where: { keyId } });
    if (!key || key.status !== "ACTIVE") return null;

    return { sourceSystemKey: key.sourceSystemKey, secret: decryptSecret(key.secretEncrypted, ENCRYPTION_KEY) };
  }
}
