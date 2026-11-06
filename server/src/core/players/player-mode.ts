/**
 * Tracking mode of a player (docs/02 « Mode de base »): app mode with at least one active device,
 * base mode otherwise. A device is active when it is not revoked and was seen in the last 7 days.
 */

export type PlayerMode = 'app' | 'base';

export const APP_MODE_WINDOW_DAYS = 7;
const WINDOW_MS = APP_MODE_WINDOW_DAYS * 86_400_000;

export interface DeviceActivity {
  lastSeenAt: Date | null;
  revokedAt: Date | null;
}

export function playerMode(devices: readonly DeviceActivity[], now: Date): PlayerMode {
  const since = now.getTime() - WINDOW_MS;
  const active = devices.some((d) => d.revokedAt === null && d.lastSeenAt !== null && d.lastSeenAt.getTime() >= since);
  return active ? 'app' : 'base';
}

/** Earliest `last_seen_at` that still counts as active, for database queries. */
export function appModeSince(now: Date): Date {
  return new Date(now.getTime() - WINDOW_MS);
}
