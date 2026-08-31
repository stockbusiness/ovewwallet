import { HttpException, HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import type { KeyValueStore } from "@ove/auth";
import { generateId, type PrismaClient } from "@ove/database";
import { KV_STORE } from "../common/kv-store.module";
import { PRISMA } from "../common/prisma.module";

/** 連続失敗が何回でロックするか。 */
export const ADMIN_LOGIN_MAX_FAILURES = 5;
/** ロックの継続時間。 */
export const ADMIN_LOGIN_LOCK_SECONDS = 15 * 60;
/**
 * 失敗回数を数え続ける窓。この時間だけ間隔が空けば回数は0に戻る
 * (何日も前の打ち間違いが積み上がってロックに至るのを避ける)。
 */
export const ADMIN_LOGIN_FAILURE_WINDOW_SECONDS = 15 * 60;

function failureKey(adminId: string): string {
  return `admin-login-failures:${adminId}`;
}

function lockKey(adminId: string): string {
  return `admin-login-lock:${adminId}`;
}

/** 正の整数として解釈できない値は既定値を使う (設定ミスで0回ロック等になるのを避ける)。 */
function positiveIntEnv(key: string, fallback: number, env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env[key]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function adminLoginMaxFailures(env: NodeJS.ProcessEnv = process.env): number {
  return positiveIntEnv("ADMIN_LOGIN_MAX_FAILURES", ADMIN_LOGIN_MAX_FAILURES, env);
}

export function adminLoginLockSeconds(env: NodeJS.ProcessEnv = process.env): number {
  return positiveIntEnv("ADMIN_LOGIN_LOCK_SECONDS", ADMIN_LOGIN_LOCK_SECONDS, env);
}

/**
 * 管理者ログインのアカウント単位の失敗ロック。
 *
 * 導入前の制限はIPベースのみ (`ThrottlerModule`全体120回/分、ログイン系10回/分) で、
 * 次の2つが素通りだった。
 *
 * - **1アカウントへの分散総当たり**: IPを変えれば試行回数に上限が無かった。
 *   特に2段階目(TOTP)は`mfaToken`が失敗しても消えないため、パスワードを知る攻撃者は
 *   トークンの有効期間(5分)いっぱい、6桁のコードを複数IPから撃ち続けられた。
 * - **事務所の共有IPでの巻き添え**: 誰か1人の打ち間違いが、同じIPの他の管理者の
 *   ログイン試行枠(10回/分)を食い潰していた。
 *
 * IP制限と置き換えるのではなく併用する。IP制限は「存在しないメールアドレスへの
 * 総当たり」を抑える役割が残る (存在しないアカウントはロック対象にできないため)。
 *
 * ## 数え方
 *
 * 失敗のたびに`admin-login-failures:<adminId>`を+1し、上限に達した時点で
 * `admin-login-lock:<adminId>`をロック時間のTTLで書く。ロック中の試行は
 * パスワード照合前に弾き、ロックを延長する (ロック中も撃ち続ける相手に対して
 * 「待てば必ず開く」時刻を与えないため)。
 *
 * ログインの1段階目(パスワード)と2段階目(TOTP)で回数を分けない。どちらも同じ
 * ログイン試行の一部で、片方だけ数えると他方が抜け道になるため。
 *
 * ## 意図的に対象外にしたもの
 *
 * - **LINEログイン**: 認証はLINE側で行われ、こちらはIDトークンを検証するだけなので、
 *   このシステムで数えられる「パスワードの失敗」が存在しない。
 * - **存在しないメールアドレス**: ロックする対象(adminId)が無い。ここを数えると
 *   「ロックされた=そのアドレスの管理者が実在する」と教えることになるため、
 *   IP制限に任せる。
 */
@Injectable()
export class AdminLoginThrottleService {
  private readonly logger = new Logger(AdminLoginThrottleService.name);

  constructor(
    @Inject(KV_STORE) private readonly kv: KeyValueStore,
    @Inject(PRISMA) private readonly db: PrismaClient,
  ) {}

  /**
   * ロック中なら429で弾く。パスワード照合・TOTP照合より先に呼ぶこと
   * (照合してから弾くと、ロック中でも当たり外れで応答時間が変わりうる)。
   */
  async assertNotLocked(adminId: string): Promise<void> {
    if ((await this.kv.get(lockKey(adminId))) === undefined) return;

    // ロック中の試行でロックを延長する。撃ち続ける相手にロック解除時刻を与えない。
    await this.kv.set(lockKey(adminId), "1", adminLoginLockSeconds());
    throw new HttpException("too many failed login attempts; try again later", HttpStatus.TOO_MANY_REQUESTS);
  }

  /**
   * 失敗を1件数える。上限に達したらロックし、監査ログに残す。
   * 呼び出し側は本メソッドの後に、これまでどおり401を投げる
   * (ロックされたかどうかで応答を変えず、「あと何回でロックされるか」を教えない)。
   */
  async recordFailure(adminId: string): Promise<void> {
    const failures = await this.kv.incr(failureKey(adminId), ADMIN_LOGIN_FAILURE_WINDOW_SECONDS);
    if (failures < adminLoginMaxFailures()) return;

    await this.kv.set(lockKey(adminId), "1", adminLoginLockSeconds());
    await this.kv.del(failureKey(adminId)).catch(() => undefined);
    this.logger.warn(`admin ${adminId} locked out after ${failures} failed login attempts`);

    // 監査ログはロック時のみ残す。失敗のたびに書くと、総当たりで表が膨れる
    // (audit_logsは削除できないため、書く量そのものを絞る)。
    await this.db.auditLog.create({
      data: {
        id: generateId(),
        actorType: "ADMIN",
        actorId: adminId,
        actionType: "ADMIN_LOGIN_LOCKED",
        targetType: "admin_user",
        targetId: adminId,
        result: "FAILURE",
        reason: `${failures} consecutive failed login attempts`,
      },
    });
  }

  /** ログイン成功。失敗回数を捨てる (連続失敗のみを数えるため)。 */
  async recordSuccess(adminId: string): Promise<void> {
    await this.kv.del(failureKey(adminId));
    await this.kv.del(lockKey(adminId));
  }
}
