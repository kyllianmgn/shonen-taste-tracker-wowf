import 'package:logging/logging.dart';

/// Registers the app to start with Windows.
abstract interface class StartupLauncher {
  Future<void> setEnabled(bool enabled);
}

/// The values of `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`.
/// Real implementation: `win32_run_key.dart`.
abstract interface class RunKey {
  String? read(String name);

  /// Throws [RunKeyException].
  void write(String name, String command);

  /// No-op when the value is missing. Throws [RunKeyException].
  void delete(String name);
}

class RunKeyException implements Exception {
  const RunKeyException(this.call, this.code);
  final String call;
  final int code;

  @override
  String toString() => 'RunKeyException($call, $code)';
}

/// "Démarrer avec Windows" through the per-user Run key: no admin right, and
/// the player can still turn it off in the Task Manager's startup tab. The
/// Inno Setup uninstaller deletes the same value (installer/).
class RegistryStartupLauncher implements StartupLauncher {
  RegistryStartupLauncher({required RunKey runKey, required String executablePath})
    : _key = runKey,
      _exe = executablePath;

  static const valueName = 'ForeverTracker Sync';
  static final _log = Logger('startup');

  final RunKey _key;
  final String _exe;

  String get _command => '"$_exe"';

  /// `flutter run` builds live under build\windows: registering them would
  /// start a stale debug build at every logon.
  bool get _isDevelopmentBuild =>
      _exe.toLowerCase().replaceAll('/', r'\').contains(r'\build\windows\');

  /// True when the Run value points at this executable.
  bool get isEnabled {
    try {
      return _key.read(valueName) == _command;
    } on RunKeyException catch (e) {
      _log.warning('cannot read the Run key: $e');
      return false;
    }
  }

  @override
  Future<void> setEnabled(bool enabled) async {
    try {
      if (!enabled) {
        _key.delete(valueName);
        _log.info('start with Windows disabled');
      } else if (_isDevelopmentBuild) {
        _log.info('start with Windows skipped for a development build');
      } else if (!isEnabled) {
        _key.write(valueName, _command);
        _log.info('start with Windows enabled');
      }
    } on RunKeyException catch (e) {
      // The setting stays saved; the next start tries again.
      _log.warning('cannot update the Run key: $e');
    }
  }

  /// At each start, once the first-run window has saved the choice, re-apply
  /// it: repairs the path after a reinstall elsewhere, and restores the value
  /// when something removed it while the setting says "on".
  Future<void> applyAtStartup({
    required bool firstRunCompleted,
    required bool startWithWindows,
  }) async {
    if (firstRunCompleted) await setEnabled(startWithWindows);
  }
}
