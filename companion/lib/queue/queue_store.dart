import 'dart:convert';
import 'dart:io';

import 'package:logging/logging.dart';

import 'queued_request.dart';

abstract interface class QueueStore {
  /// Every queued request, in send order.
  Future<List<QueuedRequest>> load();

  Future<void> add(QueuedRequest request);

  Future<void> remove(int seq);
}

/// `%APPDATA%\ForeverTrackerSync\queue\`: one `<seq>.json` file per request,
/// written to a temp file then renamed. Holds contract bodies only, never the token.
class FileQueueStore implements QueueStore {
  FileQueueStore(this.dir);

  final Directory dir;

  static final _log = Logger('queue');
  static final _name = RegExp(r'^(\d{10})\.json$');

  /// Unreadable files are deleted (logged by name only); other files are ignored.
  @override
  Future<List<QueuedRequest>> load() async {
    if (!await dir.exists()) return const [];
    final found = <QueuedRequest>[];
    await for (final entry in dir.list()) {
      if (entry is! File) continue;
      final name = entry.uri.pathSegments.last;
      final match = _name.firstMatch(name);
      if (match == null) continue;
      try {
        final decoded = jsonDecode(await entry.readAsString());
        if (decoded is! Map<String, Object?>) throw const FormatException('not an object');
        final request = QueuedRequest.fromJson(decoded);
        if (request.seq != int.parse(match.group(1)!)) {
          throw const FormatException('seq does not match the file name');
        }
        found.add(request);
      } on FormatException catch (e) {
        _log.warning('queue file $name unreadable (${e.message}): deleted');
        await _delete(entry);
      } on FileSystemException catch (e) {
        _log.warning('cannot read queue file $name (${e.osError?.message ?? e.message})');
      }
    }
    found.sort((a, b) => a.seq.compareTo(b.seq));
    return found;
  }

  @override
  Future<void> add(QueuedRequest request) async {
    await dir.create(recursive: true);
    final file = _file(request.seq);
    final tmp = File('${file.path}.tmp');
    await tmp.writeAsString(jsonEncode(request.toJson()), flush: true);
    await tmp.rename(file.path);
  }

  @override
  Future<void> remove(int seq) => _delete(_file(seq));

  File _file(int seq) =>
      File('${dir.path}${Platform.pathSeparator}${seq.toString().padLeft(10, '0')}.json');

  static Future<void> _delete(File file) async {
    try {
      await file.delete();
    } on PathNotFoundException {
      // Already gone.
    }
  }
}
