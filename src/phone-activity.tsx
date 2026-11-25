import { useState } from 'react';
import { Footprints, Moon, Smartphone } from 'lucide-react';
import { onAndroid } from './android.ts';
import { AppLimitHistory, AppLimits } from './app-limit-views.tsx';
import { type Commit } from './expansion.tsx';
import { calendarDate, type AppData, type ScreenDay } from './model.ts';
import { type PhoneSync } from './phone-sync.ts';
import { PeriodNavigation } from './period-navigation.tsx';
import { minutesLabel, periodDates, periods, type Period } from './reports.ts';

const shortDate = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });
const weekday = new Intl.DateTimeFormat('en', { weekday: 'short' });
const number = new Intl.NumberFormat('en');
const syncDate = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });
const fullDate = new Intl.DateTimeFormat('en', { dateStyle: 'full' });
const month = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' });

type ChartSlot = { key: string; label: string; tick?: string; upcoming?: boolean; value?: number };
type HourValue = { hour: number; value: number };

function duration(seconds: number) {
  if (seconds === 0) return '0 min';
  if (seconds < 60) return '<1 min';
  return minutesLabel(Math.floor(seconds / 60));
}

function hourSlots(hours: HourValue[], today: boolean): ChartSlot[] {
  const values = new Map(hours.map(({ hour, value }) => [hour, value]));
  const currentHour = new Date().getHours();
  return Array.from({ length: 24 }, (_, hour) => {
    const key = String(hour).padStart(2, '0');
    return { key, label: `${key}:00`, tick: hour % 6 === 0 || hour === 23 ? key : undefined,
      value: values.get(hour), upcoming: today && hour > currentHour };
  });
}

function Trend({ slots, format, color, label, selected, select }: {
  slots: ChartSlot[]; format: (value: number) => string;
  color: string; label: string; selected?: string; select?: (date: string) => void;
}) {
  const max = Math.max(1, ...slots.map(({ value }) => value ?? 0));
  return <div className={`phone-trend ${color}`}>
    <div className="phone-chart" role="group" aria-label={label}>
      {slots.map(({ key, label, value, upcoming }) => {
        const description = `${label}, ${value === undefined ? (upcoming ? 'upcoming' : 'no data') : format(value)}`;
        const bar = (value !== undefined || !upcoming) && <span className={`phone-chart-bar${value === undefined ? ' missing' : ''}`}
          style={{ height: `${100 * (value ?? 0) / max}%` }} />;
        return select && !upcoming
          ? <button key={key} type="button" className="phone-chart-cell" aria-label={description} title={description}
              aria-pressed={selected === key} onClick={() => select(key)}>{bar}</button>
          : <span key={key} className={`phone-chart-cell${selected === key ? ' selected' : ''}`} role="img"
              aria-label={description} title={description}>{bar}</span>;
      })}
    </div>
    <div className="phone-chart-dates" aria-hidden="true">{slots.map(({ key, tick }) => <span key={key}>{tick}</span>)}</div>
  </div>;
}

function AppBreakdown({ days }: { days: ScreenDay[] }) {
  const byApp = new Map<string, ScreenDay['apps'][number]>();
  for (const { apps } of days) for (const app of apps) {
    byApp.set(app.id, { ...app, seconds: app.seconds + (byApp.get(app.id)?.seconds ?? 0) });
  }
  const apps = [...byApp.values()].sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name));
  if (!apps.length) return <p className="muted">No app activity recorded for this selection.</p>;
  const rows = (entries: typeof apps) => <ul className="phone-app-list">{entries.map((app) => <li key={app.id}>
    <div><strong>{app.name}</strong><span>{duration(app.seconds)}</span></div>
    <progress aria-label={`${app.name}, ${duration(app.seconds)}`} value={app.seconds} max={apps[0].seconds} />
  </li>)}</ul>;
  return <>{rows(apps.slice(0, 5))}{apps.length > 5 && <details className="phone-app-more">
    <summary>Show {apps.length - 5} more apps</summary>{rows(apps.slice(5))}
  </details>}</>;
}

function total(values: Map<string, number>) {
  return [...values.values()].reduce((sum, value) => sum + value, 0);
}

export function PhoneActivity({ data, today, date, select, sync, commit, openConnections }: {
  data: AppData; today: string; date: string; select: (date: string) => void; sync: PhoneSync; commit: Commit; openConnections: () => void;
}) {
  const [period, setPeriod] = useState<Period>('Day');
  const [selected, setSelected] = useState<string>();
  const dates = periodDates(date, period);
  const first = dates[0];
  const last = dates[dates.length - 1];
  const inRange = ({ date }: { date: string }) => date >= first && date <= last && date <= today;
  const stepDays = data.steps ?? [];
  const sleep = new Map(data.sleep.filter(inRange).map(({ date, minutes }) => [date, minutes]));
  const steps = new Map(stepDays.filter(inRange).map(({ date, steps }) => [date, steps]));
  const screenDays = (data.screenTime ?? []).filter(inRange).sort((a, b) => a.date.localeCompare(b.date));
  const screen = new Map(screenDays.map(({ date, seconds }) => [date, seconds]));
  const selectableDays = dates.filter((day) => day <= today);
  const isDay = period === 'Day';
  const isToday = isDay && date === today;
  const selectedDate = isDay ? date : selected && selectableDays.includes(selected) ? selected : undefined;
  const screenSelection = selectedDate ? screenDays.filter(({ date }) => date === selectedDate) : screenDays;
  const todaySteps = isDay ? stepDays.find((day) => day.date === date)?.hours : undefined;
  const todayScreen = isDay ? screenDays[0]?.hours : undefined;
  const sleepValue = selectedDate ? sleep.get(selectedDate) : sleep.size ? Math.round(total(sleep) / sleep.size) : undefined;
  const stepsValue = selectedDate ? steps.get(selectedDate) : steps.size ? total(steps) : undefined;
  const screenValue = selectedDate ? screen.get(selectedDate) : screen.size ? total(screen) : undefined;
  const formatSteps = (value: number) => `${number.format(value)} steps`;
  const lastHealthSync = Math.max(sync.status?.sleep?.updated ?? 0, sync.status?.steps?.updated ?? 0);
  const lastUsageSync = sync.status?.screen?.updated;
  const rangeLabel = isDay ? fullDate.format(calendarDate(date)) : period === 'Month' ? month.format(calendarDate(first))
    : `${shortDate.format(calendarDate(first))}${first.slice(0, 4) !== last.slice(0, 4) ? `, ${first.slice(0, 4)}` : ''} to ${shortDate.format(calendarDate(last))}, ${calendarDate(last).getFullYear()}`;
  const dayLabel = selectedDate && (isToday ? 'Today' : shortDate.format(calendarDate(selectedDate)));
  const selectDay = (day: string) => {
    select(day);
    setSelected(selectedDate === day ? undefined : day);
  };
  const dailySlots = (values: Map<string, number>): ChartSlot[] => dates.map((date, index) => ({
    key: date, label: shortDate.format(calendarDate(date)), value: values.get(date), upcoming: date > today,
    tick: period === 'Week' ? weekday.format(calendarDate(date))
      : index === 0 || (index + 1) % 7 === 0 || date === last ? String(index + 1) : undefined,
  }));
  const dailyTrend = (values: Map<string, number>, format: (value: number) => string, color: string, label: string) =>
    <Trend slots={dailySlots(values)} format={format} color={color} label={label} selected={selectedDate} select={selectDay} />;

  return <div className="expanded-stack phone-activity">
    <div className="phone-activity-toolbar">
      <div className="periods" role="group" aria-label="Phone activity period">{periods.map((choice) => <button
        key={choice} type="button" className="secondary-button" aria-pressed={period === choice} onClick={() => {
          setPeriod(choice);
          setSelected(undefined);
        }}>{choice}</button>)}</div>
      {onAndroid() && <button className="text-button" type="button" onClick={openConnections}>Phone connections</button>}
    </div>
    <div className="phone-range-heading">
      <h2>{rangeLabel}</h2>
      <PeriodNavigation date={date} today={today} period={period} select={(day) => { select(day); setSelected(undefined); }} />
    </div>
    {!onAndroid() && !sleep.size && !steps.size && !screen.size && <p className="muted">Connect Health Connect and Usage access in the Android app to see your activity here.</p>}
    {sync.error && <p className="muted" role="status">{sync.error}</p>}
    {!isDay && <label className="phone-day-select">Activity day<select value={selectedDate ?? ''}
      onChange={(event) => { const day = event.target.value; if (day) select(day); setSelected(day || undefined); }}>
      <option value="">Whole {period.toLowerCase()}</option>
      {[...selectableDays].reverse().map((date) => <option key={date} value={date}>{shortDate.format(calendarDate(date))}</option>)}
    </select></label>}
    <div className="phone-health-grid">
      <section className="panel settings-panel phone-trend-card">
        <h2><Moon size={18} /> Sleep</h2>
        {sleepValue !== undefined ? <div className="phone-trend-number"><strong>{minutesLabel(sleepValue)}</strong>
          <span>{dayLabel ?? `Avg. across ${sleep.size} ${sleep.size === 1 ? 'night' : 'nights'}`}</span></div>
          : <p className="muted phone-metric-empty">No sleep recorded {isToday ? 'today' : 'for this selection'}.</p>}
        {!isDay && dates.length <= 31 && sleep.size > 0 && dailyTrend(sleep, minutesLabel, 'phone-sleep', 'Daily sleep')}
      </section>
      <section className="panel settings-panel phone-trend-card">
        <h2><Footprints size={18} /> Steps</h2>
        {stepsValue !== undefined ? <div className="phone-trend-number"><strong>{number.format(stepsValue)}</strong>
          <span>{dayLabel ?? `Total across ${steps.size} ${steps.size === 1 ? 'day' : 'days'}`}</span></div>
          : <p className="muted phone-metric-empty">No steps recorded {isToday ? 'today' : 'for this selection'}.</p>}
        {todaySteps && <Trend slots={hourSlots(todaySteps, isToday)} format={formatSteps} color="phone-steps" label="Steps by hour" />}
        {!isDay && dates.length <= 31 && steps.size > 0 && dailyTrend(steps, formatSteps, 'phone-steps', 'Daily steps')}
      </section>
    </div>
    {lastHealthSync > 0 && <p className="muted phone-sync-note">Health Connect checked {syncDate.format(lastHealthSync)}</p>}
    <section className="panel settings-panel phone-trend-card">
      <h2><Smartphone size={18} /> Screen time</h2>
      {screen.size ? <div className="phone-screen-grid">
        <div>
          {screenValue !== undefined ? <div className="phone-trend-number"><strong>{duration(screenValue)}</strong>
            <span>{dayLabel ?? `Total across ${screen.size} ${screen.size === 1 ? 'day' : 'days'}`}</span></div>
            : <p className="muted phone-metric-empty">No screen time recorded for this day.</p>}
          {todayScreen && <Trend slots={hourSlots(todayScreen, isToday)} format={duration} color="phone-screen" label="Screen time by hour" />}
          {!isDay && dates.length <= 31 && dailyTrend(screen, duration, 'phone-screen', 'Daily screen time')}
          {lastUsageSync && <p className="muted phone-sync-note">Usage checked {syncDate.format(lastUsageSync)}</p>}
        </div>
        <div className="phone-app-breakdown">
          <div className="section-heading"><h3>{isToday ? 'Apps used today' : dayLabel ? `Apps on ${dayLabel}` : 'Most used apps'}</h3></div>
          <AppBreakdown days={screenSelection} />
        </div>
      </div> : <p className="muted phone-metric-empty">No app activity recorded {isToday ? 'today' : 'in this period'}.</p>}
    </section>
    {selectedDate ? <AppLimits data={data} today={today} date={selectedDate} commit={commit} lastSync={lastUsageSync} />
      : <AppLimitHistory data={data} dates={dates} today={today} />}
  </div>;
}
