import 'dart:io';

/// Locations of the app's local files, all under `%APPDATA%\ForeverTrackerSync`.
class AppPaths {
  AppPaths(this.dataDir);

  /// Builds the paths from the process environment (`Platform.environment`).
  factory AppPaths.fromEnvironment(Map<String, String> environment) {
    final appData = environment['APPDATA'];
    if (appData == null || appData.isEmpty) {
      throw StateError('APPDATA is not set; cannot locate the settings folder');
    }
    return AppPaths(Directory(_join(appData, folderName)));
  }

  static const folderName = 'ForeverTrackerSync';

  final Directory dataDir;

  File get settingsFile => File(_join(dataDir.path, 'settings.json'));

  /// Rotating log files live next to the settings, as the spec requires.
  Directory get logsDir => dataDir;

  /// Last snapshot sent per character and the ids of the events already sent (C-06).
  File get sentStateFile => File(_join(dataDir.path, 'sync-state.json'));

  /// Offline queue folder: one JSON file per request waiting to be sent again (C-07).
  Directory get queueDir => Directory(_join(dataDir.path, 'queue'));

  static String _join(String a, String b) => '$a${Platform.pathSeparator}$b';
}
