import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import { CommonEventAuthenticator } from "@ove/auth";
import type { KeyValueStore } from "@ove/auth";
import type { Request } from "express";
import { KV_STORE } from "../common/kv-store.module";
import { CommonEventSigningKeysService } from "./common-event-signing-keys.service";

export interface AuthenticatedCommonEventRequest extends Request {
  commonEventSourceSystemKey: string;
  /** この鍵が送信を許可されているevent_typeパターン (次期改修指示書P0-3)。 */
  commonEventAllowedEventTypes: string[];
}

/**
 * 千ノ国 全体統合 共通実装契約 v1.1 FINAL 8〜9章の`X-SenNoKuni-*`ヘッダー・HMAC検証。既存の
 * `ExternalApiAuthGuard` (X-OVE-*) や `AgencyApiKeyGuard` (単純なAPIキー照合のみ) とは
 * 異なる、契約が新たに定めた認証方式のため専用ガードにする。署名対象文字列の詳細は
 * `CommonEventAuthenticator`のコメント参照。
 *
 * 署名対象の「生ボディ」はNestの`rawBody: true`起動オプション (`main.ts`/各e2eの
 * `NestFactory.create`) が`body-parser`のverifyコールバックで捕捉した`req.rawBody`
 * (Buffer) をそのまま使う。契約v1.1 FINAL §9「受信bodyを再serializeせずraw bodyを使う」に
 * 対応するための変更 (旧実装は`JSON.stringify(req.body)`で代替しており、送信側の
 * キー順序/エスケープがNode.jsの`JSON.stringify`と一致しない限り正当な署名でも
 * 検証に失敗しうる欠陥があった)。
 */
@Injectable()
export class CommonEventAuthGuard implements CanActivate {
  constructor(
    private readonly signingKeys: CommonEventSigningKeysService,
    @Inject(KV_STORE) private readonly kv: KeyValueStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RawBodyRequest<Request>>();

    const keyId = req.header("x-sennokuni-key-id");
    const timestamp = req.header("x-sennokuni-timestamp");
    const nonce = req.header("x-sennokuni-nonce");
    const signature = req.header("x-sennokuni-signature");

    if (!keyId || !timestamp || !nonce || !signature) {
      throw new UnauthorizedException(
        "missing X-SenNoKuni-* authentication headers",
      );
    }

    const credentials = await this.signingKeys.resolveActiveSecret(keyId);
    if (!credentials) {
      throw new UnauthorizedException("unknown or revoked key_id");
    }

    if (!req.rawBody) {
      // `rawBody: true`が起動オプションに渡っていない場合にここへ到達する。実装ミスであり
      // 送信元の責任ではないため、認証失敗ではなく明確なサーバーエラーとして扱う。
      throw new InternalServerErrorException(
        "raw body capture is not enabled (NestFactory.create rawBody option)",
      );
    }
    const rawBody = req.rawBody.toString("utf8");

    const authenticator = new CommonEventAuthenticator(this.kv);
    await authenticator.verify(
      {
        keyId,
        timestamp,
        nonce,
        signature,
        rawBody,
        method: req.method,
        path: req.originalUrl,
        sourceSystemKey: credentials.sourceSystemKey,
      },
      { keyId, secret: credentials.secret },
    );

    const authenticatedReq = req as unknown as AuthenticatedCommonEventRequest;
    authenticatedReq.commonEventSourceSystemKey = credentials.sourceSystemKey;
    authenticatedReq.commonEventAllowedEventTypes =
      credentials.allowedEventTypes;
    return true;
  }
}
