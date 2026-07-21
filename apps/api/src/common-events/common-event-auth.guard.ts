import { type CanActivate, type ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { CommonEventAuthenticator } from "@ove/auth";
import { KV_STORE } from "../common/kv-store.module";
import type { KeyValueStore } from "@ove/auth";
import { CommonEventSigningKeysService } from "./common-event-signing-keys.service";

export interface AuthenticatedCommonEventRequest extends Request {
  commonEventSourceSystemKey: string;
}

/**
 * 千ノ国 全体統合 共通実装契約 6.1章の`X-SenNoKuni-*`ヘッダー検証。既存の
 * `ExternalApiAuthGuard` (X-OVE-*、method+path込みの署名) や `AgencyApiKeyGuard`
 * (単純なAPIキー照合のみ) とは異なる、契約が新たに定めた認証方式のため専用ガードにする。
 *
 * 署名対象の「生ボディ」は、既存の`ExternalApiAuthGuard`と同様の理由
 * (グローバルなraw body captureミドルウェアを追加しない) により
 * `JSON.stringify(req.body)`で代替する。送信側はキー順序・エスケープをNode.jsの
 * `JSON.stringify`と一致させる必要がある (`docs/external-api.md`の既存の注記と同じ制約)。
 */
@Injectable()
export class CommonEventAuthGuard implements CanActivate {
  constructor(
    private readonly signingKeys: CommonEventSigningKeysService,
    @Inject(KV_STORE) private readonly kv: KeyValueStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    const keyId = req.header("x-sennokuni-key-id");
    const timestamp = req.header("x-sennokuni-timestamp");
    const nonce = req.header("x-sennokuni-nonce");
    const signature = req.header("x-sennokuni-signature");

    if (!keyId || !timestamp || !nonce || !signature) {
      throw new UnauthorizedException("missing X-SenNoKuni-* authentication headers");
    }

    const credentials = await this.signingKeys.resolveActiveSecret(keyId);
    if (!credentials) {
      throw new UnauthorizedException("unknown or revoked key_id");
    }

    const rawBody = JSON.stringify(req.body ?? {});
    const authenticator = new CommonEventAuthenticator(this.kv);
    await authenticator.verify(
      { keyId, timestamp, nonce, signature, rawBody, sourceSystemKey: credentials.sourceSystemKey },
      { keyId, secret: credentials.secret },
    );

    (req as unknown as AuthenticatedCommonEventRequest).commonEventSourceSystemKey = credentials.sourceSystemKey;
    return true;
  }
}
