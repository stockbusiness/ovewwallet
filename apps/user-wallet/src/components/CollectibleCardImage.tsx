"use client";

import { ImageOffIcon } from "@ove/shared-ui";
import Image from "next/image";
import { useState } from "react";

/**
 * NFTコレクション実装指示書。カード画像の読み込み失敗時 (URL切れ・CDN障害等) に
 * 白紙や壊れた画像アイコンのまま放置せず、専用プレースホルダーへ切り替える。
 */
export function CollectibleCardImage({ src, alt, sizes }: { src: string; alt: string; sizes?: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-sengoku-navy text-sengoku-faint">
        <ImageOffIcon className="h-8 w-8" />
        <span className="text-[10px]">画像を読み込めません</span>
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes ?? "(max-width: 640px) 50vw, 240px"}
      className="object-cover"
      onError={() => setFailed(true)}
    />
  );
}
