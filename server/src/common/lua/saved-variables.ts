import { LuaTable, parseLua } from './lua-parser';
import { JsonSchema, JsonValue, normalizeLuaValue } from './normalize';

export const SAVED_VARIABLES_GLOBAL = 'ForeverTrackerDB';

export interface SavedVariablesData {
  schema: JsonValue | undefined;
  addonVersion: JsonValue | undefined;
  /** One entry per character, in file order, normalized against `$defs/character`. */
  characters: JsonValue[];
}

/**
 * Parses a ForeverTracker.lua SavedVariables file without executing it.
 * Returns null when `ForeverTrackerDB` is nil, absent or not a table: nothing to send.
 * Throws LuaParseError when the file is not a pure literal.
 * Shape checks are left to contract validation (sync.request.json).
 */
export function parseSavedVariables(source: string | Buffer, syncRequestSchema: JsonSchema): SavedVariablesData | null {
  const db = parseLua(source).get(SAVED_VARIABLES_GLOBAL);
  if (!(db instanceof LuaTable)) return null;

  const field = (name: string) => {
    const v = db.entries.get(name);
    return v === undefined ? undefined : normalizeLuaValue(v, undefined, syncRequestSchema);
  };

  const characterSchema: JsonSchema = { $ref: '#/$defs/character' };
  const byGuid = db.entries.get('characters');
  const characters =
    byGuid instanceof LuaTable
      ? [...byGuid.entries.values()].map((c) => normalizeLuaValue(c, characterSchema, syncRequestSchema))
      : [];

  return { schema: field('schema'), addonVersion: field('addonVersion'), characters };
}
