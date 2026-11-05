import 'lua_parser.dart';

/// A JSON Schema document as decoded by `jsonDecode` (only the keywords below are used).
typedef JsonSchema = Map<String, Object?>;

/// Converts a neutral Lua value into JSON-ready Dart values (null, bool, num, String,
/// `List<Object?>`, `Map<String, Object?>`), using the schema to decide what a table is
/// (docs/03 « Contrat partagé », piège du parseur). Port of `server/src/common/lua/normalize.ts`:
/// - schema says array: a sequence (keys 1..n, including the empty table) becomes a list;
/// - schema says object: the table becomes a map (number keys are stringified);
/// - no guidance: a non-empty sequence becomes a list, anything else a map.
/// A table that does not fit its schema keeps its map shape so that validation rejects it.
/// `$ref` is resolved against [root] (local JSON pointers only); anything else throws
/// [ArgumentError].
Object? normalizeLuaValue(Object value, JsonSchema? schema, JsonSchema root) {
  if (value is! LuaTable) return value;
  final resolved = _resolve(schema, root);
  final type = _schemaType(resolved);

  if (type == 'array' || (type == null && value.entries.isNotEmpty)) {
    final sequence = _asSequence(value);
    if (sequence != null) {
      final items = _asSchema(resolved?['items']);
      return [for (final item in sequence) normalizeLuaValue(item, items, root)];
    }
  }

  return <String, Object?>{
    for (final MapEntry(:key, value: item) in value.entries.entries)
      _keyString(key): normalizeLuaValue(item, _propertySchema(resolved, _keyString(key)), root),
  };
}

/// Prints a key the way Lua and JavaScript do: `1`, not `1.0`.
String _keyString(Object key) {
  if (key is double && key == key.truncateToDouble() && key.abs() < 1e21) {
    return key.toInt().toString();
  }
  return key.toString();
}

JsonSchema? _asSchema(Object? value) => value is Map<String, Object?> ? value : null;

String? _schemaType(JsonSchema? schema) {
  if (schema == null) return null;
  final type = schema['type'];
  if (type is String) return type;
  if (schema.containsKey('properties') || schema.containsKey('additionalProperties')) {
    return 'object';
  }
  if (schema.containsKey('items')) return 'array';
  return null;
}

JsonSchema? _propertySchema(JsonSchema? schema, String key) {
  if (schema == null) return null;
  final properties = _asSchema(schema['properties']);
  if (properties != null && properties.containsKey(key)) return _asSchema(properties[key]);
  return _asSchema(schema['additionalProperties']);
}

List<Object>? _asSequence(LuaTable table) {
  final items = <Object>[];
  for (var i = 1; i <= table.entries.length; i++) {
    final item = table.entries[i];
    if (item == null) return null;
    items.add(item);
  }
  return items;
}

JsonSchema? _resolve(JsonSchema? schema, JsonSchema root) {
  var current = schema;
  for (var hops = 0; current != null && current.containsKey(r'$ref'); hops++) {
    final ref = current[r'$ref'];
    if (hops > 32 || ref is! String || !ref.startsWith('#/')) {
      throw ArgumentError('unsupported \$ref: $ref');
    }
    Object? target = root;
    for (final raw in ref.substring(2).split('/')) {
      final segment = raw.replaceAll('~1', '/').replaceAll('~0', '~');
      target = target is Map<String, Object?> ? target[segment] : null;
    }
    if (target is! Map<String, Object?>) throw ArgumentError('unresolvable \$ref: $ref');
    current = target;
  }
  return current;
}
