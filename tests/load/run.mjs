#!/usr/bin/env node
/**
 * 負荷・レート制限の限界値テスト (指示書18章 / docs/test-plan.md 「未実施のテスト」より着手)。
 *
 * 外部ツール(autocannon/k6等)を追加せず、Node組み込みのfetchのみで実装した簡易負荷テスト。
 * apps/api が起動していること (DATABASE_URL/REDIS_URL等が設定済みであること) が前提。
 *
 * 実行: node tests/load/run.mjs
 *       API_URL=http://localhost:4000 node tests/load/run.mjs (デフォルトも同じ)
 *
 * rate-limit.test.ts (apps/api/src/e2e) は「逐次リクエストでいずれ429になること」を
 * 検証しているが、これは実際の攻撃・高負荷時に近い「真の同時並行リクエスト」下でも
 * @nestjs/throttler のカウントが正しく機能するか (レースコンディションですり抜けないか)
 * を検証する点で異なる。
 */

const API_URL = process.env.API_URL ?? "http://localhost:4000";

async function timed(fn) {
  const start = performance.now();
  try {
    const res = await fn();
    return { ok: true, status: res.status, ms: performance.now() - start };
  } catch (err) {
    return { ok: false, status: 0, ms: performance.now() - start, error: String(err) };
  }
}

function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor((p / 100) * sortedAsc.length));
  return sortedAsc[idx];
}

function summarize(label, results) {
  const durations = results.map((r) => r.ms).sort((a, b) => a - b);
  const serverErrors = results.filter((r) => !r.ok || r.status >= 500).length;
  const statusCounts = {};
  for (const r of results) statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;

  console.log(`\n=== ${label} ===`);
  console.log(`  requests: ${results.length}`);
  console.log(`  status counts: ${JSON.stringify(statusCounts)}`);
  console.log(`  5xx/network errors: ${serverErrors}`);
  console.log(
    `  latency ms: p50=${percentile(durations, 50).toFixed(1)} p95=${percentile(durations, 95).toFixed(1)}` +
      ` p99=${percentile(durations, 99).toFixed(1)} max=${(durations[durations.length - 1] ?? 0).toFixed(1)}`,
  );

  return {
    label,
    count: results.length,
    serverErrors,
    p50: percentile(durations, 50),
    p95: percentile(durations, 95),
    p99: percentile(durations, 99),
    max: durations[durations.length - 1] ?? 0,
  };
}

async function runConcurrent(count, fn) {
  return Promise.all(Array.from({ length: count }, () => timed(fn)));
}

async function main() {
  const report = [];
  let exitCode = 0;

  // 1. ヘルスチェック (認証不要、最も軽量なエンドポイント) の素の処理能力
  {
    const results = await runConcurrent(200, () => fetch(`${API_URL}/health`));
    report.push(summarize("GET /health (200並列)", results));
  }

  // 2. 認証済みセッションでのウォレット参照 (一般利用者の典型的なトラフィックに近い)
  {
    const idToken = `mock.loadtest-${Date.now()}`;
    const loginRes = await fetch(`${API_URL}/api/v1/auth/line/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, termsAccepted: true }),
    });
    const cookie = loginRes.headers.get("set-cookie");
    if (!loginRes.ok || !cookie) {
      throw new Error(`failed to obtain a session cookie for the load test (status=${loginRes.status})`);
    }
    const results = await runConcurrent(100, () => fetch(`${API_URL}/api/v1/me/wallet`, { headers: { Cookie: cookie } }));
    report.push(summarize("GET /api/v1/me/wallet (100並列, 認証あり)", results));
  }

  // 3. レート制限の限界値検証: 管理者ログインへ真の並列リクエストを送り、
  //    60秒10回の制限 (docs/security.md 「レート制限値の見直し」) が同時実行下でも
  //    正しく機能する (すり抜けが最小限である) ことを確認する。
  {
    const CONCURRENCY = 30;
    const LIMIT = 10;
    const results = await runConcurrent(CONCURRENCY, () =>
      fetch(`${API_URL}/api/v1/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "loadtest-nonexistent@ovewallet.local", password: "wrong-password" }),
      }),
    );
    summarize(`POST /api/v1/admin/login (${CONCURRENCY}並列, レート制限限界値確認)`, results);

    const tooMany = results.filter((r) => r.status === 429).length;
    const processed = results.filter((r) => r.status === 401).length;
    console.log(`  → 429 (制限超過で拒否): ${tooMany}件 / 401 (認証処理まで到達): ${processed}件 (設定上限: ${LIMIT}件)`);

    if (tooMany === 0) {
      console.warn(
        `  ⚠ WARNING: ${CONCURRENCY}並列リクエストでも429が1件も発生しませんでした。レート制限が機能していない可能性があります。`,
      );
      exitCode = 1;
    }
    // ネットワークジッタ等により多少の誤差は許容するが、大幅な超過は要調査
    if (processed > LIMIT + 3) {
      console.warn(
        `  ⚠ WARNING: 設定上限(${LIMIT})を大きく超える${processed}件が処理されました。` +
          `同時実行下でのカウント漏れ(レースコンディション)の可能性があります。`,
      );
      exitCode = 1;
    }
  }

  console.log("\n=== サマリ ===");
  console.table(
    report.map(({ label, count, serverErrors, p50, p95, p99, max }) => ({
      label,
      count,
      serverErrors,
      "p50(ms)": p50.toFixed(1),
      "p95(ms)": p95.toFixed(1),
      "p99(ms)": p99.toFixed(1),
      "max(ms)": max.toFixed(1),
    })),
  );

  const anyServerErrors = report.some((r) => r.serverErrors > 0);
  if (anyServerErrors) {
    console.warn("\n⚠ WARNING: 5xxエラーまたはネットワークエラーが発生しました。上記の詳細を確認してください。");
    exitCode = 1;
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
