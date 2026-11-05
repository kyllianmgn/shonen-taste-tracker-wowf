import 'dart:convert';
import 'dart:io';

import 'package:logging/logging.dart';

/// Size-based rotating log files: `forevertracker-sync.log` is the current
/// file, `.1.log` the previous one, up to [maxFiles] files in total.
///
/// Callers must never log tokens, pairing codes or full SavedVariables
/// content (CLAUDE.md hard rules).
class RotatingFileSink {
  RotatingFileSink(
    this.dir, {
    this.baseName = 'forevertracker-sync',
    this.maxBytes = 1024 * 1024,
    this.maxFiles = 5,
  }) : assert(maxFiles >= 1) {
    dir.createSync(recursive: true);
    final current = _file(0);
    _size = current.existsSync() ? current.lengthSync() : 0;
  }

  final Directory dir;
  final String baseName;
  final int maxBytes;
  final int maxFiles;
  late int _size;

  void writeLine(String line) {
    final bytes = utf8.encode('$line\n');
    if (_size > 0 && _size + bytes.length > maxBytes) _rotate();
    _file(0).writeAsBytesSync(bytes, mode: FileMode.append, flush: true);
    _size += bytes.length;
  }

  void _rotate() {
    final oldest = _file(maxFiles - 1);
    if (oldest.existsSync()) oldest.deleteSync();
    for (var i = maxFiles - 2; i >= 0; i--) {
      final f = _file(i);
      if (f.existsSync()) f.renameSync(_file(i + 1).path);
    }
    _size = 0;
  }

  File _file(int index) => File('${dir.path}${Platform.pathSeparator}'
      '$baseName${index == 0 ? '' : '.$index'}.log');
}

String formatLogRecord(LogRecord r) {
  final b = StringBuffer('${r.time.toIso8601String()} ${r.level.name} '
      '${r.loggerName}: ${r.message}');
  if (r.error != null) b.write(' | ${r.error}');
  if (r.stackTrace != null) b.write('\n${r.stackTrace}');
  return b.toString();
}

/// Sends every log record at [level] or above to [sink].
void setupLogging(RotatingFileSink sink, {Level level = Level.INFO}) {
  Logger.root.level = level;
  Logger.root.onRecord.listen((r) => sink.writeLine(formatLogRecord(r)));
}
