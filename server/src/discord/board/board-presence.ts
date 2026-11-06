import type { BoardPlayer } from '../render/board';

export interface PresenceDevice {
  gameRunning: boolean;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
}

/** Heartbeats older than this many intervals mean the player is gone (docs/02 « Présence et sessions »). */
const ONLINE_INTERVALS = 2.5;

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
  const cutoff = now.getTime() - ONLINE_INTERVALS * heartbeatIntervalSec * 1000;
  const online = devices.some(
    (d) => d.revokedAt === null && d.gameRunning && d.lastSeenAt !== null && d.lastSeenAt.getTime() > cutoff,
  );
  const seen = [...devices.map((d) => d.lastSeenAt), latestDataAt].map((at) => at?.getTime() ?? -Infinity);
  const latest = Math.max(-Infinity, ...seen);
  return { online, lastSeenAt: Number.isFinite(latest) ? new Date(latest) : null };
}
