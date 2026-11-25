export const palettes = {
  Forest: { background: '#173e35', ink: '#fff7dd', accent: '#d8ea9c', field: '#b7ceaa' },
  Paper: { background: '#faf1df', ink: '#213e34', accent: '#436649', field: '#d4ddbb' },
  Night: { background: '#222844', ink: '#fff3df', accent: '#d1c4ff', field: '#bdc2e0' },
};

const headlines = {
  'Daily achievement': ['My daily', 'progress'],
  'Weekly progress': ['My week', 'in habits'],
  'Monthly progress': ['My month', 'in habits'],
  'Quarterly progress': ['My quarter', 'in habits'],
  'Six month progress': ['Six months', 'in habits'],
  'Yearly progress': ['My year', 'in habits'],
  'Streak milestone': ['My', 'Firestreak'],
  'Personal achievement': ['My', 'milestone'],
  'Sparky challenge': ['My Sparky', 'challenge'],
};

export type Template = keyof typeof headlines;
export const templates = Object.keys(headlines) as Template[];

type Card = {
  theme: keyof typeof palettes;
  template: Template;
  metric: string;
  label: string;
  details: string[];
  signature: string;
};

export function drawCard(canvas: HTMLCanvasElement, portrait: HTMLImageElement, card: Card) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  const { width, height } = canvas;
  const { background, ink, accent, field } = palettes[card.theme];
  const margin = 68;
  const inner = width - 2 * margin;
  function write(value: string, x: number, y: number, size: number, color: string, weight = 500, limit = inner) {
    if (!ctx) return;
    ctx.font = weight + ' ' + size + 'px "Nunito Variable", sans-serif';
    ctx.fillStyle = color;
    let visible = value.trim();
    if (ctx.measureText(visible).width > limit) {
      const chars = Array.from(visible);
      while (chars.length && ctx.measureText(chars.join('') + '…').width > limit) chars.pop();
      visible = chars.join('').trimEnd() + '…';
    }
    ctx.fillText(visible, x, y);
  }
  function rule(y: number) {
    if (!ctx) return;
    ctx.fillStyle = accent;
    ctx.fillRect(margin, y, inner, 2);
  }

  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  write('Sparky', margin, 98, 51, ink, 850);
  ctx.textAlign = 'right';
  write('WITH SPARKY', width - margin, 92, 26, accent, 800);
  ctx.textAlign = 'left';
  rule(132);

  const footer = height - 64;
  const metricTop = footer - (card.signature ? 62 : 0) - card.details.length * 48 - (card.metric ? 200 : 0);
  const heroHeight = metricTop - 170;
  const centerY = 156 + heroHeight / 2;
  const stacked = heroHeight > 860;
  const diameter = stacked ? Math.min(660, heroHeight - 205) : Math.min(480, heroHeight - 26);
  const left = stacked ? (width - diameter) / 2 : width - margin - diameter;
  const portraitY = stacked ? centerY - 75 : centerY;
  ctx.save();
  ctx.beginPath();
  ctx.arc(left + diameter / 2, portraitY, diameter / 2, 0, 2 * Math.PI);
  ctx.clip();
  ctx.fillStyle = field;
  ctx.fillRect(left, portraitY - diameter / 2, diameter, diameter);
  ctx.drawImage(portrait, 34, 0, 300, 300, left, portraitY - diameter / 2 + diameter * 0.035, diameter, diameter);
  ctx.restore();

  const [first, second] = headlines[card.template];
  if (stacked) {
    ctx.textAlign = 'center';
    write(first + ' ' + second, width / 2, portraitY + diameter / 2 + 115, 86, ink, 850);
    ctx.textAlign = 'left';
  } else {
    write(first, margin, centerY - 6, 86, ink, 850, left - margin - 12);
    write(second, margin, centerY + 82, 86, ink, 850, left - margin - 12);
  }
  if (card.metric || card.details.length || card.signature) rule(metricTop);
  if (card.metric) {
    write(card.label, margin, metricTop + 61, 30, accent, 800);
    write(card.metric, margin, metricTop + 163, 89, ink, 800);
  }
  const detailsTop = metricTop + (card.metric ? 200 : 0);
  card.details.forEach((detail, index) => write(detail, margin, detailsTop + (index + 1) * 48, 32, ink));
  if (card.signature) write(card.signature, margin, footer, 29, accent, 750);
}
