import '../queue/notifier.dart';
import '../ui/tray/tray_state.dart';
import 'update_checker.dart';

/// Startup update check (docs/01 « Interface »): when a newer release exists,
/// one Windows notification and a tray menu entry, both opening the download
/// link. The player installs it; the app never updates itself in v1.
class UpdateNotice {
  UpdateNotice({
    required this.source,
    required this.notifier,
    required this.emit,
    required this.openUrl,
  });

  final UpdateSource source;
  final Notifier notifier;
  final void Function(TrayEvent event) emit;
  final Future<void> Function(Uri url) openUrl;

  UpdateInfo? _latest;

  Future<void> checkOnce() async {
    final info = await source.check();
    if (info == null) return;
    _latest = info;
    emit(UpdateAvailable(info.version.toString()));
    await notifier.show(
      title: 'Mise à jour disponible',
      body: 'ForeverTracker Sync ${info.version} est disponible. Clique ici pour la télécharger.',
      onClick: openLatest,
    );
  }

  /// Opens the download link of the update found, if any.
  Future<void> openLatest() async {
    final info = _latest;
    if (info != null) await openUrl(info.downloadUrl);
  }
}
