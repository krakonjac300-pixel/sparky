import { useEffect, useState } from 'react';
import { localDate } from './model.ts';

export const defaultTurtleReviewHour = 21;
export type TurtleReviewHour = 21 | 22;

export function useTurtleReview(today: string, hour: TurtleReviewHour) {
  const reviewKey = `${today}:${hour}`;
  const [activeKey, setActiveKey] = useState(() => new Date().getHours() >= hour ? reviewKey : '');

  useEffect(() => {
    let timer: number;
    function schedule() {
      window.clearTimeout(timer);
      const now = new Date();
      const boundary = new Date(now);
      boundary.setHours(hour, 0, 0, 0);
      const started = now >= boundary;
      setActiveKey(started && localDate(now) === today ? reviewKey : '');
      if (started) boundary.setHours(24, 0, 0, 0);
      timer = window.setTimeout(schedule, boundary.getTime() - now.getTime());
    }

    schedule();
    window.addEventListener('focus', schedule);
    document.addEventListener('visibilitychange', schedule);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', schedule);
      document.removeEventListener('visibilitychange', schedule);
    };
  }, [hour, reviewKey, today]);

  return activeKey === reviewKey;
}
