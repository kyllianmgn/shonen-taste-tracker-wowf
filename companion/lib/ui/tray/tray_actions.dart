import '../../api/pairing_service.dart';
import '../../settings/app_settings.dart';
import '../../settings/settings_store.dart';
import '../../settings/startup_launcher.dart';
import '../../sync/sync_service.dart';
import 'tray_menu.dart';
import 'tray_state.dart';

/// Routes tray menu clicks to the services. Pure Dart.
class TrayActions {
  TrayActions({
    required this.sync,
    required this.pairing,
    required this.startup,
    required this.settings,
    required this.openLogs,
    required this.quit,
    required this.emit,
  });

  final SyncService sync;
  final PairingService pairing;
  final StartupLauncher startup;
  final SettingsStore settings;
  final Future<void> Function() openLogs;
  final Future<void> Function() quit;

  /// Feeds state-machine events back (pairing changes).
  final void Function(TrayEvent event) emit;

  /// Runs [action]. Returns the new settings when the action changed them.
  Future<AppSettings?> handle(TrayAction action) async {
    switch (action) {
      case TrayAction.syncNow:
        await sync.syncNow();
      case TrayAction.pair:
        if (await pairing.pair()) emit(const Paired());
      case TrayAction.unpair:
        await pairing.unpair();
        emit(const Unpaired());
      case TrayAction.toggleStartWithWindows:
        final current = await settings.load();
        final next = current.copyWith(startWithWindows: !current.startWithWindows);
        await startup.setEnabled(next.startWithWindows);
        await settings.save(next);
        return next;
      case TrayAction.openLogs:
        await openLogs();
      case TrayAction.quit:
        await quit();
    }
    return null;
  }
}
