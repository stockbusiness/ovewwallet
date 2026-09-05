import { Controller, Get, Inject, NotFoundException, Param, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { PrismaClient } from "@ove/database";
import type { Response } from "express";
import { PRISMA } from "../common/prisma.module";
import { ObjectStorageService } from "./object-storage";

/** `<sha256>.<ext>` のみ受ける。ストレージのキー空間を外から自由に指定させないため。 */
const FILENAME_PATTERN = /^([0-9a-f]{64})\.(png|jpg|gif|webp)$/;

/**
 * 取り込んだカード画像を配信する (docs/collectible-images.md)。
 *
 * **認証を求めない。** カードの絵柄そのものは秘密ではなく、誰が持っているか
 * (`/me/collectibles`) の方が保護対象だから。URLは内容のハッシュなので、持っていない
 * カードのURLを推測して当てることはできない。
 *
 * 内容が変わらないキーなので、長期キャッシュを許して再取得させない。
 */
@ApiTags("collectible-images")
@Controller("api/v1/collectible-images")
export class CollectibleImagesController {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly storage: ObjectStorageService,
  ) {}

  @Get(":filename")
  async get(@Param("filename") filename: string, @Res() res: Response): Promise<void> {
    const match = FILENAME_PATTERN.exec(filename);
    if (!match) throw new NotFoundException("image not found");
    const sha256 = match[1]!;

    const row = await this.db.collectibleImage.findFirst({
      where: { sha256, status: "STORED" },
      select: { storageKey: true, contentType: true },
    });
    if (!row?.storageKey) throw new NotFoundException("image not found");

    const object = await this.storage.get(row.storageKey);
    if (!object) throw new NotFoundException("image not found");

    res.setHeader("Content-Type", row.contentType ?? object.contentType ?? "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("ETag", `"${sha256}"`);
    // 画像として以外に解釈させない。
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(object.body);
  }
}
