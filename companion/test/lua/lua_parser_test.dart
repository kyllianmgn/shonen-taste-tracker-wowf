import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:forevertracker_sync/lua/lua_parser.dart';

Object? value(String source) => parseLua('X = $source')['X'];

LuaTable table(String source) {
  final v = value(source);
  if (v is! LuaTable) throw StateError('expected a table');
  return v;
}

LuaParseError parseError(String source) {
  try {
    parseLua(source);
  } on LuaParseError catch (e) {
    return e;
  }
  throw StateError('expected a LuaParseError');
}

List<List<Object?>> entriesOf(LuaTable t) => [
  for (final e in t.entries.entries) [e.key, e.value],
];

void main() {
  group('top-level assignments', () {
    test('returns every assigned global by name', () {
      final globals = parseLua('A = 1\nB = "two"; C = true');
      expect(globals, {'A': 1, 'B': 'two', 'C': true});
      expect(globals.keys.toList(), ['A', 'B', 'C']);
    });

    test('treats an assignment to nil as unset', () {
      expect(parseLua('ForeverTrackerDB = nil').containsKey('ForeverTrackerDB'), isFalse);
    });

    test('accepts an empty source', () {
      expect(parseLua('  -- nothing\n'), isEmpty);
    });

    test('rejects a statement that is not an assignment', () {
      expect(parseError('print("hi")').code, LuaParseErrorCode.nonLiteralExpression);
    });
  });

  group('scalars', () {
    const cases = <String, Object>{
      '42': 42,
      '-7': -7,
      '3.25': 3.25,
      '-0.5': -0.5,
      '.5': 0.5,
      '5.': 5,
      '1e3': 1000,
      '2.5E-1': 0.25,
      '0x1F': 31,
      '0XfF': 255,
      '-0x10': -16,
      'true': true,
      'false': false,
    };
    cases.forEach((src, expected) {
      test('parses $src', () => expect(value(src), expected));
    });

    test('keeps integer literals as int and decimals as double', () {
      expect(value('23'), isA<int>());
      expect(value('0x10'), isA<int>());
      expect(value('21.5'), isA<double>());
    });

    test('parses an integer too large for int as a double', () {
      expect(value('123456789012345678901234567890'), 1.2345678901234568e29);
    });

    test('parses nil as an absent value', () {
      expect(value('nil'), isNull);
    });

    test('rejects a malformed number', () {
      expect(parseError('X = 12abc').code, LuaParseErrorCode.syntaxError);
    });
  });

  group('strings', () {
    const cases = <String, String>{
      '"plain"': 'plain',
      "'single'": 'single',
      r'"a\nb\tc"': 'a\nb\tc',
      r'"q\"q"': 'q"q',
      r"'it\'s'": "it's",
      r'"back\\slash"': r'back\slash',
      r'"\124cff"': '|cff',
      r'"P\195\169nombre"': 'Pénombre',
      r'"\0491"': '11',
      '"line\\\nbreak"': 'line\nbreak',
      '"é direct"': 'é direct',
      '[[long "string"]]': 'long "string"',
      '[[\nskips first newline]]': 'skips first newline',
      '[==[has ]] inside]==]': 'has ]] inside',
      '[=[a\r\nb]=]': 'a\nb',
    };
    cases.forEach((src, expected) {
      test('decodes ${jsonEncode(src)}', () => expect(value(src), expected));
    });

    test('rejects an unknown escape', () {
      expect(parseError(r'X = "\q"').code, LuaParseErrorCode.syntaxError);
    });

    test('rejects a decimal escape above 255', () {
      expect(parseError(r'X = "\256"').code, LuaParseErrorCode.syntaxError);
    });

    test('rejects an unterminated string', () {
      expect(parseError('X = "abc\nY = 1').code, LuaParseErrorCode.syntaxError);
    });

    test('rejects an unterminated long string', () {
      expect(parseError('X = [==[abc]]').code, LuaParseErrorCode.syntaxError);
    });
  });

  group('tables', () {
    test('supports ["str"], [n], ident and positional fields in source order', () {
      final t = table('{ ["a"] = 1, [10] = 2, b = 3, "pos1"; "pos2", }');
      expect(entriesOf(t), [
        ['a', 1],
        [10, 2],
        ['b', 3],
        [1, 'pos1'],
        [2, 'pos2'],
      ]);
    });

    test('keeps the string key "1" distinct from the integer key 1', () {
      final t = table('{ ["1"] = "s", [1] = "n" }');
      expect(t.entries['1'], 's');
      expect(t.entries[1], 'n');
    });

    test('lets a later duplicate key win', () {
      expect(table('{ a = 1, a = 2 }').entries['a'], 2);
    });

    test('drops nil fields but keeps positional numbering', () {
      final t = table('{ "a", nil, "c", k = nil }');
      expect(entriesOf(t), [
        [1, 'a'],
        [3, 'c'],
      ]);
    });

    test('accepts a positional long string', () {
      expect(entriesOf(table('{ [[x]] }')), [
        [1, 'x'],
      ]);
    });

    test('parses nested and empty tables', () {
      final t = table('{ inner = { {}, { deep = true } } }');
      final inner = t.entries['inner'] as LuaTable;
      expect(inner.entries.length, 2);
      expect((inner.entries[1] as LuaTable).entries, isEmpty);
      expect((inner.entries[2] as LuaTable).entries['deep'], true);
    });

    test('rejects a table key that is not a string or a number', () {
      expect(parseError('X = { [true] = 1 }').code, LuaParseErrorCode.syntaxError);
    });

    test('rejects an unclosed table', () {
      expect(parseError('X = { a = 1,').code, LuaParseErrorCode.syntaxError);
    });

    test('rejects nesting deeper than the limit', () {
      expect(parseError('X = ${'{' * 200}${'}' * 200}').code, LuaParseErrorCode.nestingTooDeep);
    });
  });

  group('comments', () {
    test('skips line and block comments', () {
      final src = [
        '-- line comment',
        '--[[ block',
        'X = 999 ]]',
        '--[==[ level 2 with ]] inside ]==]',
        'X = { a = 1, -- after a value',
        '  --[[ inline ]] b = 2 }',
      ].join('\n');
      expect(entriesOf(parseLua(src)['X'] as LuaTable), [
        ['a', 1],
        ['b', 2],
      ]);
    });

    test('rejects an unterminated block comment', () {
      expect(parseError('--[[ never closed\nX = 1').code, LuaParseErrorCode.syntaxError);
    });
  });

  group('non-literal expressions', () {
    const cases = <(String, String, int, int)>[
      ('a function call', 'X = os.execute("calc")', 1, 5),
      ('a global used as a value', 'X = { a = SOME_GLOBAL }', 1, 11),
      ('a concatenation', 'X = "a" .. "b"', 1, 9),
      ('an arithmetic operator', 'X = 1 + 2', 1, 7),
      ('a subtraction without spaces', 'X = { 1 -2 }', 1, 9),
      ('a function literal', 'X = function() end', 1, 5),
      ('a parenthesized expression', 'X = (1)', 1, 5),
      ('a length operator', 'X = #"abc"', 1, 5),
      ('a not operator', 'X = not true', 1, 5),
      ('a call on a positional value', 'X = {\n  print"x" }', 2, 3),
      ('a call with a table argument', 'X = {\n  1, f{} }', 2, 6),
      ('an index after a value', 'X = "s"[1]', 1, 8),
      ('a method call statement', 'X = 1\nobj:method()', 2, 1),
    ];
    for (final (label, src, line, column) in cases) {
      test('rejects $label with its position', () {
        final err = parseError(src);
        expect(err.code, LuaParseErrorCode.nonLiteralExpression);
        expect(err.code.id, 'NonLiteralExpression');
        expect(err.line, line);
        expect(err.column, column);
        expect(err.message, contains('expression non littérale'));
        expect(err.message, endsWith('(ligne $line, colonne $column)'));
      });
    }
  });

  group('size limit', () {
    test('accepts a source of exactly the maximum size', () {
      final src = 'X = 1${' ' * (maxSourceBytes - 5)}';
      expect(parseLua(src)['X'], 1);
    });

    test('rejects a source above 512 KiB, measured in bytes', () {
      final src = 'X = "${'é' * (maxSourceBytes ~/ 2)}"';
      expect(maxSourceBytes, 512 * 1024);
      expect(parseError(src).code, LuaParseErrorCode.sourceTooLarge);
    });

    test('accepts bytes and decodes them as UTF-8', () {
      expect(parseLuaBytes(utf8.encode('X = "é"'))['X'], 'é');
    });

    test('rejects bytes above the limit before decoding them', () {
      expect(
        () => parseLuaBytes(List.filled(maxSourceBytes + 1, 0x20)),
        throwsA(
          isA<LuaParseError>().having((e) => e.code, 'code', LuaParseErrorCode.sourceTooLarge),
        ),
      );
    });
  });

  group('error positions', () {
    test('reports 1-based line and column, counting CRLF as one line break', () {
      final err = parseError('A = 1\r\nB = {\r\n  c = BAD }');
      expect(err.line, 3);
      expect(err.column, 7);
    });
  });
}
