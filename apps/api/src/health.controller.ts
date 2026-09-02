import { Controller, Get } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";

/**
 * ヘルスチェックはk8sのliveness/readinessプローブやロードバランサから高頻度で
 * ポーリングされる想定のため、通常のAPIトラフィックと同じレート制限を適用しない
 * (負荷テストで、200並列リクエストのうち約4割が429で拒否されることを実際に確認して発覚。
 * ヘルスチェック自体が誤って429を返すと、オーケストレータがインスタンスを不健全と
 * 誤判定し再起動させてしまう自己誘発的な障害になりかねない。docs/test-plan.md参照)。
 */
@SkipThrottle()
@Controller("health")
export class HealthController {
  @Get()
  check() {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      commit: getDeployedCommit(),
    };
  }
}

/**
 * 稼働中のコンテナがどのコミットのビルドかを外から判別できるようにする。
 *
 * デプロイの待ち合わせ (`.github/workflows/deploy.yml`) にとっては、これが
 * 「新しいコンテナへ入れ替わった」ことを確かめる唯一の手掛かりになる。
 * `railway up --detach` はビルド完了を待たずに戻るため、直後の `/health` は
 * **まだ動いている旧コンテナ**に当たって200を返す。状態を返すだけのヘルスチェックでは
 * 入れ替わる前に成功と判定してしまい、実際に検証環境の自動デプロイ (run #39) が
 * 0秒で「成功」した。
 *
 * 値は短縮SHA (7桁) だけにする。誰でも叩けるエンドポイントであり、
 * 完全なSHAを出す必要が無いため。未設定なら null を返す
 * (ワークフロー以外の経路で起動した場合)。
 */
function getDeployedCommit(): string | null {
  const sha = process.env.GIT_COMMIT_SHA;
  return sha ? sha.slice(0, 7) : null;
}
