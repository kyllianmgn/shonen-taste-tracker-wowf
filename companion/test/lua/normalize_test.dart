import 'package:flutter_test/flutter_test.dart';
import 'package:forevertracker_sync/lua/lua_parser.dart';
import 'package:forevertracker_sync/lua/normalize.dart';

LuaTable lua([Map<Object, Object> entries = const {}]) {
  final t = LuaTable();
  t.entries.addAll(entries);
  return t;
}

const Map<String, Object?> root = {
  'type': 'object',
  'properties': {
    'list': {
      'type': 'array',
      'items': {r'$ref': r'#/$defs/item'},
    },
    'data': {'type': 'object'},
  },
  r'$defs': {
    'item': {
      'type': 'object',
      'properties': {
        'tags': {'type': 'array'},
        'meta': {'type': 'object'},
      },
    },
  },
};

void main() {
  test('passes scalars through', () {
    expect(normalizeLuaValue('s', null, root), 's');
    expect(normalizeLuaValue(1.5, {'type': 'number'}, root), 1.5);
    expect(normalizeLuaValue(false, null, root), false);
  });

  test('turns an empty table into [] or {} as the schema says', () {
    final value = lua({'list': lua(), 'data': lua()});
    final out = normalizeLuaValue(value, root, root) as Map;
    expect(out, {'list': [], 'data': {}});
    expect(out['list'], isA<List>());
    expect(out['data'], isA<Map>());
  });

  test(r'follows $ref into $defs and through array items', () {
    final value = lua({
      'list': lua({
        1: lua({'tags': lua(), 'meta': lua()}),
      }),
    });
    expect(normalizeLuaValue(value, root, root), {
      'list': [
        {'tags': [], 'meta': {}},
      ],
    });
  });

  test('turns sequential tables into arrays where the schema expects one', () {
    final value = lua({
      'list': lua({1: lua(), 2: lua()}),
    });
    expect(normalizeLuaValue(value, root, root), {
      'list': [{}, {}],
    });
  });

  test('keeps a non-sequential table as an object even where an array is expected', () {
    final value = lua({
      'list': lua({1: lua(), 3: lua()}),
    });
    expect(normalizeLuaValue(value, root, root), {
      'list': {'1': {}, '3': {}},
    });
  });

  test('stringifies integer keys of objects', () {
    expect(normalizeLuaValue(lua({1: 'a', 2: 'b'}), {'type': 'object'}, root), {
      '1': 'a',
      '2': 'b',
    });
  });

  test('without schema guidance: non-empty sequences become arrays, everything else objects', () {
    expect(normalizeLuaValue(lua({1: 'a', 2: 'b'}), null, root), ['a', 'b']);
    expect(normalizeLuaValue(lua(), null, root), {});
    expect(
      normalizeLuaValue(
        lua({
          'k': lua({1: 1}),
        }),
        null,
        root,
      ),
      {
        'k': [1],
      },
    );
  });

  test('uses an additionalProperties schema for unknown keys', () {
    const schema = {
      'type': 'object',
      'additionalProperties': {'type': 'array'},
    };
    expect(normalizeLuaValue(lua({'any': lua()}), schema, root), {'any': []});
  });

  test('stringifies a float key the way Lua and JavaScript print it', () {
    expect(normalizeLuaValue(lua({1.5: 'x'}), null, root), {'1.5': 'x'});
  });

  test(r'rejects a $ref outside the root document', () {
    expect(
      () => normalizeLuaValue(lua(), {r'$ref': 'other.json#/x'}, root),
      throwsA(isA<ArgumentError>().having((e) => e.message, 'message', contains(r'$ref'))),
    );
  });
}
