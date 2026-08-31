import type { NextFunction, Request, Response } from "express";

/** 副作用を持たないメソッド。`readonly`ではこれらだけを通す。 */
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * メンテナンス中でも必ず通すパス。
 *
 * ヘルスチェックを止めると、オーケストレータ (Railway等) がインスタンスを不健全と
 * 判定してコンテナを再起動し続ける。メンテナンスのつもりが本物の障害になるため、
 * ここだけは何があっても通す。
 */
const ALWAYS_ALLOWED_PATHS = ["/health"];

export type MaintenanceMode = "off" | "readonly" | "full";

/** 復帰見込みが分からない場合の`Retry-After`。 */
export const DEFAULT_RETRY_AFTER_SECONDS = 300;

const DEFAULT_MESSAGE = "ただいまメンテナンス中です。時間をおいて再度お試しください。";

/**
 * 未設定・不正値はすべて`off`として扱う。綴りを間違えたときに、意図せず
 * 全リクエストを止めるより、メンテナンスに入り損ねる方が安全なため
 * (入り損ねは起動ログとヘルスチェックで気づけるが、全断は気づくのが遅れる)。
 */
export function maintenanceMode(env: NodeJS.ProcessEnv = process.env): MaintenanceMode {
  const value = env.MAINTENANCE_MODE?.trim().toLowerCase();
  return value === "readonly" || value === "full" ? value : "off";
}

function retryAfterSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.MAINTENANCE_RETRY_AFTER_SECONDS);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_RETRY_AFTER_SECONDS;
}

function maintenanceMessage(env: NodeJS.ProcessEnv = process.env): string {
  const custom = env.MAINTENANCE_MESSAGE?.trim();
  return custom && custom.length > 0 ? custom : DEFAULT_MESSAGE;
}

function isAlwaysAllowed(path: string): boolean {
  return ALWAYS_ALLOWED_PATHS.some((allowed) => path === allowed || path.startsWith(`${allowed}/`));
}

/**
 * リクエストのパス。`req.path`ではなく`req.originalUrl`から取る。
 *
 * Nestが`forRoutes("*")`のミドルウェアをサブパスにマウントするため、`req.path`は
 * マウント位置からの相対パスになり `/health` が `/` として見えてしまう
 * (ヘルスチェックの除外が効かず、メンテナンス中にコンテナが再起動され続ける)。
 * `originalUrl`はマウント位置の影響を受けない。
 */
function requestPathname(req: Request): string {
  const url = req.originalUrl ?? req.url ?? "";
  return url.split("?")[0] ?? "";
}

/**
 * メンテナンスモード。
 *
 * 導入前は、計画メンテナンス中にリクエストを止める手段が無かった。`docs/deployment.md`
 * には「破壊的なマイグレーションは新規登録を一時的に停止するか、メンテナンスウィンドウ内で
 * 実施すること」と書かれているのに、**停止する手段そのものが実装されていない**という
 * 状態で、手順が実行不能だった。
 *
 * ## 2つのモード
 *
 * - `readonly`: 更新系 (POST/PUT/PATCH/DELETE) だけを503にし、閲覧は通す。
 *   列の追加のような後方互換のあるマイグレーション向け。利用者は残高や履歴を
 *   見られるため、全断より影響が小さい。
 * - `full`: ヘルスチェック以外のすべてを503にする。列の削除・型変更のように、
 *   読み取りすら壊れうる変更の間だけ使う。
 *
 * 管理画面も同じ扱いにしている (`/api/v1/admin/*`を素通しにしない)。素通しにすると、
 * マイグレーション中のDBに対して管理者が書き込めてしまい、`readonly`で更新を止めた
 * 意味が無くなるため。管理者だけ通したい場合は、モードを`off`に戻す方が状態が明確。
 *
 * ## 使い方
 *
 * `MAINTENANCE_MODE=readonly` (または`full`) を設定して再デプロイする。DBに状態を
 * 持たないため、DBが落ちていても・マイグレーションで壊れていても確実に効く
 * (メンテナンスの入口がメンテナンス対象に依存しないようにする)。
 */
export function maintenanceModeMiddleware(req: Request, res: Response, next: NextFunction): void {
  const mode = maintenanceMode();
  if (mode === "off" || isAlwaysAllowed(requestPathname(req))) {
    next();
    return;
  }

  if (mode === "readonly" && READ_METHODS.has(req.method.toUpperCase())) {
    next();
    return;
  }

  res.setHeader("Retry-After", String(retryAfterSeconds()));
  res.status(503).json({
    statusCode: 503,
    error: "Service Unavailable",
    message: maintenanceMessage(),
    maintenance: true,
  });
}
