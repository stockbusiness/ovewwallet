import type { PrismaClient } from "@ove/database";

/**
 * カードマスター (`collectible_assets`) と保有 (`collectible_holdings`) に載っている
 * 画像URLのうち、まだ取り込み対象として登録されていないものを拾う
 * (docs/collectible-images.md)。
 *
 * **保管先を設定する前に登録されたカードには`collectible_images`の行が無い。**
 * `registerAndIngest()`はストレージ未設定のとき登録ごと行わずに戻り、定期実行の
 * `retryPending()`は既にある行しか見ないため、ここで拾い直さないと「先にカードを
 * 登録し、後からR2を設定した」場合にその画像が永久に取り込まれない。
 *
 * 保有側のスナップショット列も対象にする。カードマスターを後から差し替えても、
 * 既に配布済みの保有は付与時のURLを表示し続けるため、マスターだけを見ると
 * 表示に使われているURLを取りこぼす。
 */
const CATALOG_URLS = `
  SELECT image_url AS url FROM collectible_assets
  UNION
  SELECT thumbnail_url AS url FROM collectible_assets
  UNION
  SELECT image_url_snapshot AS url FROM collectible_holdings
  UNION
  SELECT thumbnail_url_snapshot AS url FROM collectible_holdings
`;

/** 取り込み対象に入っていないURLを、URL順に最大`limit`件返す。 */
export async function findUnregisteredCatalogUrls(
  db: PrismaClient,
  limit: number,
): Promise<string[]> {
  const rows = await db.$queryRawUnsafe<{ url: string }[]>(
    `
      WITH catalog AS (${CATALOG_URLS})
      SELECT url FROM catalog
      WHERE url IS NOT NULL AND url <> ''
        AND NOT EXISTS (
          SELECT 1 FROM collectible_images ci WHERE ci.source_url = catalog.url
        )
      ORDER BY url
      LIMIT $1
    `,
    limit,
  );
  return rows.map((row) => row.url);
}

/** 取り込み対象に入っていないURLの件数。管理画面に「取りこぼし」を出すために使う。 */
export async function countUnregisteredCatalogUrls(db: PrismaClient): Promise<number> {
  const rows = await db.$queryRawUnsafe<{ count: bigint }[]>(`
    WITH catalog AS (${CATALOG_URLS})
    SELECT COUNT(*)::bigint AS count FROM catalog
    WHERE url IS NOT NULL AND url <> ''
      AND NOT EXISTS (
        SELECT 1 FROM collectible_images ci WHERE ci.source_url = catalog.url
      )
  `);
  return Number(rows[0]?.count ?? 0);
}
