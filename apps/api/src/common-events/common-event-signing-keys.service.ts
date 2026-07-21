import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { generateId, type CommonEventSigningKey, type PrismaClient } from "@ove/database";
import { decryptSecret, encryptSecret } from "@ove/auth";
import { PRISMA } from "../common/prisma.module";
import { getEncryptionKey } from "../common/encryption-key";

export interface CommonEventSigningKeyView {
  id: string;
  keyId: string;
  sourceSystemKey: string;
  allowedEventTypes: string[];
  status: string;
  createdAt: Date;
  revokedAt: Date | null;
}

function toView(key: CommonEventSigningKey): CommonEventSigningKeyView {
  return {
    id: key.id,
    keyId: key.keyId,
    sourceSystemKey: key.sourceSystemKey,
    allowedEventTypes: key.allowedEventTypes,
    status: key.status,
    createdAt: key.createdAt,
    revokedAt: key.revokedAt,
  };
}

/**
 * `allowedEventTypes`のパターン(末尾".*"はprefix一致、例:"order.*"は"order.created"に一致)に
 * event_typeが一致するか判定する (次期改修指示書P0-3)。
 */
export function matchesAllowedEventType(allowedEventTypes: string[], eventType: string): boolean {
  return allowedEventTypes.some((pattern) => {
    if (pattern === "*") return true;
    if (pattern.endsWith(".*")) {
      return eventType.startsWith(pattern.slice(0, -1));
    }
    return pattern === eventType;
  });
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

  async create(params: {
    keyId: string;
    sourceSystemKey: string;
    secret: string;
    /** 明示的に許可するevent_type (省略/空の場合は何も許可しない、secure-by-default)。 */
    allowedEventTypes?: string[];
  }): Promise<CommonEventSigningKeyView> {
    const existing = await this.db.commonEventSigningKey.findUnique({ where: { keyId: params.keyId } });
    if (existing) throw new ConflictException(`key_id "${params.keyId}" already exists`);

    const created = await this.db.commonEventSigningKey.create({
      data: {
        id: generateId(),
        keyId: params.keyId,
        sourceSystemKey: params.sourceSystemKey,
        secretEncrypted: encryptSecret(params.secret, getEncryptionKey()),
        allowedEventTypes: params.allowedEventTypes ?? [],
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
  async resolveActiveSecret(
    keyId: string,
  ): Promise<{ sourceSystemKey: string; secret: string; allowedEventTypes: string[] } | null> {
    const key = await this.db.commonEventSigningKey.findUnique({ where: { keyId } });
    if (!key || key.status !== "ACTIVE") return null;

    return {
      sourceSystemKey: key.sourceSystemKey,
      secret: decryptSecret(key.secretEncrypted, getEncryptionKey()),
      allowedEventTypes: key.allowedEventTypes,
    };
  }
}
