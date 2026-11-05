import 'dart:convert';
import 'dart:io';

import 'package:logging/logging.dart';

import 'app_settings.dart';

/// Reads and writes [AppSettings] as JSON.
class SettingsStore {
  SettingsStore(this.file);

  final File file;

  static final _log = Logger('settings');

  /// Returns the stored settings, or the defaults when the file is missing or
  /// unreadable. A broken file is left as is until the next [save].
  Future<AppSettings> load() async {
    if (!await file.exists()) return const AppSettings();
    try {
      final decoded = jsonDecode(await file.readAsString());
      if (decoded is Map<String, Object?>) return AppSettings.fromJson(decoded);
      _log.warning('settings.json is not a JSON object; using defaults');
    } on FormatException catch (e) {
      _log.warning('settings.json is not valid JSON (${e.message}); using defaults');
    } on FileSystemException catch (e) {
      _log.warning('cannot read settings.json (${e.osError?.message}); using defaults');
    }
    return const AppSettings();
  }

  /// Writes to a temp file then renames it, so a crash mid-write never leaves
  /// a truncated settings file.
  Future<void> save(AppSettings settings) async {
    await file.parent.create(recursive: true);
    final tmp = File('${file.path}.tmp');
    const encoder = JsonEncoder.withIndent('  ');
    await tmp.writeAsString(encoder.convert(settings.toJson()), flush: true);
    await tmp.rename(file.path);
  }
}
