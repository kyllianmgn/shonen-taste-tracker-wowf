import { LuaParseError, LuaTable, LuaValue, MAX_SOURCE_BYTES, parseLua } from './lua-parser';

function value(source: string): LuaValue | undefined {
  return parseLua(`X = ${source}`).get('X');
}

function table(source: string): LuaTable {
  const v = value(source);
  if (!(v instanceof LuaTable)) throw new Error('expected a table');
  return v;
}

function parseError(source: string): LuaParseError {
  try {
    parseLua(source);
  } catch (e) {
    if (e instanceof LuaParseError) return e;
    throw e;
  }
  throw new Error('expected a LuaParseError');
}

describe('parseLua', () => {
  describe('top-level assignments', () => {
    it('returns every assigned global by name', () => {
      const globals = parseLua('A = 1\nB = "two"; C = true');
      expect([...globals.entries()]).toEqual([
        ['A', 1],
        ['B', 'two'],
        ['C', true],
      ]);
    });

    it('treats an assignment to nil as unset', () => {
      expect(parseLua('ForeverTrackerDB = nil').has('ForeverTrackerDB')).toBe(false);
    });

    it('accepts an empty source', () => {
      expect(parseLua('  -- nothing\n').size).toBe(0);
    });

    it('rejects a statement that is not an assignment', () => {
      expect(parseError('print("hi")').code).toBe('NonLiteralExpression');
    });
  });

  describe('scalars', () => {
    it.each([
      ['42', 42],
      ['-7', -7],
      ['3.25', 3.25],
      ['-0.5', -0.5],
      ['.5', 0.5],
      ['1e3', 1000],
      ['2.5E-1', 0.25],
      ['0x1F', 31],
      ['0XfF', 255],
      ['-0x10', -16],
      ['true', true],
      ['false', false],
    ])('parses %s', (src, expected) => {
      expect(value(src)).toBe(expected);
    });

    it('parses nil as an absent value', () => {
      expect(value('nil')).toBeUndefined();
    });

    it('rejects a malformed number', () => {
      expect(parseError('X = 12abc').code).toBe('SyntaxError');
    });
  });

  describe('strings', () => {
    it.each([
      ['"plain"', 'plain'],
      ["'single'", 'single'],
      ['"a\\nb\\tc"', 'a\nb\tc'],
      ['"q\\"q"', 'q"q'],
      ["'it\\'s'", "it's"],
      ['"back\\\\slash"', 'back\\slash'],
      ['"\\124cff"', '|cff'],
      ['"P\\195\\169nombre"', 'Pénombre'],
      ['"\\0491"', '11'],
      ['"line\\\nbreak"', 'line\nbreak'],
      ['"é direct"', 'é direct'],
      ['[[long "string"]]', 'long "string"'],
      ['[[\nskips first newline]]', 'skips first newline'],
      ['[==[has ]] inside]==]', 'has ]] inside'],
      ['[=[a\r\nb]=]', 'a\nb'],
    ])('decodes %s', (src, expected) => {
      expect(value(src)).toBe(expected);
    });

    it('rejects an unknown escape', () => {
      expect(parseError('X = "\\q"').code).toBe('SyntaxError');
    });

    it('rejects a decimal escape above 255', () => {
      expect(parseError('X = "\\256"').code).toBe('SyntaxError');
    });

    it('rejects an unterminated string', () => {
      expect(parseError('X = "abc\nY = 1').code).toBe('SyntaxError');
    });

    it('rejects an unterminated long string', () => {
      expect(parseError('X = [==[abc]]').code).toBe('SyntaxError');
    });
  });

  describe('tables', () => {
    it('supports ["str"], [n], ident and positional fields in source order', () => {
      const t = table('{ ["a"] = 1, [10] = 2, b = 3, "pos1"; "pos2", }');
      expect([...t.entries]).toEqual([
        ['a', 1],
        [10, 2],
        ['b', 3],
        [1, 'pos1'],
        [2, 'pos2'],
      ]);
    });

    it('keeps the string key "1" distinct from the integer key 1', () => {
      const t = table('{ ["1"] = "s", [1] = "n" }');
      expect(t.entries.get('1')).toBe('s');
      expect(t.entries.get(1)).toBe('n');
    });

    it('lets a later duplicate key win', () => {
      expect(table('{ a = 1, a = 2 }').entries.get('a')).toBe(2);
    });

    it('drops nil fields but keeps positional numbering', () => {
      const t = table('{ "a", nil, "c", k = nil }');
      expect([...t.entries]).toEqual([
        [1, 'a'],
        [3, 'c'],
      ]);
    });

    it('accepts a positional long string', () => {
      expect([...table('{ [[x]] }').entries]).toEqual([[1, 'x']]);
    });

    it('parses nested and empty tables', () => {
      const t = table('{ inner = { {}, { deep = true } } }');
      const inner = t.entries.get('inner') as LuaTable;
      expect(inner.entries.size).toBe(2);
      expect((inner.entries.get(1) as LuaTable).entries.size).toBe(0);
      expect((inner.entries.get(2) as LuaTable).entries.get('deep')).toBe(true);
    });

    it('rejects a table key that is not a string or a number', () => {
      expect(parseError('X = { [true] = 1 }').code).toBe('SyntaxError');
    });

    it('rejects an unclosed table', () => {
      expect(parseError('X = { a = 1,').code).toBe('SyntaxError');
    });

    it('rejects nesting deeper than the limit', () => {
      expect(parseError(`X = ${'{'.repeat(200)}${'}'.repeat(200)}`).code).toBe('NestingTooDeep');
    });
  });

  describe('comments', () => {
    it('skips line and block comments', () => {
      const src = [
        '-- line comment',
        '--[[ block',
        'X = 999 ]]',
        '--[==[ level 2 with ]] inside ]==]',
        'X = { a = 1, -- after a value',
        '  --[[ inline ]] b = 2 }',
      ].join('\n');
      expect([...(parseLua(src).get('X') as LuaTable).entries]).toEqual([
        ['a', 1],
        ['b', 2],
      ]);
    });

    it('rejects an unterminated block comment', () => {
      expect(parseError('--[[ never closed\nX = 1').code).toBe('SyntaxError');
    });
  });

  describe('non-literal expressions', () => {
    it.each([
      ['a function call', 'X = os.execute("calc")', 1, 5],
      ['a global used as a value', 'X = { a = SOME_GLOBAL }', 1, 11],
      ['a concatenation', 'X = "a" .. "b"', 1, 9],
      ['an arithmetic operator', 'X = 1 + 2', 1, 7],
      ['a subtraction without spaces', 'X = { 1 -2 }', 1, 9],
      ['a function literal', 'X = function() end', 1, 5],
      ['a parenthesized expression', 'X = (1)', 1, 5],
      ['a length operator', 'X = #"abc"', 1, 5],
      ['a not operator', 'X = not true', 1, 5],
      ['a call on a positional value', 'X = {\n  print"x" }', 2, 3],
      ['a call with a table argument', 'X = {\n  1, f{} }', 2, 6],
      ['an index after a value', 'X = "s"[1]', 1, 8],
      ['a method call statement', 'X = 1\nobj:method()', 2, 1],
    ])('rejects %s with its position', (_label, src, line, column) => {
      const err = parseError(src);
      expect(err.code).toBe('NonLiteralExpression');
      expect(err.line).toBe(line);
      expect(err.column).toBe(column);
      expect(err.message).toContain('expression non littérale');
    });
  });

  describe('size limit', () => {
    it('accepts a source of exactly the maximum size', () => {
      const src = 'X = 1' + ' '.repeat(MAX_SOURCE_BYTES - 5);
      expect(parseLua(src).get('X')).toBe(1);
    });

    it('rejects a source above 512 KiB, measured in bytes', () => {
      const src = 'X = "' + 'é'.repeat(MAX_SOURCE_BYTES / 2) + '"';
      expect(MAX_SOURCE_BYTES).toBe(512 * 1024);
      expect(parseError(src).code).toBe('SourceTooLarge');
    });

    it('accepts a Buffer and decodes it as UTF-8', () => {
      expect(parseLua(Buffer.from('X = "é"', 'utf8')).get('X')).toBe('é');
    });
  });

  describe('error positions', () => {
    it('reports 1-based line and column, counting CRLF as one line break', () => {
      const err = parseError('A = 1\r\nB = {\r\n  c = BAD }');
      expect(err.line).toBe(3);
      expect(err.column).toBe(7);
    });
  });
});
