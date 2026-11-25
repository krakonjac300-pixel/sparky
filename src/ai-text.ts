/** AI answers arrive as loose markdown. This turns them into clean blocks with no stray symbols. */
export type AiBlock =
  | { kind: 'heading'; text: string; body?: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] };

/** Inline cleanup: drop bold/italic/code marks and link syntax, keep the words. */
export function plainText(text: string) {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`+/g, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,!?:;]|$)/g, '$1$2')
    .replace(/\*{2,}|_{2,}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const headingLine = /^(#{1,6}\s+|\d+[.)]\s+)(.+)$/;
const bulletLine = /^\s*(?:[-*•‣▪]|\d+[.)])\s+(.+)$/;

/** A heading may carry its first sentence on the same line: "1. Verdict: you did well." */
function splitHeading(raw: string): AiBlock {
  const text = plainText(raw);
  const colon = text.indexOf(':');
  if (colon > 0 && colon <= 40 && colon < text.length - 1) {
    return { kind: 'heading', text: text.slice(0, colon).trim(), body: text.slice(colon + 1).trim() };
  }
  return { kind: 'heading', text: text.replace(/:$/, '') };
}

export function parseAiText(source: string): AiBlock[] {
  const blocks: AiBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', text: plainText(paragraph.join(' ')) });
    paragraph = [];
  };
  for (const rawLine of source.replace(/\r/g, '').split('\n')) {
    const line = rawLine.trim();
    if (!line || /^[-*_]{3,}$/.test(line)) { flush(); continue; }
    const boldOnly = /^(\*\*|__)(.+?)\1:?$/.exec(line);
    // "**Verdict:** text" or "**Verdict**: text": a titled line with its first sentence.
    const boldLead = /^(\*\*|__)([^*_]{1,40}?):?\1:?\s+(.+)$/.exec(line);
    if (boldLead) {
      flush();
      blocks.push({ kind: 'heading', text: plainText(boldLead[2]), body: plainText(boldLead[3]) });
      continue;
    }
    const heading = headingLine.exec(line);
    const bullet = bulletLine.exec(line);
    // "1. Verdict: ..." and "## Verdict" and "**Verdict**" are section titles; "- item" is a list item.
    if (boldOnly || (heading && (heading[1].startsWith('#') || /^\d+[.)]\s+\S[^:]{0,40}:/.test(line) || line.length <= 44))) {
      flush();
      blocks.push(splitHeading(boldOnly ? boldOnly[2] : heading![2]));
    } else if (bullet) {
      flush();
      const last = blocks.at(-1);
      const item = plainText(bullet[1]);
      if (last?.kind === 'list') last.items.push(item);
      else blocks.push({ kind: 'list', items: [item] });
    } else paragraph.push(line);
  }
  flush();
  return blocks.filter((block) => block.kind !== 'paragraph' || block.text);
}

/** Plain text with no markdown, for notifications and anywhere layout is not possible. */
export function aiToPlain(source: string) {
  return parseAiText(source).map((block) => block.kind === 'list' ? block.items.map((item) => `• ${item}`).join('\n')
    : block.kind === 'heading' ? `${block.text}${block.body ? `: ${block.body}` : ''}` : block.text).join('\n');
}
