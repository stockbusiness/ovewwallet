import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { type PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";

/**
 * リファクタリング指示書 Phase 2: `AccountsService`から分離したログイン
 * デバイス管理責務 (端末一覧・個別失効・他端末全失効)。
 */
@Injectable()
export class SessionManagementService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  /**
   * ログインデバイス一覧 (docs/login-devices.md参照)。有効なセッションのみ返す
   * (失効済み・期限切れは含めない)。`currentSessionId`と一致する行にはis_currentを立てる。
   */
  async listSessions(oveAccountId: string, currentSessionId: string) {
    const sessions = await this.db.userSession.findMany({
      where: { oveAccountId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { issuedAt: "desc" },
    });

    return sessions.map((s) => ({
      id: s.id,
      device_label: summarizeUserAgent(s.userAgent),
      ip_address: s.ipAddress,
      issued_at: s.issuedAt.toISOString(),
      last_used_at: s.lastUsedAt ? s.lastUsedAt.toISOString() : null,
      is_current: s.id === currentSessionId,
    }));
  }

  /**
   * 本人によるログインデバイスの個別ログアウト。他人のセッションIDを指定しても
   * 404になる (`oveAccountId`でスコープするため)。
   */
  async revokeSession(oveAccountId: string, sessionId: string): Promise<void> {
    const session = await this.db.userSession.findUnique({ where: { id: sessionId } });
    if (!session || session.oveAccountId !== oveAccountId) throw new NotFoundException("session not found");
    if (session.revokedAt) throw new ForbiddenException("session already revoked");

    await this.db.userSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date(), revokeReason: "USER_REVOKED_DEVICE" },
    });
  }

  /**
   * 本人による「この端末以外からすべてログアウト」(docs/login-devices.md参照)。
   * 個別ログアウトと同様、現在のセッション自身は対象外にする (このAPIを呼んだ
   * 本人がその場でログアウトされてしまう混乱を避けるため)。
   */
  async revokeOtherSessions(oveAccountId: string, currentSessionId: string): Promise<{ revoked_count: number }> {
    const result = await this.db.userSession.updateMany({
      where: { oveAccountId, revokedAt: null, id: { not: currentSessionId } },
      data: { revokedAt: new Date(), revokeReason: "USER_REVOKED_ALL_OTHER_DEVICES" },
    });
    return { revoked_count: result.count };
  }
}

/** User-Agent文字列から画面表示用の簡易ラベルを作る (専用ライブラリは使わない軽量実装)。 */
function summarizeUserAgent(userAgent: string | null): string {
  if (!userAgent) return "不明な端末";

  const os = userAgent.includes("iPhone")
    ? "iPhone"
    : userAgent.includes("iPad")
      ? "iPad"
      : userAgent.includes("Android")
        ? "Android"
        : userAgent.includes("Mac OS X")
          ? "Mac"
          : userAgent.includes("Windows")
            ? "Windows"
            : "不明なOS";

  const browser = userAgent.includes("Edg/")
    ? "Edge"
    : userAgent.includes("Chrome/")
      ? "Chrome"
      : userAgent.includes("CriOS/")
        ? "Chrome"
        : userAgent.includes("Safari/") && !userAgent.includes("Chrome/")
          ? "Safari"
          : userAgent.includes("Firefox/")
            ? "Firefox"
            : "不明なブラウザ";

  return `${os} / ${browser}`;
}
