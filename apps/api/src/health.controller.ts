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
    return { status: "ok", timestamp: new Date().toISOString() };
  }
}
