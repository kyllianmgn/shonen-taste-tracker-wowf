import type { Region } from '../../core/characters/character.types';
import type { SyncFlag } from './sync-rules';

/**
 * Body of POST /v1/sync once validated against contract/schemas/sync.request.json,
 * and its 200 answer (sync.response.json). The schemas win if they differ.
 */

/** The only `schema` value this server reads; anything else is 422 unknown_schema. */
export const SYNC_SCHEMA_VERSION = 1;

/** Max body size of POST /v1/sync (docs/02 « Contrat d'échange »). */
export const SYNC_MAX_BODY_BYTES = 512 * 1024;

export interface SyncKey {
  region: Region;
  firstName: string;
  surname: string;
  guid?: string;
  realmName?: string;
}

export interface SyncSnapshot {
  capturedAt: number;
  level: number;
  xp?: number;
  xpMax?: number;
  rested?: number;
  money?: number;
  playedTotal?: number;
  playedLevel?: number;
  zone?: string;
  subZone?: string;
  classFile?: string;
  raceFile?: string;
  faction?: 'Alliance' | 'Horde' | 'Neutral';
  /** Other fields of the schema (equipment, professions, reputations…) end up in snapshot.detail. */
  [field: string]: unknown;
}

export interface SyncEvent {
  id: string;
  type: string;
  at: number;
  data: Record<string, unknown>;
}

export interface SyncCharacter {
  key: SyncKey;
  snapshot: SyncSnapshot;
  events: SyncEvent[];
}

export interface SyncRequest {
  sentAt: number;
  schema: typeof SYNC_SCHEMA_VERSION;
  addonVersion: string;
  characters: SyncCharacter[];
}

export type SyncStatus = 'ok' | 'untracked' | 'owned_by_other' | 'rejected';

export interface SyncResult {
  key: { region: Region; firstName: string; surname: string };
  status: SyncStatus;
  acceptedEvents: number;
  duplicateEvents: number;
  flags: SyncFlag[];
}

export interface SyncResponse {
  heartbeatIntervalSec: number;
  results: SyncResult[];
}
