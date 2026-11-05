import { LuaTable } from './lua-parser';
import { JsonSchema, normalizeLuaValue } from './normalize';

function lua(...entries: [string | number, LuaTable | string | number | boolean][]): LuaTable {
  const t = new LuaTable();
  for (const [k, v] of entries) t.entries.set(k, v);
  return t;
}

const root: JsonSchema = {
  type: 'object',
  properties: {
    list: { type: 'array', items: { $ref: '#/$defs/item' } },
    data: { type: 'object' },
  },
  $defs: {
    item: { type: 'object', properties: { tags: { type: 'array' }, meta: { type: 'object' } } },
  },
};

describe('normalizeLuaValue', () => {
  it('passes scalars through', () => {
    expect(normalizeLuaValue('s', undefined, root)).toBe('s');
    expect(normalizeLuaValue(1.5, { type: 'number' }, root)).toBe(1.5);
    expect(normalizeLuaValue(false, undefined, root)).toBe(false);
  });

  it('turns an empty table into [] or {} as the schema says', () => {
    const value = lua(['list', lua()], ['data', lua()]);
    expect(normalizeLuaValue(value, root, root)).toEqual({ list: [], data: {} });
  });

  it('follows $ref into $defs and through array items', () => {
    const value = lua(['list', lua([1, lua(['tags', lua()], ['meta', lua()])])]);
    expect(normalizeLuaValue(value, root, root)).toEqual({ list: [{ tags: [], meta: {} }] });
  });

  it('turns sequential tables into arrays where the schema expects one', () => {
    const value = lua(['list', lua([1, lua()], [2, lua()])]);
    expect(normalizeLuaValue(value, root, root)).toEqual({ list: [{}, {}] });
  });

  it('keeps a non-sequential table as an object even where an array is expected', () => {
    const value = lua(['list', lua([1, lua()], [3, lua()])]);
    expect(normalizeLuaValue(value, root, root)).toEqual({ list: { '1': {}, '3': {} } });
  });

  it('stringifies integer keys of objects', () => {
    expect(normalizeLuaValue(lua([1, 'a'], [2, 'b']), { type: 'object' }, root)).toEqual({
      '1': 'a',
      '2': 'b',
    });
  });

  it('without schema guidance: non-empty sequences become arrays, everything else objects', () => {
    expect(normalizeLuaValue(lua([1, 'a'], [2, 'b']), undefined, root)).toEqual(['a', 'b']);
    expect(normalizeLuaValue(lua(), undefined, root)).toEqual({});
    expect(normalizeLuaValue(lua(['k', lua([1, 1])]), undefined, root)).toEqual({ k: [1] });
  });

  it('uses an additionalProperties schema for unknown keys', () => {
    const schema: JsonSchema = { type: 'object', additionalProperties: { type: 'array' } };
    expect(normalizeLuaValue(lua(['any', lua()]), schema, root)).toEqual({ any: [] });
  });

  it('stores "__proto__" as an own key without touching the prototype', () => {
    const out = normalizeLuaValue(lua(['__proto__', lua(['polluted', true])]), undefined, root) as Record<
      string,
      unknown
    >;
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(Object.keys(out)).toEqual(['__proto__']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects a $ref outside the root document', () => {
    expect(() => normalizeLuaValue(lua(), { $ref: 'other.json#/x' }, root)).toThrow(/\$ref/);
  });
});
