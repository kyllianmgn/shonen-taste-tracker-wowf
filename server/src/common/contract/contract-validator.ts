import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

/**
 * Validation of exchanged payloads against the shared JSON Schemas (docs/03 « Contrat partagé »).
 * Schemas are read from the repository's `contract/schemas/` at startup and never copied into
 * `server/`: the contract directory is the single source of truth for server and companion.
 */

/** Every file of `contract/schemas/`, without the `.json` extension. */
export const SCHEMA_NAMES = [
  'error',
  'heartbeat.request',
  'heartbeat.response',
  'pair.request',
  'pair.response',
  'share-code.payload',
  'sync.request',
  'sync.response',
] as const;

export type SchemaName = (typeof SCHEMA_NAMES)[number];

export interface ContractError {
  /** JSON Pointer to the offending value (`/` for the root). */
  path: string;
  message: string;
}

export type ValidationResult = { ok: true } | { ok: false; errors: ContractError[] };

/** Walks up from `start` to the first directory holding `contract/schemas` (src/, dist/ and tests all work). */
export function findContractDir(start: string = __dirname): string {
  let dir = start;
  for (;;) {
    const candidate = join(dir, 'contract');
    if (existsSync(join(candidate, 'schemas'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`No contract/schemas directory found above ${start}`);
    dir = parent;
  }
}

export class ContractValidator {
  private readonly validators = new Map<string, ValidateFunction>();

  constructor(contractDir: string = findContractDir()) {
    const schemasDir = join(contractDir, 'schemas');
    if (!existsSync(schemasDir)) throw new Error(`Contract schemas directory not found: ${schemasDir}`);

    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);

    for (const file of readdirSync(schemasDir).filter((f) => f.endsWith('.json'))) {
      const name = file.slice(0, -'.json'.length);
      const schema = JSON.parse(readFileSync(join(schemasDir, file), 'utf8')) as object;
      this.validators.set(name, ajv.compile(schema));
    }

    const missing = SCHEMA_NAMES.filter((name) => !this.validators.has(name));
    if (missing.length > 0) throw new Error(`Missing contract schemas: ${missing.join(', ')}`);
  }

  schemaNames(): string[] {
    return [...this.validators.keys()];
  }

  validate(schemaName: SchemaName, payload: unknown): ValidationResult {
    const validator = this.validators.get(schemaName);
    if (!validator) throw new Error(`Unknown contract schema "${schemaName}"`);
    if (validator(payload)) return { ok: true };
    return { ok: false, errors: (validator.errors ?? []).map(toContractError) };
  }
}

function toContractError(error: ErrorObject): ContractError {
  const at = (property: string) => `${error.instancePath}/${escapePointer(property)}`;
  switch (error.keyword) {
    case 'additionalProperties':
      return { path: at((error.params as { additionalProperty: string }).additionalProperty), message: 'unknown field' };
    case 'required':
      return { path: at((error.params as { missingProperty: string }).missingProperty), message: 'is required' };
    case 'enum': {
      const allowed = (error.params as { allowedValues: unknown[] }).allowedValues;
      return { path: error.instancePath || '/', message: `must be one of: ${allowed.map(String).join(', ')}` };
    }
    default:
      return { path: error.instancePath || '/', message: error.message ?? `failed "${error.keyword}"` };
  }
}

function escapePointer(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}
