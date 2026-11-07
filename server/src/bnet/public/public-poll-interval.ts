/**
 * Adaptive rhythm of the public profile readings (docs/02 « Sources et rythme des relevés »):
 * 10 min if the character changed in the last 24 h, 1 h otherwise, 6 h once inactive for more
 * than 7 days. A login counts as a change. Pure.
 */

export const PUBLIC_POLL_ACTIVE_MS = 10 * 60_000;
export const PUBLIC_POLL_QUIET_MS = 3_600_000;
export const PUBLIC_POLL_IDLE_MS = 6 * 3_600_000;

const RECENT_CHANGE_MS = 24 * 3_600_000;
const INACTIVE_AFTER_MS = 7 * 24 * 3_600_000;

export interface PublicActivity {
  /** Last reading that changed the level or the equipment. */
  changedAt: Date | null;
  /** Latest `last_login_timestamp` seen. */
  lastLoginAt: Date | null;
}

export function publicPollIntervalMs(activity: PublicActivity, now: Date): number {
  const times = [activity.changedAt, activity.lastLoginAt].filter((t) => t !== null).map((t) => t.getTime());
  if (times.length === 0) return PUBLIC_POLL_QUIET_MS;

  const sinceActivity = now.getTime() - Math.max(...times);
  if (sinceActivity < RECENT_CHANGE_MS) return PUBLIC_POLL_ACTIVE_MS;
  if (sinceActivity > INACTIVE_AFTER_MS) return PUBLIC_POLL_IDLE_MS;
  return PUBLIC_POLL_QUIET_MS;
}
