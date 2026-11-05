import 'lua_parser.dart';
import 'normalize.dart';

const String savedVariablesGlobal = 'ForeverTrackerDB';

class SavedVariablesData {
  const SavedVariablesData({
    required this.schema,
    required this.addonVersion,
    required this.characters,
  });

  /// As written by the addon; the caller refuses a `schema` it does not know (docs/01).
  final Object? schema;
  final Object? addonVersion;

  /// One entry per character, in file order, normalized against `$defs/character`.
  final List<Object?> characters;
}

/// Parses a ForeverTracker.lua SavedVariables file without executing it.
/// Port of `server/src/common/lua/saved-variables.ts`.
///
/// Returns null when `ForeverTrackerDB` is nil, absent or not a table: nothing to send.
/// Throws [LuaParseError] when the file is not a pure literal.
/// Shape checks are left to contract validation (`sync.request.json`), passed as
/// [syncRequestSchema].
SavedVariablesData? parseSavedVariables(String source, JsonSchema syncRequestSchema) =>
    _fromGlobals(parseLua(source), syncRequestSchema);

/// Same as [parseSavedVariables] for the raw bytes of the file.
SavedVariablesData? parseSavedVariablesBytes(List<int> bytes, JsonSchema syncRequestSchema) =>
    _fromGlobals(parseLuaBytes(bytes), syncRequestSchema);

SavedVariablesData? _fromGlobals(Map<String, Object> globals, JsonSchema root) {
  final db = globals[savedVariablesGlobal];
  if (db is! LuaTable) return null;

  Object? field(String name) {
    final v = db.entries[name];
    return v == null ? null : normalizeLuaValue(v, null, root);
  }

  const characterSchema = {r'$ref': r'#/$defs/character'};
  final byGuid = db.entries['characters'];
  final characters = byGuid is LuaTable
      ? [for (final c in byGuid.entries.values) normalizeLuaValue(c, characterSchema, root)]
      : <Object?>[];

  return SavedVariablesData(
    schema: field('schema'),
    addonVersion: field('addonVersion'),
    characters: characters,
  );
}
