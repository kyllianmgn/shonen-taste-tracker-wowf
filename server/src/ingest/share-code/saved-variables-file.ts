import type { ContractValidator } from '../../common/contract/contract-validator';
import { LuaParseError, parseSavedVariables } from '../../common/lua';
import type { SyncRequest } from '../sync/sync.types';
import { checkContract, type Decoded } from './share-code';

/**
 * `/sync fichier:` (docs/02 « Commande /sync »): a ForeverTracker.lua attachment read with the
 * literal-only parser of S-04 (never executed), then checked like POST /v1/sync. Every character of
 * the file is sent; SyncService keeps only the member's own.
 */
export function readSavedVariablesFile(source: Buffer, contract: ContractValidator, nowSec: number): Decoded<SyncRequest> {
  let data: ReturnType<typeof parseSavedVariables>;
  try {
    data = parseSavedVariables(source, contract.schema('sync.request'));
  } catch (error) {
    if (!(error instanceof LuaParseError)) throw error;
    if (error.code === 'SourceTooLarge') return { ok: false, reason: 'too_large' };
    return { ok: false, reason: error.code === 'NonLiteralExpression' ? 'not_literal' : 'lua_syntax' };
  }
  if (data === null || data.characters.length === 0) return { ok: false, reason: 'empty' };

  // The file has no sentAt of its own: it is sent now.
  const payload = { sentAt: nowSec, schema: data.schema, addonVersion: data.addonVersion, characters: data.characters };
  return checkContract<SyncRequest>(payload, 'sync.request', contract);
}
