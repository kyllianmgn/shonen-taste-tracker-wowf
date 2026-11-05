import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:forevertracker_sync/lua/lua_parser.dart';
import 'package:forevertracker_sync/lua/saved_variables.dart';

/// The repository's `contract/` folder, found by walking up from the test's working directory.
final Directory contractDir = () {
  var dir = Directory.current.absolute;
  while (true) {
    final candidate = Directory('${dir.path}${Platform.pathSeparator}contract');
    if (File(_join([candidate.path, 'schemas', 'sync.request.json'])).existsSync()) {
      return candidate;
    }
    final parent = dir.parent;
    if (parent.path == dir.path) throw StateError('contract/ not found above ${Directory.current}');
    dir = parent;
  }
}();

String _join(List<String> parts) => parts.join(Platform.pathSeparator);

final Directory fixturesDir = Directory(_join([contractDir.path, 'fixtures', 'savedvariables']));

final Map<String, Object?> syncRequestSchema =
    jsonDecode(File(_join([contractDir.path, 'schemas', 'sync.request.json'])).readAsStringSync())
        as Map<String, Object?>;

List<int> fixture(String name) => File(_join([fixturesDir.path, name])).readAsBytesSync();

LuaParseError catchParse(String src) {
  try {
    parseSavedVariables(src, syncRequestSchema);
  } on LuaParseError catch (e) {
    return e;
  }
  throw StateError('expected a LuaParseError');
}

void main() {
  group('ForeverTracker.sample.lua', () {
    late SavedVariablesData result;
    late List<Map<String, Object?>> characters;

    setUpAll(() {
      result = parseSavedVariablesBytes(fixture('ForeverTracker.sample.lua'), syncRequestSchema)!;
      characters = result.characters.cast<Map<String, Object?>>();
    });

    test('reads the header and 2 characters in file order', () {
      expect(result.schema, 1);
      expect(result.addonVersion, '0.1.0');
      expect(characters.map((c) => (c['key'] as Map)['firstName']), ['Davina', 'Morwen']);
    });

    test('decodes the spec example exactly', () {
      expect(characters[0], {
        'key': {
          'region': 'eu',
          'firstName': 'Davina',
          'surname': 'Asaria',
          'guid': 'Player-4242-0A1B2C3D',
          'realmName': 'CAMWOW EU5 Realm 1 PvE',
        },
        'snapshot': {
          'capturedAt': 1793900000,
          'level': 23,
          'xp': 4120,
          'xpMax': 13600,
          'rested': 2100,
          'money': 384512,
          'playedTotal': 81234,
          'playedLevel': 2310,
          'zone': 'Duskwood',
          'subZone': 'Darkshire',
          'mapId': 1431,
          'classFile': 'PRIEST',
          'raceFile': 'Troll',
          'sex': 3,
          'faction': 'Horde',
          'guild': 'Les Veilleurs',
          'guildRank': 'Membre',
          'ilvl': 21,
          'deaths': 4,
          'honor': 0,
          'equipment': [
            {'slot': 1, 'itemId': 7720, 'link': '|cff1eff00|Hitem:7720::...|h[...]|h|r'},
          ],
          'professions': [
            {'name': 'Herboristerie', 'rank': 112, 'max': 150},
          ],
          'reputations': [
            {'factionId': 76, 'name': 'Orgrimmar', 'standing': 5, 'value': 1200, 'max': 6000},
          ],
        },
        'events': [
          {
            'id': 'Player-4242-0A1B2C3D-1793899000-1',
            'type': 'SESSION_START',
            'at': 1793899000,
            'data': {'level': 22, 'zone': 'Duskwood'},
          },
          {
            'id': 'Player-4242-0A1B2C3D-1793899800-2',
            'type': 'LEVEL_UP',
            'at': 1793899800,
            'data': {'level': 23, 'playedTotal': 80900, 'zone': 'Duskwood'},
          },
        ],
      });
    });

    test('normalizes the empty tables of the 2nd character to []', () {
      final morwen = characters[1];
      final snapshot = morwen['snapshot'] as Map;
      for (final value in [
        snapshot['equipment'],
        snapshot['professions'],
        snapshot['reputations'],
        morwen['events'],
      ]) {
        expect(value, isA<List>());
        expect(value, isEmpty);
      }
    });

    test('serializes to the JSON shape sync.request expects', () {
      final json = jsonEncode(characters[1]);
      expect(json, contains('"equipment":[]'));
      expect(json, contains('"events":[]'));
      expect(jsonEncode(characters[0]), contains('"capturedAt":1793900000,'));
    });
  });

  group('ForeverTracker.empty.lua', () {
    test('returns null without error: nothing to send', () {
      expect(parseSavedVariablesBytes(fixture('ForeverTracker.empty.lua'), syncRequestSchema), isNull);
    });
  });

  group('ForeverTracker.malicious.lua', () {
    test('is rejected as a non-literal expression at the first offending value', () {
      Object? error;
      try {
        parseSavedVariablesBytes(fixture('ForeverTracker.malicious.lua'), syncRequestSchema);
      } catch (e) {
        error = e;
      }
      expect(error, isA<LuaParseError>());
      final err = error as LuaParseError;
      expect(err.code, LuaParseErrorCode.nonLiteralExpression);
      // `os.execute("calc")` in the settings table.
      expect(err.line, 6);
      expect(err.column, 75);
      expect(err.message, contains('expression non littérale'));
    });

    test('also rejects the concatenation and the global once the call is gone', () {
      final src = utf8.decode(fixture('ForeverTracker.malicious.lua'));
      final withoutCall = src.replaceFirst('os.execute("calc")', 'false');
      final concat = catchParse(withoutCall);
      expect([concat.code, concat.line, concat.column], [
        LuaParseErrorCode.nonLiteralExpression,
        9,
        84,
      ]);

      final withoutConcat = withoutCall.replaceFirst('"Asa" .. "ria"', '"Asaria"');
      final global = catchParse(withoutConcat);
      expect([global.code, global.line, global.column], [
        LuaParseErrorCode.nonLiteralExpression,
        10,
        70,
      ]);
    });
  });

  group('ForeverTracker.escapes.lua', () {
    test('decodes the documented values', () {
      final result = parseSavedVariablesBytes(
        fixture('ForeverTracker.escapes.lua'),
        syncRequestSchema,
      )!;
      expect(result.characters, hasLength(1));
      final character = result.characters.single as Map<String, Object?>;
      final snapshot = character['snapshot'] as Map<String, Object?>;
      final equipment = snapshot['equipment'] as List;
      final events = character['events'] as List;

      expect((character['key'] as Map)['realmName'], 'CAMWOW EU5 Realm 1 PvE');
      expect(snapshot['guild'], 'Les "Veilleurs"');
      expect(snapshot['guildRank'], "L'Officier");
      expect(snapshot['zone'], 'Bois de la Pénombre');
      expect(snapshot['subZone'], 'Line one\nLine two\tTabbed\\Backslash');
      expect(snapshot['ilvl'], 21.5);
      expect(
        (equipment[0] as Map)['link'],
        "|cff1eff00|Hitem:7720::::::::23:::::::::|h[Whitemane's Chapeau]|h|r",
      );
      expect((equipment[1] as Map)['link'], '|cffffffff|Hitem:6060::::::::23:::::::::|h[Flax Vest]|h|r');
      expect(snapshot['professions'], isA<List>().having((l) => l.length, 'length', 0));
      expect(snapshot['reputations'], isA<List>().having((l) => l.length, 'length', 0));
      final data0 = (events[0] as Map)['data'];
      expect(data0, isA<Map>());
      expect(data0, isEmpty);
      final data1 = (events[1] as Map)['data'] as Map;
      expect(data1['from'], 'Ancienne -- pas un commentaire');
      expect(data1['to'], 'Les "Veilleurs" ]] encore');
    });
  });

  test('covers every SavedVariables fixture', () {
    final names =
        fixturesDir.listSync().map((f) => f.uri.pathSegments.last).toList()..sort();
    expect(names, [
      'ForeverTracker.empty.lua',
      'ForeverTracker.escapes.lua',
      'ForeverTracker.malicious.lua',
      'ForeverTracker.sample.lua',
    ]);
  });

  group('structure', () {
    test('returns no characters when ForeverTrackerDB has none', () {
      final result = parseSavedVariables('ForeverTrackerDB = { schema = 1 }', syncRequestSchema)!;
      expect(result.schema, 1);
      expect(result.addonVersion, isNull);
      expect(result.characters, isEmpty);
    });

    test('returns null when ForeverTrackerDB is not a table', () {
      expect(parseSavedVariables('ForeverTrackerDB = 5', syncRequestSchema), isNull);
    });
  });

  test('lua module sources never run code (no Process, isolate spawn or mirrors)', () {
    final libLua = Directory(_join(['lib', 'lua']));
    final sources = libLua.listSync().whereType<File>().where((f) => f.path.endsWith('.dart'));
    expect(sources, isNotEmpty);
    final forbidden = [
      RegExp(r'\bProcess\.'),
      RegExp(r'''['"]dart:(isolate|mirrors|ffi)['"]'''),
      RegExp(r'\bInterpreter\b'),
    ];
    for (final file in sources) {
      final text = file.readAsStringSync();
      for (final pattern in forbidden) {
        expect((file.path, pattern.hasMatch(text)), (file.path, false));
      }
    }
  });
}
