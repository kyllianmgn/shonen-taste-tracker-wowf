import { isOnline } from '../../presence/presence-machine';
import type { BoardPlayer } from '../render/board';

export interface PresenceDevice {
  gameRunning: boolean;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
}

/**
 * Online = a non-revoked device runs the game and sent a heartbeat less than 2.5 intervals ago.
 * « Vu il y a » uses the latest heartbeat of any device, or `latestDataAt` when it is more recent
 * (base mode: the last snapshot received).
 */
export function boardPresence(
  devices: PresenceDevice[],
  now: Date,
  heartbeatIntervalSec: number,
  latestDataAt: Date | null = null,
): BoardPlayer['presence'] {
  // Same rule as the presence engine (S-09), on non-revoked devices.
  const active = devices
    .filter((d) => d.revokedAt === null)
    .map((d, i) => ({ id: String(i), gameRunning: d.gameRunning, lastSeenAt: d.lastSeenAt?.getTime() ?? null }));
  const online = isOnline(active, now.getTime(), { heartbeatIntervalSec });
  const seen = [...devices.map((d) => d.lastSeenAt), latestDataAt].map((at) => at?.getTime() ?? -Infinity);
  const latest = Math.max(-Infinity, ...seen);
  return { online, lastSeenAt: Number.isFinite(latest) ? new Date(latest) : null };
}
