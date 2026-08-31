import {
  ForbiddenException,
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { hashSessionToken, SESSION_COOKIE_NAME } from "@ove/auth";
import type { PrismaClient, OveAccount } from "@ove/database";
import { PRISMA } from "./prisma.module";
import { AccountRepository } from "../accounts/account.repository";
import {
  SKIP_TERMS_CONSENT,
  TERMS_CONSENT_REQUIRED_CODE,
  isAllowedWithoutConsent,
  isTermsConsentRequired,
} from "../accounts/terms-consent";

export interface AuthenticatedUserRequest extends Request {
  account: OveAccount;
  /** ログインデバイス一覧で「この端末」を判定するための、現在のリクエストのセッションID。 */
  sessionId: string;
}

/**
 * OVE独自セッションCookieを検証し、req.account にログイン中のアカウントを積む。
 *
 * あわせて**利用規約の再同意**も確認する (`docs/terms-consent.md`)。個別のエンドポイントに
 * 付ける方式ではなくここで見るのは、後から追加された更新系エンドポイントが素通しに
 * なるのを防ぐため (付け忘れても既定で保護される)。
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly accountRepository: AccountRepository,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    if (!token) throw new UnauthorizedException("not authenticated");

    const session = await this.db.userSession.findUnique({
      where: { sessionTokenHash: hashSessionToken(token) },
    });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException("session expired or revoked");
    }

    const account = await this.accountRepository.findById(session.oveAccountId);
    if (!account) throw new UnauthorizedException("account not found");
    // 退会済みアカウント向けにセッションが残っていた場合の保険 (通常は退会処理自体で
    // 全セッションを失効させるため通らないはずだが、多層防御として置く)。
    if (account.status === "CLOSED") throw new UnauthorizedException("this account has been closed");

    this.assertTermsConsent(context, req, account);

    await this.db.userSession.update({
      where: { id: session.id },
      data: { lastUsedAt: new Date() },
    });

    (req as AuthenticatedUserRequest).account = account;
    (req as AuthenticatedUserRequest).sessionId = session.id;
    return true;
  }

  /**
   * 規約の再同意が必要な利用者の更新系リクエストを拒否する。閲覧は通す
   * (残高が見えないと不安を招くだけで、同意を促す効果が無いため)。
   *
   * 応答には機械可読コードを載せる。フロントエンドは英語のメッセージ文字列ではなく
   * これを見て再同意画面へ誘導する。
   */
  private assertTermsConsent(context: ExecutionContext, req: Request, account: OveAccount): void {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_TERMS_CONSENT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isAllowedWithoutConsent(req.method, skip === true)) return;
    if (!isTermsConsentRequired(account)) return;

    throw new ForbiddenException({
      statusCode: 403,
      error: TERMS_CONSENT_REQUIRED_CODE,
      message: "利用規約への同意が必要です。",
    });
  }
}
