/**
 * 法的文書の本文をブロックへ分ける (docs/legal-documents.md)。
 *
 * HTMLは扱わない。`## `で始まる行を見出し、それ以外の連続した行を段落として扱う。
 * 管理画面に入力された文字列をそのままHTMLとして描画すると、入力がスクリプトとして
 * 動く経路を作ってしまうため、描画側は必ずテキストとして出す。
 */
export type LegalBlock =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string };

/** 行頭の `## ` に続く部分を見出しとして取り出す。 */
const HEADING_PATTERN = /^##[ \t](.*)$/;

export function parseLegalBody(body: string): LegalBlock[] {
  const blocks: LegalBlock[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };

  for (const rawLine of body.split(/\r?\n/)) {
    // 見出し判定は行を削る前に行う。`trimEnd()`してから見ると `## ` の
    // 後ろの空白が落ち、見出し記号だけの行を判定できなくなる。
    const heading = HEADING_PATTERN.exec(rawLine.replace(/\r$/, ""));
    if (heading) {
      flush();
      const text = heading[1]!.trim();
      if (text) blocks.push({ kind: "heading", text });
      continue;
    }
    const line = rawLine.trimEnd();
    if (line.trim() === "") {
      flush();
      continue;
    }
    paragraph.push(line);
  }
  flush();

  return blocks;
}
