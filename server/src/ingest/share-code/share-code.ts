import { inflateRawSync } from 'node:zlib';
import type { ContractValidator } from '../../common/contract/contract-validator';
import { SYNC_SCHEMA_VERSION, type SyncCharacter, type SyncRequest } from '../sync/sync.types';

/**
 * Codes of `/ftr share` (docs/01 « Mode de base : /ftr share », docs/02 « Commande /sync »):
 * `FT1:` + base64url without padding of the raw deflate of a JSON object that follows
 * contract/schemas/share-code.payload.json. Reference: contract/fixtures/share-code.sample.txt.
 */

export const SHARE_CODE_PREFIX = 'FT1:';

/** Inflated JSON cap: the same 512 KiB as POST /v1/sync, so a small code cannot expand into a bomb. */
export const SHARE_CODE_MAX_JSON_BYTES = 512 * 1024;

/** A validated share-code.payload.json: one character of the player. */
export interface SharePayload {
  sentAt: number;
  schema: typeof SYNC_SCHEMA_VERSION;
  addonVersion: string;
  character: SyncCharacter;
}

/** Why a code or a file cannot be sent; the Discord reply explains each one (discord/sync/sync-replies.ts). */
export type ManualSyncRefusal =
  | 'code_format'
  | 'code_corrupt'
  | 'too_large'
  | 'download_failed'
  | 'not_literal'
  | 'lua_syntax'
  | 'empty'
  | 'unknown_schema'
  | 'invalid';

export type Decoded<T> = { ok: true; payload: T } | { ok: false; reason: ManualSyncRefusal; detail?: string };

const CODE_PATTERN = /^FT1:[A-Za-z0-9_-]+$/;

export function decodeShareCode(text: string, contract: ContractValidator): Decoded<SharePayload> {
  const code = text.trim();
  if (!CODE_PATTERN.test(code)) return { ok: false, reason: 'code_format' };

  let json: Buffer;
  try {
    json = inflateRawSync(Buffer.from(code.slice(SHARE_CODE_PREFIX.length), 'base64url'), {
      maxOutputLength: SHARE_CODE_MAX_JSON_BYTES,
    });
  } catch (error) {
    const tooLarge = (error as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE';
    return { ok: false, reason: tooLarge ? 'too_large' : 'code_corrupt' };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(json.toString('utf8'));
  } catch {
    return { ok: false, reason: 'code_corrupt' };
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, reason: 'code_corrupt' };

  return checkContract(payload, 'share-code.payload', contract);
}

/** POST /v1/sync shape of a share code, for SyncService.ingest. */
export function toSyncRequest(payload: SharePayload): SyncRequest {
  return {
    sentAt: payload.sentAt,
    schema: payload.schema,
    addonVersion: payload.addonVersion,
    characters: [payload.character],
  };
}

/**
 * Same checks as POST /v1/sync: a numeric `schema` other than 1 is a newer addon, then the JSON
 * Schema. Only the first error's path is reported, enough for the player to tell what is wrong.
 */
export function checkContract<T>(
  payload: object,
  schemaName: 'share-code.payload' | 'sync.request',
  contract: ContractValidator,
): Decoded<T> {
  const schema = (payload as { schema?: unknown }).schema;
  if (typeof schema === 'number' && schema !== SYNC_SCHEMA_VERSION) return { ok: false, reason: 'unknown_schema' };

  const result = contract.validate(schemaName, payload);
  if (!result.ok) return { ok: false, reason: 'invalid', detail: result.errors[0]?.path };
  return { ok: true, payload: payload as T };
}
