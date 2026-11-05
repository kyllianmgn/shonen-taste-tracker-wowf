import 'package:logging/logging.dart';

/// Registers the app to start with Windows, implemented in C-08.
abstract interface class StartupLauncher {
  Future<void> setEnabled(bool enabled);
}

/// Placeholder until C-08: only the setting is saved.
class NotImplementedStartupLauncher implements StartupLauncher {
  static final _log = Logger('startup');

  @override
  Future<void> setEnabled(bool enabled) async =>
      _log.info('setEnabled($enabled): not implemented yet (C-08)');
}
