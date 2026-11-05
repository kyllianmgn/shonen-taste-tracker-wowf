/**
 * Literal-only Lua parser for SavedVariables files (docs/01 « Addon : format des SavedVariables »).
 *
 * The input is untrusted: it is read as data, never executed. Accepted grammar:
 *   chunk      := { Name '=' value [';'] }
 *   value      := string | number | '-' number | true | false | nil | table
 *   table      := '{' [ field { (',' | ';') field } [',' | ';'] ] '}'
 *   field      := '[' (string | number) ']' '=' value | Name '=' value | value
 * Strings: "…", '…', [[…]], [==[…]==] with \n \t \r \a \b \f \v \" \' \\ \<newline> \ddd escapes.
 * Numbers: integers, decimals, exponents, hexadecimal. Comments: -- and --[[ ]] / --[==[ ]==].
 * Anything else (calls, operators, identifiers used as values…) is a NonLiteralExpression.
 */

export const MAX_SOURCE_BYTES = 512 * 1024;
export const MAX_NESTING_DEPTH = 100;

export type LuaKey = string | number;
export type LuaValue = string | number | boolean | LuaTable;

/** Neutral Lua table: keys keep source order; `nil` values are never stored. */
export class LuaTable {
  readonly entries = new Map<LuaKey, LuaValue>();
}

export type LuaParseErrorCode = 'NonLiteralExpression' | 'SyntaxError' | 'SourceTooLarge' | 'NestingTooDeep';

export class LuaParseError extends Error {
  constructor(
    readonly code: LuaParseErrorCode,
    detail: string,
    readonly line?: number,
    readonly column?: number,
  ) {
    super(line === undefined ? detail : `${detail} (ligne ${line}, colonne ${column})`);
    this.name = 'LuaParseError';
  }
}

/**
 * Parses a SavedVariables source and returns the assigned globals, in source order.
 * A global assigned `nil` is absent from the result.
 */
export function parseLua(source: string | Buffer): Map<string, LuaValue> {
  const size = typeof source === 'string' ? Buffer.byteLength(source, 'utf8') : source.length;
  if (size > MAX_SOURCE_BYTES) {
    throw new LuaParseError('SourceTooLarge', `fichier trop volumineux (maximum ${MAX_SOURCE_BYTES / 1024} Ko)`);
  }
  const text = typeof source === 'string' ? source : source.toString('utf8');
  return new Parser(new Lexer(text)).parseChunk();
}

type Token =
  | { kind: 'name'; value: string; start: number }
  | { kind: 'string'; value: string; start: number }
  | { kind: 'number'; value: number; start: number }
  | { kind: 'punct'; value: string; start: number }
  | { kind: 'eof'; start: number };

const KEYWORDS = new Set([
  'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto', 'if', 'in',
  'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while',
]);

/** Punctuation that can legitimately follow a value; anything else continues an expression. */
const STRUCTURAL = new Set(['}', ']', '=', ',', ';']);

const MULTI_CHAR_PUNCT = ['...', '..', '==', '~=', '<=', '>=', '::', '//', '<<', '>>'];

const SIMPLE_ESCAPES: Record<string, string> = {
  n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', '"': '"', "'": "'", '\\': '\\',
};

const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';
const isHexDigit = (c: string | undefined) => c !== undefined && /^[0-9a-fA-F]$/.test(c);
const isNameStart = (c: string | undefined) => c !== undefined && /^[A-Za-z_]$/.test(c);
const isNameChar = (c: string | undefined) => c !== undefined && /^[A-Za-z0-9_]$/.test(c);

class Lexer {
  private pos = 0;
  private readonly lineStarts: number[] = [0];

  constructor(private readonly src: string) {
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (c === '\r' && src[i + 1] === '\n') i++;
      if (c === '\n' || c === '\r') this.lineStarts.push(i + 1);
    }
  }

  error(code: LuaParseErrorCode, detail: string, offset: number): LuaParseError {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return new LuaParseError(code, detail, lo + 1, offset - this.lineStarts[lo] + 1);
  }

  next(): Token {
    this.skipTrivia();
    const start = this.pos;
    const c = this.src[start];
    if (c === undefined) return { kind: 'eof', start };

    if (c === '"' || c === "'") return { kind: 'string', value: this.readQuoted(c), start };
    if (c === '[') {
      const level = this.longBracketLevel(start);
      if (level >= 0) return { kind: 'string', value: this.readLongBracket(level, 'chaîne'), start };
    }
    if (isDigit(c) || (c === '.' && isDigit(this.src[start + 1]))) {
      return { kind: 'number', value: this.readNumber(), start };
    }
    if (isNameStart(c)) {
      while (isNameChar(this.src[this.pos])) this.pos++;
      return { kind: 'name', value: this.src.slice(start, this.pos), start };
    }
    const multi = MULTI_CHAR_PUNCT.find((p) => this.src.startsWith(p, start));
    this.pos += multi ? multi.length : 1;
    return { kind: 'punct', value: multi ?? c, start };
  }

  private skipTrivia(): void {
    for (;;) {
      const c = this.src[this.pos];
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\v' || c === '\f') {
        this.pos++;
      } else if (c === '-' && this.src[this.pos + 1] === '-') {
        this.pos += 2;
        const level = this.longBracketLevel(this.pos);
        if (level >= 0) {
          this.readLongBracket(level, 'commentaire');
        } else {
          while (this.pos < this.src.length && this.src[this.pos] !== '\n' && this.src[this.pos] !== '\r') {
            this.pos++;
          }
        }
      } else {
        return;
      }
    }
  }

  /** Level of a long bracket opening `[`, `[=`… `[` at `at`, or -1 if there is none. */
  private longBracketLevel(at: number): number {
    if (this.src[at] !== '[') return -1;
    let i = at + 1;
    while (this.src[i] === '=') i++;
    return this.src[i] === '[' ? i - at - 1 : -1;
  }

  private readLongBracket(level: number, what: string): string {
    const opener = this.pos;
    let i = opener + level + 2;
    if ((this.src[i] === '\r' && this.src[i + 1] === '\n') || (this.src[i] === '\n' && this.src[i + 1] === '\r')) {
      i += 2;
    } else if (this.src[i] === '\n' || this.src[i] === '\r') {
      i += 1;
    }
    const closer = `]${'='.repeat(level)}]`;
    const end = this.src.indexOf(closer, i);
    if (end < 0) throw this.error('SyntaxError', `${what} longue non terminée`, opener);
    this.pos = end + closer.length;
    return this.src.slice(i, end).replace(/\r\n|\n\r|\r/g, '\n');
  }

  private readQuoted(quote: string): string {
    const opener = this.pos;
    let i = opener + 1;
    let runStart = i;
    const pieces: Buffer[] = [];
    const flush = (to: number) => {
      if (to > runStart) pieces.push(Buffer.from(this.src.slice(runStart, to), 'utf8'));
    };
    for (;;) {
      const c = this.src[i];
      if (c === undefined || c === '\n' || c === '\r') {
        throw this.error('SyntaxError', 'chaîne non terminée', opener);
      }
      if (c === quote) break;
      if (c !== '\\') {
        i++;
        continue;
      }
      flush(i);
      const e = this.src[i + 1];
      if (e !== undefined && e in SIMPLE_ESCAPES) {
        pieces.push(Buffer.from(SIMPLE_ESCAPES[e], 'utf8'));
        i += 2;
      } else if (e === '\n' || e === '\r') {
        pieces.push(Buffer.from('\n'));
        const pair = this.src[i + 2];
        i += (pair === '\n' || pair === '\r') && pair !== e ? 3 : 2;
      } else if (isDigit(e)) {
        let j = i + 1;
        while (j < i + 4 && isDigit(this.src[j])) j++;
        const byte = Number(this.src.slice(i + 1, j));
        if (byte > 255) throw this.error('SyntaxError', 'séquence d’échappement trop grande', i);
        pieces.push(Buffer.from([byte]));
        i = j;
      } else {
        throw this.error('SyntaxError', 'séquence d’échappement invalide', i);
      }
      runStart = i;
    }
    this.pos = i + 1;
    if (pieces.length === 0) return this.src.slice(opener + 1, i);
    flush(i);
    return Buffer.concat(pieces).toString('utf8');
  }

  private readNumber(): number {
    const start = this.pos;
    const src = this.src;
    let value: number;
    if (src[start] === '0' && (src[start + 1] === 'x' || src[start + 1] === 'X')) {
      let i = start + 2;
      while (isHexDigit(src[i])) i++;
      if (i === start + 2) throw this.error('SyntaxError', 'nombre mal formé', start);
      value = parseInt(src.slice(start + 2, i), 16);
      this.pos = i;
    } else {
      let i = start;
      while (isDigit(src[i])) i++;
      if (src[i] === '.') {
        i++;
        while (isDigit(src[i])) i++;
      }
      if (src[i] === 'e' || src[i] === 'E') {
        i++;
        if (src[i] === '+' || src[i] === '-') i++;
        if (!isDigit(src[i])) throw this.error('SyntaxError', 'nombre mal formé', start);
        while (isDigit(src[i])) i++;
      }
      value = Number(src.slice(start, i));
      this.pos = i;
    }
    if (isNameChar(src[this.pos]) || src[this.pos] === '.') {
      throw this.error('SyntaxError', 'nombre mal formé', start);
    }
    return value;
  }
}

class Parser {
  private tok: Token;
  private lookahead: Token | undefined;

  constructor(private readonly lexer: Lexer) {
    this.tok = lexer.next();
  }

  parseChunk(): Map<string, LuaValue> {
    const globals = new Map<string, LuaValue>();
    while (this.tok.kind !== 'eof') {
      if (this.isPunct(this.tok, ';')) {
        this.advance();
        continue;
      }
      const target = this.tok;
      if (target.kind !== 'name' || KEYWORDS.has(target.value) || !this.isPunct(this.peek(), '=')) {
        throw this.nonLiteral(target);
      }
      this.advance();
      this.advance();
      const value = this.parseValue(0);
      const after = this.current();
      if (after.kind !== 'eof' && after.kind !== 'name' && !this.isPunct(after, ';')) {
        throw this.unexpectedAfterValue(after);
      }
      if (value === undefined) globals.delete(target.value);
      else globals.set(target.value, value);
    }
    return globals;
  }

  private parseValue(depth: number): LuaValue | undefined {
    const tok = this.tok;
    switch (tok.kind) {
      case 'string':
      case 'number':
        this.advance();
        return tok.value;
      case 'name':
        if (tok.value === 'true' || tok.value === 'false' || tok.value === 'nil') {
          this.advance();
          return tok.value === 'nil' ? undefined : tok.value === 'true';
        }
        throw this.nonLiteral(tok);
      case 'eof':
        throw this.lexer.error('SyntaxError', 'valeur attendue', tok.start);
      case 'punct': {
        if (tok.value === '{') return this.parseTable(depth + 1);
        const operand = this.peek();
        if (tok.value === '-' && operand.kind === 'number') {
          this.advance();
          this.advance();
          return -operand.value;
        }
        if (STRUCTURAL.has(tok.value)) throw this.lexer.error('SyntaxError', 'valeur attendue', tok.start);
        throw this.nonLiteral(tok);
      }
    }
  }

  private parseTable(depth: number): LuaTable {
    if (depth > MAX_NESTING_DEPTH) {
      throw this.lexer.error('NestingTooDeep', `tables imbriquées trop profondément (maximum ${MAX_NESTING_DEPTH})`, this.tok.start);
    }
    const opener = this.tok;
    this.advance();
    const table = new LuaTable();
    let index = 1;
    for (;;) {
      const tok = this.current();
      if (this.isPunct(tok, '}')) {
        this.advance();
        return table;
      }
      if (tok.kind === 'eof') throw this.lexer.error('SyntaxError', 'table non fermée', opener.start);

      let key: LuaKey;
      if (this.isPunct(tok, '[')) {
        this.advance();
        const keyTok = this.tok;
        const k = this.parseValue(depth);
        if (typeof k !== 'string' && typeof k !== 'number') {
          throw this.lexer.error('SyntaxError', 'clé de table non prise en charge', keyTok.start);
        }
        if (!this.isPunct(this.tok, ']')) throw this.unexpectedAfterValue(this.tok);
        this.advance();
        this.expectEquals();
        key = k;
      } else if (tok.kind === 'name' && !KEYWORDS.has(tok.value) && this.isPunct(this.peek(), '=')) {
        this.advance();
        this.advance();
        key = tok.value;
      } else {
        key = index++;
      }

      const value = this.parseValue(depth);
      if (value === undefined) table.entries.delete(key);
      else table.entries.set(key, value);

      const sep = this.current();
      if (this.isPunct(sep, ',') || this.isPunct(sep, ';')) this.advance();
      else if (sep.kind === 'eof') throw this.lexer.error('SyntaxError', 'table non fermée', opener.start);
      else if (!this.isPunct(sep, '}')) throw this.unexpectedAfterValue(sep);
    }
  }

  private expectEquals(): void {
    if (!this.isPunct(this.tok, '=')) throw this.lexer.error('SyntaxError', '« = » attendu', this.tok.start);
    this.advance();
  }

  private unexpectedAfterValue(tok: Token): LuaParseError {
    if (tok.kind === 'eof') return this.lexer.error('SyntaxError', 'fin de fichier inattendue', tok.start);
    if (tok.kind === 'string' || (tok.kind === 'punct' && !STRUCTURAL.has(tok.value))) {
      return this.nonLiteral(tok);
    }
    return this.lexer.error('SyntaxError', 'symbole inattendu', tok.start);
  }

  private nonLiteral(tok: Token): LuaParseError {
    return this.lexer.error('NonLiteralExpression', 'expression non littérale', tok.start);
  }

  private isPunct(tok: Token, value: string): boolean {
    return tok.kind === 'punct' && tok.value === value;
  }

  private current(): Token {
    return this.tok;
  }

  private peek(): Token {
    this.lookahead ??= this.lexer.next();
    return this.lookahead;
  }

  private advance(): void {
    this.tok = this.lookahead ?? this.lexer.next();
    this.lookahead = undefined;
  }
}
