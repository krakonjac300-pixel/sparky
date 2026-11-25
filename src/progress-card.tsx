import { useEffect, useState } from 'react';
import { androidRequest, onAndroid } from './android.ts';
import { Dialog } from './forms.tsx';
import { calendarDate, scoringPaused, type AppData } from './model.ts';
import { makeReport, periodDates, type Period } from './reports.ts';
import { streakInfo } from './streak.ts';
import { drawCard, palettes, templates, type Template } from './progress-card-art.ts';

const formats = { Story: 1920, Portrait: 1350, Square: 1080 };

const reportTemplates = {
  Day: 'Daily achievement', Week: 'Weekly progress', Month: 'Monthly progress',
  Quarter: 'Quarterly progress', '6 months': 'Six month progress', Year: 'Yearly progress',
} as const satisfies Record<Period, Template>;

export function ProgressCard({ data, end, today, reportPeriod }: { data: AppData; end: string; today: string; reportPeriod: Period }) {
  const [open, setOpen] = useState(false);
  const [template, setTemplate] = useState<Template>(templates[0]);
  const [format, setFormat] = useState<keyof typeof formats>('Portrait');
  const [theme, setTheme] = useState<keyof typeof palettes>('Forest');
  const [name, setName] = useState('');
  const [caption, setCaption] = useState('');
  const [stats, setStats] = useState(true);
  const [date, setDate] = useState(false);
  const [detail, setDetail] = useState(false);
  const [includeMood, setIncludeMood] = useState(false);
  const [includeNotes, setIncludeNotes] = useState(false);
  const [includeHealth, setIncludeHealth] = useState(false);
  const [includeDays, setIncludeDays] = useState(false);
  const [rendered, setRendered] = useState<{ design: string; file: File; url: string }>();
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const period = (Object.keys(reportTemplates) as Period[]).find((key) => reportTemplates[key] === template) ?? 'Day';
  const days = open ? periodDates(end, period).filter((day) => day <= end).length : 1;
  const report = open ? makeReport(data, end, days, today) : undefined;
  const priorMonth = open && period === 'Month' ? periodDates(end, period, -1) : [];
  const previous = priorMonth.length ? makeReport(data, priorMonth[priorMonth.length - 1], priorMonth.length, today).rate : undefined;
  const streak = open && template === 'Streak milestone' ? streakInfo(data, end).streak : 0;
  const milestone = data.moments.filter((item) => item.kind === 'Milestone' && item.date <= end).sort((a, b) => b.date.localeCompare(a.date))[0];
  const program = data.programs?.find((item) => item.status === 'active');
  let metric = report?.planned ? `${report.hit} of ${report.planned}` : 'None planned';
  const periodLabels: Record<Period, string> = {
    Day: 'Daily targets met', Week: 'Weekly targets met', Month: 'Monthly targets met',
    Quarter: 'Quarterly targets met', '6 months': 'Targets met over six months', Year: 'Yearly targets met',
  };
  let label = periodLabels[period];
  let subline = '';
  if (template === 'Streak milestone') {
    metric = `${streak} ${streak === 1 ? 'day' : 'days'}`;
    label = scoringPaused(data, end) ? 'Paused streak' : 'Current streak';
  } else if (template === 'Sparky challenge') {
    metric = program ? `${Math.min(program.days.length, program.duration)} of ${program.duration}` : 'No active program';
    label = 'Practice days completed';
    subline = detail && program ? program.title : '';
  } else if (template === 'Personal achievement') {
    metric = milestone ? 'Milestone reached' : 'None recorded';
    label = 'Latest milestone';
    subline = detail && milestone ? milestone.title : '';
  } else if (stats && period === 'Month' && previous !== undefined && report?.rate !== undefined) {
    subline = `${report.rate}% this month · ${previous}% last month`;
  } else if (detail && period === 'Week') {
    subline = [...(report?.habits ?? [])].sort((a, b) => b.hit - a.hit).find(({ hit }) => hit > 0)?.title ?? '';
  }
  const checkIn = data.checkIns.find((entry) => entry.date === end);
  const sleep = data.sleep.find((entry) => entry.date === end);
  const privateLine = [includeMood && checkIn && `Mood ${checkIn.mood}/5 · Energy ${checkIn.energy}/5`,
    includeHealth && sleep && `Sleep ${Math.floor(sleep.minutes / 60)}h ${sleep.minutes % 60}m`].filter(Boolean).join('  /  ');
  const privateNote = includeNotes ? checkIn?.note?.slice(0, 100) ?? '' : '';
  const dailyCounts = includeDays && period === 'Week' ? (report?.daily ?? []).map((day) => {
    const weekday = calendarDate(day.date).toLocaleDateString('en', { weekday: 'short' });
    return weekday + ' ' + (day.planned ? `${day.hit}/${day.planned}` : '0 planned');
  }) : [];
  const countLines = [dailyCounts.slice(0, 4).join('   '), dailyCounts.slice(4).join('   ')];
  const dateLabel = report && report.from !== end ? `${report.from} to ${end}` : end;
  const design = JSON.stringify({
    template, theme, height: formats[format], metric: stats ? metric : '', label,
    details: [subline, ...countLines, privateLine, privateNote, caption].filter(Boolean),
    signature: [name, date && dateLabel].filter(Boolean).join(' · '),
  });
  const ready = rendered?.design === design;
  useEffect(() => {
    if (!open) return;
    setRendered(undefined);
    let cancelled = false;
    let url = '';
    async function render() {
      const card = JSON.parse(design);
      const image = new Image();
      // The first frame of this Today clip shows Sparky giving a thumbs-up.
      image.src = '/turtle-plush-proud-4.webp';
      await Promise.all([image.decode(), document.fonts.load('800 48px "Nunito Variable"')]);
      if (cancelled) return;
      const canvas = document.createElement('canvas');
      canvas.width = 1080;
      canvas.height = card.height;
      drawCard(canvas, image, card);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        (value) => value ? resolve(value) : reject(new Error('PNG export failed')), 'image/png'));
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      setRendered({ design, file: new File([blob], 'one-life-progress.png', { type: 'image/png' }), url });
    }
    void render().catch(() => { if (!cancelled) setNotice('Could not create the progress image.'); });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [design, open]);

  async function output(share: boolean) {
    if (!rendered || !ready || saving) return;
    setSaving(true); setNotice('');
    try {
      const { file, url } = rendered;
      if (onAndroid()) {
        const encoded = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        const saved = await androidRequest<boolean>(share ? 'shareProgressImage' : 'saveProgressImage', encoded);
        if (saved && !share) setNotice('Image saved.');
      } else if (share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
      } else {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = file.name;
        anchor.click();
        setNotice(share ? 'Sharing is unavailable here. Your PNG download has started.' : 'PNG download started.');
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) setNotice('Could not share or save the progress image.');
    } finally { setSaving(false); }
  }

  return <><button className="secondary-button" onClick={() => {
    setRendered(undefined);
    setNotice('');
    setName('');
    setCaption('');
    setDate(false);
    setDetail(false);
    setIncludeDays(false);
    setIncludeMood(false);
    setIncludeNotes(false);
    setIncludeHealth(false);
    setTemplate(reportTemplates[reportPeriod]);
    setOpen(true);
  }}>Share progress</button>
    {open && <Dialog title="Share progress" close={() => { if (!saving) setOpen(false); }}>
      <div className="form-stack">
        <p className="muted">Only the details visible in this preview are included in the PNG.</p>
        {ready && rendered && <img src={rendered.url} alt={['Progress card with Sparky', template, stats && label, stats && metric, subline, ...countLines, privateLine, privateNote, caption, name, date && dateLabel].filter(Boolean).join('. ')}
          style={{ width: 'auto', maxWidth: '100%', height: 'auto', maxHeight: '42vh', justifySelf: 'center', objectFit: 'contain' }} />}
        <div className="form-grid">
          <label>Template<select value={template} onChange={(event) => setTemplate(event.target.value as typeof template)}>{templates.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Format<select value={format} onChange={(event) => setFormat(event.target.value as typeof format)}>{Object.keys(formats).map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Theme<select value={theme} onChange={(event) => setTheme(event.target.value as typeof theme)}>{Object.keys(palettes).map((item) => <option key={item}>{item}</option>)}</select></label>
        </div>
        <label>Nickname (optional)<input maxLength={40} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>Caption (optional)<input maxLength={100} value={caption} onChange={(event) => setCaption(event.target.value)} /></label>
        <label className="check-label"><input type="checkbox" checked={stats} onChange={(event) => setStats(event.target.checked)} /> Include progress or streak</label>
        {['Weekly progress', 'Sparky challenge', 'Personal achievement'].includes(template) && <label className="check-label"><input type="checkbox" checked={detail} onChange={(event) => setDetail(event.target.checked)} /> Include relevant habit, milestone or program name</label>}
        <label className="check-label"><input type="checkbox" checked={date} onChange={(event) => setDate(event.target.checked)} /> Include date</label>
        {template === 'Weekly progress' && <label className="check-label"><input type="checkbox" checked={includeDays} onChange={(event) => setIncludeDays(event.target.checked)} /> Include daily counts this week</label>}
        <details className="audit"><summary>Optional personal details</summary>
          <label className="check-label"><input type="checkbox" checked={includeMood} onChange={(event) => setIncludeMood(event.target.checked)} /> Include the selected day’s mood and energy</label>
          <label className="check-label"><input type="checkbox" checked={includeNotes} onChange={(event) => setIncludeNotes(event.target.checked)} /> Include the selected day’s check-in note</label>
          <label className="check-label"><input type="checkbox" checked={includeHealth} onChange={(event) => setIncludeHealth(event.target.checked)} /> Include the selected day’s sleep duration</label>
        </details>
        <div className="connection-actions"><button className="primary-button" disabled={!ready || saving} onClick={() => void output(true)}>Share image</button>
          <button className="secondary-button" disabled={!ready || saving} onClick={() => void output(false)}>Save PNG</button></div>
        {notice && <p role="status">{notice}</p>}
      </div>
    </Dialog>}
  </>;
}
