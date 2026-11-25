import type { ReactNode } from 'react';
import { ArrowDownCircle, CircleCheck, Flame, PlusCircle, RefreshCw, Sparkles, Star, Target, Wrench } from 'lucide-react';
import { parseAiText, type AiBlock } from './ai-text.ts';

type Section = { title?: string; lead?: string; blocks: AiBlock[] };

/** Section titles the summary asks for, matched loosely so any wording gets a fitting icon. */
const icons: [RegExp, typeof Star][] = [
  [/verdict|overall|summary/i, CircleCheck], [/target|goal/i, Target], [/working|went well|wins?\b/i, Flame],
  [/fix|improve|change/i, Wrench], [/add|new habit|try/i, PlusCircle], [/drop|shrink|remove|cut/i, ArrowDownCircle],
  [/focus|next/i, Star], [/since|last review|follow/i, RefreshCw],
];

function group(blocks: AiBlock[]) {
  const sections: Section[] = [];
  for (const block of blocks) {
    if (block.kind === 'heading') sections.push({ title: block.text, lead: block.body, blocks: [] });
    else if (sections.length) sections.at(-1)!.blocks.push(block);
    else sections.push({ blocks: [block] });
  }
  return sections;
}

function Content({ block }: { block: AiBlock }): ReactNode {
  if (block.kind === 'list') return <ul>{block.items.map((item, index) => <li key={index}>{item}</li>)}</ul>;
  if (block.kind === 'paragraph') return <p>{block.text}</p>;
  return null;
}

/** An AI answer as clean, readable sections: no markdown symbols, one card per section. */
export function AiText({ text, compact = false }: { text: string; compact?: boolean }) {
  const sections = group(parseAiText(text));
  if (sections.length <= 1 && !sections[0]?.title) {
    return <div className="ai-text plain">{sections[0]?.blocks.map((block, index) => <Content key={index} block={block} />)}</div>;
  }
  return <div className={`ai-text${compact ? ' compact' : ''}`}>{sections.map((section, index) => {
    const Icon = section.title ? icons.find(([pattern]) => pattern.test(section.title!))?.[1] ?? Sparkles : undefined;
    return <section key={index} className="ai-section">
      {section.title && <h4>{Icon && <Icon size={16} aria-hidden="true" />}{section.title}</h4>}
      {section.lead && <p>{section.lead}</p>}
      {section.blocks.map((block, blockIndex) => <Content key={blockIndex} block={block} />)}
    </section>;
  })}</div>;
}
