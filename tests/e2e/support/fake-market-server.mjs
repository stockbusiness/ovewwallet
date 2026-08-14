// NFTカードClaim導線実装指示書のE2E用。戦国マーケットClaim APIを模した最小限の
// HTTPサーバー。依存パッケージを増やさないためNode標準のhttpモジュールのみで書く。
import http from "node:http";

const port = Number(process.env.FAKE_MARKET_PORT ?? 4900);
const store = new Map();

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = req.url ?? "";
  if (url === "/health") return json(res, 200, { ok: true });
  const match = url.match(/^\/api\/collectible-claims\/([^/?]+)(\/confirm)?/);
  if (!match) return json(res, 404, { error: "unknown route" });
  const token = decodeURIComponent(match[1]);
  const isConfirm = Boolean(match[2]);

  if (req.method === "GET" && !isConfirm) {
    const entry = store.get(token) ?? { confirmed: false, pollCount: 0 };
    if (!entry.confirmed) return json(res, 200, { status: "PENDING", card_name: "織田信長 SSR (E2E)" });
    entry.pollCount += 1;
    store.set(token, entry);
    if (entry.pollCount >= 1) return json(res, 200, { status: "DELIVERED", card_name: "織田信長 SSR (E2E)" });
    return json(res, 200, { status: "DELIVERY_PENDING", card_name: "織田信長 SSR (E2E)" });
  }

  if (req.method === "POST" && isConfirm) {
    // 千ノ国NFTマーケット契約v2指示書PR-WN02のUI回帰用。tokenの接頭辞でシナリオを切り替える
    // (apps/api/src/e2e/collectible-claims.test.tsと同じ「tokenにシナリオを埋め込む」方式)。
    if (token.startsWith("mismatch-")) {
      return json(res, 409, { error: { code: "COMMON_USER_MISMATCH", message: "account mismatch" } });
    }
    if (token.startsWith("pending-")) {
      return json(res, 202, { status: "PENDING", reason: "common_user_pending" });
    }
    store.set(token, { confirmed: true, pollCount: 0 });
    return json(res, 202, { status: "DELIVERY_PENDING" });
  }

  return json(res, 404, { error: "unknown route" });
});

server.listen(port, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(`fake-market-server listening on http://127.0.0.1:${port}`);
});
