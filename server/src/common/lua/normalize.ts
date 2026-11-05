import { LuaTable, LuaValue } from './lua-parser';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** The subset of JSON Schema that guides normalization. */
export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  [keyword: string]: unknown;
}

/**
 * Converts a neutral Lua value into JSON, using the schema to decide what a table is
 * (docs/03 « Contrat partagé », piège du parseur):
 * - schema says array: a sequence (keys 1..n, including the empty table) becomes an array;
 * - schema says object: the table becomes an object (integer keys are stringified);
 * - no guidance: a non-empty sequence becomes an array, anything else an object.
 * A table that does not fit its schema keeps its object shape so that validation rejects it.
 * `$ref` is resolved against `root` (local JSON pointers only).
 */
export function normalizeLuaValue(value: LuaValue, schema: JsonSchema | undefined, root: JsonSchema): JsonValue {
  if (!(value instanceof LuaTable)) return value;
  const resolved = resolve(schema, root);
  const type = schemaType(resolved);

  if (type === 'array' || (type === undefined && value.entries.size > 0)) {
    const sequence = asSequence(value);
    if (sequence) return sequence.map((item) => normalizeLuaValue(item, resolved?.items, root));
  }

  const out: { [key: string]: JsonValue } = {};
  for (const [rawKey, item] of value.entries) {
    const key = String(rawKey);
    const propSchema = propertySchema(resolved, key);
    // defineProperty keeps keys such as "__proto__" as plain own data.
    Object.defineProperty(out, key, {
      value: normalizeLuaValue(item, propSchema, root),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

function schemaType(schema: JsonSchema | undefined): string | undefined {
  if (!schema) return undefined;
  if (typeof schema.type === 'string') return schema.type;
  if (schema.properties || schema.additionalProperties !== undefined) return 'object';
  if (schema.items) return 'array';
  return undefined;
}

function propertySchema(schema: JsonSchema | undefined, key: string): JsonSchema | undefined {
  if (!schema) return undefined;
  if (schema.properties && Object.prototype.hasOwnProperty.call(schema.properties, key)) {
    return schema.properties[key];
  }
  return typeof schema.additionalProperties === 'object' ? schema.additionalProperties : undefined;
}

function asSequence(table: LuaTable): LuaValue[] | undefined {
  const items: LuaValue[] = [];
  for (let i = 1; i <= table.entries.size; i++) {
    const item = table.entries.get(i);
    if (item === undefined) return undefined;
    items.push(item);
  }
  return items;
}

function resolve(schema: JsonSchema | undefined, root: JsonSchema): JsonSchema | undefined {
  let current = schema;
  for (let hops = 0; current?.$ref !== undefined; hops++) {
    const ref = current.$ref;
    if (hops > 32 || !ref.startsWith('#/')) throw new Error(`unsupported $ref: ${ref}`);
    let target: unknown = root;
    for (const raw of ref.slice(2).split('/')) {
      const segment = raw.replace(/~1/g, '/').replace(/~0/g, '~');
      target =
        target !== null && typeof target === 'object' && Object.prototype.hasOwnProperty.call(target, segment)
          ? (target as Record<string, unknown>)[segment]
          : undefined;
    }
    if (target === null || typeof target !== 'object') throw new Error(`unresolvable $ref: ${ref}`);
    current = target as JsonSchema;
  }
  return current;
}
