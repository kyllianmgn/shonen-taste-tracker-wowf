/// Literal-only Lua parser for SavedVariables files (docs/01 « Addon : format des SavedVariables »).
///
/// Dart port of `server/src/common/lua/lua-parser.ts` (S-04): same grammar, same errors, same
/// positions. The input is untrusted: it is read as data, never executed. Accepted grammar:
///   chunk      := { Name '=' value [';'] }
///   value      := string | number | '-' number | true | false | nil | table
///   table      := '{' [ field { (',' | ';') field } [',' | ';'] ] '}'
///   field      := '[' (string | number) ']' '=' value | Name '=' value | value
/// Strings: "…", '…', [[…]], [==[…]==] with \n \t \r \a \b \f \v \" \' \\ \<newline> \ddd escapes.
/// Numbers: integers, decimals, exponents, hexadecimal. Comments: -- and --[[ ]] / --[==[ ]==].
/// Anything else (calls, operators, identifiers used as values…) is a NonLiteralExpression.
library;

import 'dart:convert';
import 'dart:typed_data';

const int maxSourceBytes = 512 * 1024;
const int maxNestingDepth = 100;

/// Neutral Lua table: keys (String or num) keep source order; `nil` values are never stored.
///
/// Values are String, int, double, bool or LuaTable. Integer literals give an int, literals
/// with a decimal point or an exponent give a double.
class LuaTable {
  final Map<Object, Object> entries = {};
}

enum LuaParseErrorCode {
  nonLiteralExpression('NonLiteralExpression'),
  syntaxError('SyntaxError'),
  sourceTooLarge('SourceTooLarge'),
  nestingTooDeep('NestingTooDeep');

  const LuaParseErrorCode(this.id);

  /// Same identifier as the server's `LuaParseErrorCode`.
  final String id;
}

class LuaParseError implements Exception {
  LuaParseError(this.code, String detail, [this.line, this.column])
    : message = line == null ? detail : '$detail (ligne $line, colonne $column)';

  final LuaParseErrorCode code;

  /// French, user-facing; never contains file content.
  final String message;
  final int? line;
  final int? column;

  @override
  String toString() => 'LuaParseError(${code.id}): $message';
}

/// Parses a SavedVariables source and returns the assigned globals, in source order.
/// A global assigned `nil` is absent from the result.
Map<String, Object> parseLua(String source) {
  _checkSize(utf8.encode(source).length);
  return _Parser(_Lexer(source)).parseChunk();
}

/// Same as [parseLua] for raw file bytes, decoded as UTF-8 (invalid sequences become U+FFFD).
Map<String, Object> parseLuaBytes(List<int> bytes) {
  _checkSize(bytes.length);
  return _Parser(_Lexer(utf8.decode(bytes, allowMalformed: true))).parseChunk();
}

void _checkSize(int bytes) {
  if (bytes > maxSourceBytes) {
    throw LuaParseError(
      LuaParseErrorCode.sourceTooLarge,
      'fichier trop volumineux (maximum ${maxSourceBytes ~/ 1024} Ko)',
    );
  }
}

enum _Kind { name, string, number, punct, eof }

class _Token {
  const _Token(this.kind, this.value, this.start);

  final _Kind kind;

  /// String for name/string/punct, num for number, null for eof.
  final Object? value;
  final int start;
}

const Set<String> _keywords = {
  'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto', 'if', 'in', //
  'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while',
};

/// Punctuation that can legitimately follow a value; anything else continues an expression.
const Set<String> _structural = {'}', ']', '=', ',', ';'};

const List<String> _multiCharPunct = ['...', '..', '==', '~=', '<=', '>=', '::', '//', '<<', '>>'];

const Map<int, int> _simpleEscapes = {
  0x6E: 0x0A, // n
  0x74: 0x09, // t
  0x72: 0x0D, // r
  0x61: 0x07, // a
  0x62: 0x08, // b
  0x66: 0x0C, // f
  0x76: 0x0B, // v
  0x22: 0x22, // "
  0x27: 0x27, // '
  0x5C: 0x5C, // backslash
};

const int _eof = -1;
const int _lf = 0x0A;
const int _cr = 0x0D;
const int _quote = 0x22;
const int _apostrophe = 0x27;
const int _backslash = 0x5C;
const int _openBracket = 0x5B;
const int _equals = 0x3D;
const int _minus = 0x2D;
const int _dot = 0x2E;

bool _isDigit(int c) => c >= 0x30 && c <= 0x39;
bool _isHexDigit(int c) => _isDigit(c) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
bool _isNameStart(int c) => (c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A) || c == 0x5F;
bool _isNameChar(int c) => _isNameStart(c) || _isDigit(c);

class _Lexer {
  _Lexer(this._src) {
    for (var i = 0; i < _src.length; i++) {
      final c = _src.codeUnitAt(i);
      if (c == _cr && _at(i + 1) == _lf) i++;
      if (c == _lf || c == _cr) _lineStarts.add(i + 1);
    }
  }

  final String _src;
  final List<int> _lineStarts = [0];
  int _pos = 0;

  int _at(int i) => i < _src.length ? _src.codeUnitAt(i) : _eof;

  LuaParseError error(LuaParseErrorCode code, String detail, int offset) {
    var lo = 0;
    var hi = _lineStarts.length - 1;
    while (lo < hi) {
      final mid = (lo + hi + 1) >> 1;
      if (_lineStarts[mid] <= offset) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return LuaParseError(code, detail, lo + 1, offset - _lineStarts[lo] + 1);
  }

  _Token next() {
    _skipTrivia();
    final start = _pos;
    final c = _at(start);
    if (c == _eof) return _Token(_Kind.eof, null, start);

    if (c == _quote || c == _apostrophe) return _Token(_Kind.string, _readQuoted(c), start);
    if (c == _openBracket) {
      final level = _longBracketLevel(start);
      if (level >= 0) return _Token(_Kind.string, _readLongBracket(level, 'chaîne'), start);
    }
    if (_isDigit(c) || (c == _dot && _isDigit(_at(start + 1)))) {
      return _Token(_Kind.number, _readNumber(), start);
    }
    if (_isNameStart(c)) {
      while (_isNameChar(_at(_pos))) {
        _pos++;
      }
      return _Token(_Kind.name, _src.substring(start, _pos), start);
    }
    for (final p in _multiCharPunct) {
      if (_src.startsWith(p, start)) {
        _pos += p.length;
        return _Token(_Kind.punct, p, start);
      }
    }
    _pos++;
    return _Token(_Kind.punct, String.fromCharCode(c), start);
  }

  void _skipTrivia() {
    while (true) {
      final c = _at(_pos);
      if (c == 0x20 || c == 0x09 || c == _cr || c == _lf || c == 0x0B || c == 0x0C) {
        _pos++;
      } else if (c == _minus && _at(_pos + 1) == _minus) {
        _pos += 2;
        final level = _longBracketLevel(_pos);
        if (level >= 0) {
          _readLongBracket(level, 'commentaire');
        } else {
          while (_pos < _src.length && _at(_pos) != _lf && _at(_pos) != _cr) {
            _pos++;
          }
        }
      } else {
        return;
      }
    }
  }

  /// Level of a long bracket opening `[`, `[=`… `[` at [at], or -1 if there is none.
  int _longBracketLevel(int at) {
    if (_at(at) != _openBracket) return -1;
    var i = at + 1;
    while (_at(i) == _equals) {
      i++;
    }
    return _at(i) == _openBracket ? i - at - 1 : -1;
  }

  String _readLongBracket(int level, String what) {
    final opener = _pos;
    var i = opener + level + 2;
    if ((_at(i) == _cr && _at(i + 1) == _lf) || (_at(i) == _lf && _at(i + 1) == _cr)) {
      i += 2;
    } else if (_at(i) == _lf || _at(i) == _cr) {
      i += 1;
    }
    final closer = ']${'=' * level}]';
    final end = _src.indexOf(closer, i);
    if (end < 0) throw error(LuaParseErrorCode.syntaxError, '$what longue non terminée', opener);
    _pos = end + closer.length;
    return _src.substring(i, end).replaceAll(RegExp('\r\n|\n\r|\r'), '\n');
  }

  String _readQuoted(int quote) {
    final opener = _pos;
    var i = opener + 1;
    var runStart = i;
    BytesBuilder? bytes;
    void flush(int to) {
      if (to > runStart) bytes!.add(utf8.encode(_src.substring(runStart, to)));
    }

    while (true) {
      final c = _at(i);
      if (c == _eof || c == _lf || c == _cr) {
        throw error(LuaParseErrorCode.syntaxError, 'chaîne non terminée', opener);
      }
      if (c == quote) break;
      if (c != _backslash) {
        i++;
        continue;
      }
      bytes ??= BytesBuilder(copy: false);
      flush(i);
      final e = _at(i + 1);
      final simple = _simpleEscapes[e];
      if (simple != null) {
        bytes.addByte(simple);
        i += 2;
      } else if (e == _lf || e == _cr) {
        bytes.addByte(_lf);
        final pair = _at(i + 2);
        i += (pair == _lf || pair == _cr) && pair != e ? 3 : 2;
      } else if (_isDigit(e)) {
        var j = i + 1;
        while (j < i + 4 && _isDigit(_at(j))) {
          j++;
        }
        final byte = int.parse(_src.substring(i + 1, j));
        if (byte > 255) {
          throw error(LuaParseErrorCode.syntaxError, 'séquence d’échappement trop grande', i);
        }
        bytes.addByte(byte);
        i = j;
      } else {
        throw error(LuaParseErrorCode.syntaxError, 'séquence d’échappement invalide', i);
      }
      runStart = i;
    }
    _pos = i + 1;
    if (bytes == null) return _src.substring(opener + 1, i);
    flush(i);
    return utf8.decode(bytes.takeBytes(), allowMalformed: true);
  }

  num _readNumber() {
    final start = _pos;
    num value;
    if (_at(start) == 0x30 && (_at(start + 1) == 0x78 || _at(start + 1) == 0x58)) {
      var i = start + 2;
      while (_isHexDigit(_at(i))) {
        i++;
      }
      if (i == start + 2) throw error(LuaParseErrorCode.syntaxError, 'nombre mal formé', start);
      final digits = _src.substring(start + 2, i);
      value = int.tryParse(digits, radix: 16) ?? BigInt.parse(digits, radix: 16).toDouble();
      _pos = i;
    } else {
      var i = start;
      var integral = true;
      while (_isDigit(_at(i))) {
        i++;
      }
      if (_at(i) == _dot) {
        integral = false;
        i++;
        while (_isDigit(_at(i))) {
          i++;
        }
      }
      if (_at(i) == 0x65 || _at(i) == 0x45) {
        integral = false;
        i++;
        if (_at(i) == 0x2B || _at(i) == _minus) i++;
        if (!_isDigit(_at(i))) {
          throw error(LuaParseErrorCode.syntaxError, 'nombre mal formé', start);
        }
        while (_isDigit(_at(i))) {
          i++;
        }
      }
      var text = _src.substring(start, i);
      if (text.endsWith('.')) text = '${text}0';
      if (text.startsWith('.')) text = '0$text';
      value = (integral ? int.tryParse(text) : null) ?? double.parse(text);
      _pos = i;
    }
    if (_isNameChar(_at(_pos)) || _at(_pos) == _dot) {
      throw error(LuaParseErrorCode.syntaxError, 'nombre mal formé', start);
    }
    return value;
  }
}

class _Parser {
  _Parser(this._lexer) : _tok = _lexer.next();

  final _Lexer _lexer;
  _Token _tok;
  _Token? _lookahead;

  Map<String, Object> parseChunk() {
    final globals = <String, Object>{};
    while (_tok.kind != _Kind.eof) {
      if (_isPunct(_tok, ';')) {
        _advance();
        continue;
      }
      final target = _tok;
      if (target.kind != _Kind.name ||
          _keywords.contains(target.value) ||
          !_isPunct(_peek(), '=')) {
        throw _nonLiteral(target);
      }
      _advance();
      _advance();
      final value = _parseValue(0);
      final after = _tok;
      if (after.kind != _Kind.eof && after.kind != _Kind.name && !_isPunct(after, ';')) {
        throw _unexpectedAfterValue(after);
      }
      final name = target.value as String;
      if (value == null) {
        globals.remove(name);
      } else {
        globals[name] = value;
      }
    }
    return globals;
  }

  Object? _parseValue(int depth) {
    final tok = _tok;
    switch (tok.kind) {
      case _Kind.string:
      case _Kind.number:
        _advance();
        return tok.value;
      case _Kind.name:
        if (tok.value == 'true' || tok.value == 'false' || tok.value == 'nil') {
          _advance();
          return tok.value == 'nil' ? null : tok.value == 'true';
        }
        throw _nonLiteral(tok);
      case _Kind.eof:
        throw _lexer.error(LuaParseErrorCode.syntaxError, 'valeur attendue', tok.start);
      case _Kind.punct:
        if (tok.value == '{') return _parseTable(depth + 1);
        final operand = _peek();
        if (tok.value == '-' && operand.kind == _Kind.number) {
          _advance();
          _advance();
          return -(operand.value as num);
        }
        if (_structural.contains(tok.value)) {
          throw _lexer.error(LuaParseErrorCode.syntaxError, 'valeur attendue', tok.start);
        }
        throw _nonLiteral(tok);
    }
  }

  LuaTable _parseTable(int depth) {
    if (depth > maxNestingDepth) {
      throw _lexer.error(
        LuaParseErrorCode.nestingTooDeep,
        'tables imbriquées trop profondément (maximum $maxNestingDepth)',
        _tok.start,
      );
    }
    final opener = _tok;
    _advance();
    final table = LuaTable();
    var index = 1;
    while (true) {
      final tok = _tok;
      if (_isPunct(tok, '}')) {
        _advance();
        return table;
      }
      if (tok.kind == _Kind.eof) {
        throw _lexer.error(LuaParseErrorCode.syntaxError, 'table non fermée', opener.start);
      }

      final Object key;
      if (_isPunct(tok, '[')) {
        _advance();
        final keyTok = _tok;
        final k = _parseValue(depth);
        if (k is! String && k is! num) {
          throw _lexer.error(
            LuaParseErrorCode.syntaxError,
            'clé de table non prise en charge',
            keyTok.start,
          );
        }
        if (!_isPunct(_tok, ']')) throw _unexpectedAfterValue(_tok);
        _advance();
        _expectEquals();
        key = k!;
      } else if (tok.kind == _Kind.name &&
          !_keywords.contains(tok.value) &&
          _isPunct(_peek(), '=')) {
        _advance();
        _advance();
        key = tok.value!;
      } else {
        key = index++;
      }

      final value = _parseValue(depth);
      if (value == null) {
        table.entries.remove(key);
      } else {
        table.entries[key] = value;
      }

      final sep = _tok;
      if (_isPunct(sep, ',') || _isPunct(sep, ';')) {
        _advance();
      } else if (sep.kind == _Kind.eof) {
        throw _lexer.error(LuaParseErrorCode.syntaxError, 'table non fermée', opener.start);
      } else if (!_isPunct(sep, '}')) {
        throw _unexpectedAfterValue(sep);
      }
    }
  }

  void _expectEquals() {
    if (!_isPunct(_tok, '=')) {
      throw _lexer.error(LuaParseErrorCode.syntaxError, '« = » attendu', _tok.start);
    }
    _advance();
  }

  LuaParseError _unexpectedAfterValue(_Token tok) {
    if (tok.kind == _Kind.eof) {
      return _lexer.error(LuaParseErrorCode.syntaxError, 'fin de fichier inattendue', tok.start);
    }
    if (tok.kind == _Kind.string || (tok.kind == _Kind.punct && !_structural.contains(tok.value))) {
      return _nonLiteral(tok);
    }
    return _lexer.error(LuaParseErrorCode.syntaxError, 'symbole inattendu', tok.start);
  }

  LuaParseError _nonLiteral(_Token tok) =>
      _lexer.error(LuaParseErrorCode.nonLiteralExpression, 'expression non littérale', tok.start);

  bool _isPunct(_Token tok, String value) => tok.kind == _Kind.punct && tok.value == value;

  _Token _peek() => _lookahead ??= _lexer.next();

  void _advance() {
    _tok = _lookahead ?? _lexer.next();
    _lookahead = null;
  }
}
