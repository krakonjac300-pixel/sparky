import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { calendarDate, shiftDate } from './model.ts';
import { periodStart, type Period } from './reports.ts';

const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const dayThisYear = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const shortDay = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const monthYear = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const shortMonth = new Intl.DateTimeFormat(undefined, { month: 'short' });

/** A readable title for the date or period on screen, e.g. "Wed, 25 Nov 2026", "23 Nov to 29 Nov 2026", "November 2026". */
export function periodTitle(date: string, period: Period, show: 'day' | 'range') {
  if (show === 'day' || period === 'Day') {
    // The year only when it is not this year, so the title fits at large text.
    const day = calendarDate(date);
    return (day.getFullYear() === new Date().getFullYear() ? dayThisYear : dayFormat).format(day);
  }
  const start = periodStart(date, period);
  const end = shiftDate(periodStart(date, period, 1), -1);
  const year = calendarDate(end).getFullYear();
  if (period === 'Week') return `${shortDay.format(calendarDate(start))} to ${shortDay.format(calendarDate(end))} ${year}`;
  if (period === 'Month') return monthYear.format(calendarDate(start));
  if (period === 'Year') return String(year);
  return `${shortMonth.format(calendarDate(start))} to ${shortMonth.format(calendarDate(end))} ${year}`;
}

/** Previous and next arrows around a tappable title; the title opens the phone's own date picker. */
export function PeriodNavigation({ date, today, period, select, show = 'range' }: {
  date: string; today: string; period: Period; select: (date: string) => void; show?: 'day' | 'range';
}) {
  const name = period.toLowerCase();
  const move = (offset: number) => {
    const start = periodStart(date, period, offset);
    select(start > today ? today : start);
  };
  const away = show === 'day' ? date !== today : periodStart(date, period) !== periodStart(today, period);
  return <>
    <div className="period-nav">
      <button type="button" className="period-step" aria-label={`Previous ${name}`}
        disabled={periodStart(date, period, -1) < '0001-01-01'} onClick={() => move(-1)}><ChevronLeft size={20} /></button>
      <label className="period-title">
        <CalendarDays size={16} aria-hidden="true" />
        <span className="period-title-text">{periodTitle(date, period, show)}</span>
        <input className="period-picker" type="date" aria-label="Choose date" min="0001-01-01" max={today} value={date} onChange={(event) => {
          const input = event.currentTarget;
          if (input.value && input.validity.valid) select(input.value);
        }} />
      </label>
      <button type="button" className="period-step" aria-label={`Next ${name}`}
        disabled={periodStart(date, period, 1) > today} onClick={() => move(1)}><ChevronRight size={20} /></button>
    </div>
    {away && <button type="button" className="text-button period-today" onClick={() => select(today)}>Back to today</button>}
  </>;
}
