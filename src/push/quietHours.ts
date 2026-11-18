import { brtMinuteOfDay } from '@/utils/brtDate';
import { QuietHoursWindow } from './types/quietHoursWindow';

export const DEFAULT_QUIET_HOURS: QuietHoursWindow = {
  enabled: true,
  startMinute: 22 * 60,
  endMinute: 7 * 60,
};

// Start is inclusive, end exclusive, in Brasília time. A window whose start
// is after its end crosses midnight and counts as one continuous window;
// equal start and end means quiet hours are off.
export function isInQuietHours(window: QuietHoursWindow, now: Date): boolean {
  if (!window.enabled || window.startMinute === window.endMinute) return false;

  const minute = brtMinuteOfDay(now);
  if (window.startMinute < window.endMinute) {
    return minute >= window.startMinute && minute < window.endMinute;
  }
  return minute >= window.startMinute || minute < window.endMinute;
}
