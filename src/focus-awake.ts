import { useEffect } from 'react';
import { androidRequest, onAndroid } from './android.ts';

let activeTimers = 0;

export function useFocusAwake(active: boolean) {
  useEffect(() => {
    if (!active || !onAndroid()) return;
    activeTimers++;
    if (activeTimers === 1) void androidRequest('keepAwake', 'on', 3000).catch(() => undefined);
    return () => {
      activeTimers--;
      if (activeTimers === 0) void androidRequest('keepAwake', 'off', 3000).catch(() => undefined);
    };
  }, [active]);
}
