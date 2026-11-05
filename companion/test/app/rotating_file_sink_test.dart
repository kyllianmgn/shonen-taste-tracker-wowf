import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:forevertracker_sync/app/rotating_file_sink.dart';
import 'package:logging/logging.dart';

void main() {
  late Directory tmp;

  setUp(() => tmp = Directory.systemTemp.createTempSync('ftsync_logs_'));
  tearDown(() => tmp.deleteSync(recursive: true));

  File f(String name) => File('${tmp.path}${Platform.pathSeparator}$name');
  List<String> names() => tmp.listSync().map((e) => e.uri.pathSegments.last).toList()..sort();

  test('appends lines to the current file, creating the folder', () {
    final dir = Directory('${tmp.path}${Platform.pathSeparator}sub');
    final sink = RotatingFileSink(dir, maxBytes: 1000, maxFiles: 3);
    sink.writeLine('one');
    sink.writeLine('two');
    expect(
      File('${dir.path}${Platform.pathSeparator}forevertracker-sync.log').readAsStringSync(),
      'one\ntwo\n',
    );
  });

  test('rotates when the next line would exceed maxBytes', () {
    final sink = RotatingFileSink(tmp, maxBytes: 10, maxFiles: 3);
    sink.writeLine('aaaa'); // 5 bytes
    sink.writeLine('bbbb'); // 10 bytes, still fits
    sink.writeLine('cccc'); // would be 15: rotate first
    expect(f('forevertracker-sync.log').readAsStringSync(), 'cccc\n');
    expect(f('forevertracker-sync.1.log').readAsStringSync(), 'aaaa\nbbbb\n');
  });

  test('keeps at most maxFiles files, dropping the oldest', () {
    final sink = RotatingFileSink(tmp, maxBytes: 5, maxFiles: 3);
    for (final l in ['1111', '2222', '3333', '4444', '5555']) {
      sink.writeLine(l);
    }
    expect(names(), [
      'forevertracker-sync.1.log',
      'forevertracker-sync.2.log',
      'forevertracker-sync.log',
    ]);
    expect(f('forevertracker-sync.log').readAsStringSync(), '5555\n');
    expect(f('forevertracker-sync.1.log').readAsStringSync(), '4444\n');
    expect(f('forevertracker-sync.2.log').readAsStringSync(), '3333\n');
  });

  test('takes the existing file size into account after a restart', () {
    f('forevertracker-sync.log').writeAsStringSync('12345678\n');
    RotatingFileSink(tmp, maxBytes: 10, maxFiles: 2).writeLine('next');
    expect(f('forevertracker-sync.1.log').readAsStringSync(), '12345678\n');
    expect(f('forevertracker-sync.log').readAsStringSync(), 'next\n');
  });

  test('a line longer than maxBytes is still written', () {
    final sink = RotatingFileSink(tmp, maxBytes: 4, maxFiles: 2);
    sink.writeLine('much too long');
    expect(f('forevertracker-sync.log').readAsStringSync(), 'much too long\n');
  });

  test('formats records with time, level, logger and error', () {
    final r = LogRecord(Level.WARNING, 'boom', 'sync', StateError('x'));
    final line = formatLogRecord(r);
    expect(line, startsWith(r.time.toIso8601String()));
    expect(line, contains(' WARNING sync: boom'));
    expect(line, contains('Bad state: x'));
  });
}
