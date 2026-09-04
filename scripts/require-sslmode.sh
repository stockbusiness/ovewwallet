#!/usr/bin/env bash
# 接続URLに sslmode=require が入っていることを保証する。
#
# バックアップとリストア訓練は、RailwayのTCP Proxy (公開ポート) 経由でPostgresへ
# 繋ぐ。pg_dumpの既定は `sslmode=prefer` で、これは**TLSが張れなければ平文で接続する**。
# 公開ポート越しに認証情報とDBの中身が平文で流れうるため、明示的に require にする。
#
# 使い方:
#   URL=$(./scripts/require-sslmode.sh "$DATABASE_URL")
#
# 結果のURLだけを標準出力に出す。診断メッセージは標準エラーへ、パスワードは伏せて出す。
set -euo pipefail

URL="${1:-}"
if [ -z "$URL" ]; then
  echo "エラー: 接続URLを引数に渡してください" >&2
  exit 1
fi

# ログ用にパスワードを伏せた表現を作る (この値は表示専用で、接続には使わない)。
masked() { echo "$1" | sed 's|://[^@/]*@|://***@|'; }

case "$URL" in
  *[?\&]sslmode=*|*\?sslmode=*)
    MODE=$(echo "$URL" | sed -n 's/.*[?&]sslmode=\([^&]*\).*/\1/p')
    case "$MODE" in
      require|verify-ca|verify-full)
        echo "sslmode=$MODE が指定済みです" >&2
        ;;
      *)
        # disable/allow/prefer は平文にフォールバックしうる。公開ポート経由では許さない。
        echo "::error::sslmode=$MODE は公開ポート経由の接続では許可できません。" >&2
        echo "平文にフォールバックしうるため、require / verify-ca / verify-full の" >&2
        echo "いずれかにしてください (対象: $(masked "$URL"))" >&2
        exit 1
        ;;
    esac
    RESULT="$URL"
    ;;
  *\?*)
    RESULT="${URL}&sslmode=require"
    echo "sslmode=require を追記しました (既存のクエリあり)" >&2
    ;;
  *)
    RESULT="${URL}?sslmode=require"
    echo "sslmode=require を追記しました" >&2
    ;;
esac

echo "$RESULT"
