import 'package:flutter_test/flutter_test.dart';
import 'package:forevertracker_sync/update/update_checker.dart';
import 'package:forevertracker_sync/update/update_notice.dart';
import 'package:forevertracker_sync/update/version.dart';
import 'package:forevertracker_sync/ui/tray/tray_state.dart';

import '../support/fake_companion_api.dart';

class FixedSource implements UpdateSource {
  FixedSource(this.result);
  final UpdateInfo? result;
  int calls = 0;

  @override
  Future<UpdateInfo?> check() async {
    calls++;
    return result;
  }
}

void main() {
  final info = UpdateInfo(
    version: Version.parse('1.2.0')!,
    downloadUrl: Uri.parse(
      'https://github.com/shokkzu/forever-tracker/releases/download/companion-v1.2.0/ForeverTrackerSync-Setup-1.2.0.exe',
    ),
  );
  late RecordingNotifier notifier;
  late List<TrayEvent> events;
  late List<Uri> opened;

  UpdateNotice notice(UpdateInfo? result) {
    notifier = RecordingNotifier();
    events = [];
    opened = [];
    return UpdateNotice(
      source: FixedSource(result),
      notifier: notifier,
      emit: events.add,
      openUrl: (u) async => opened.add(u),
    );
  }

  test('newer release: one French notification and a tray entry', () async {
    final n = notice(info);
    await n.checkOnce();
    expect(notifier.shown.single.title, 'Mise à jour disponible');
    expect(
      notifier.shown.single.body,
      'ForeverTracker Sync 1.2.0 est disponible. Clique ici pour la télécharger.',
    );
    expect(events.single, isA<UpdateAvailable>());
    expect((events.single as UpdateAvailable).version, '1.2.0');
    expect(opened, isEmpty, reason: 'no silent update in v1: the player chooses');
  });

  test('clicking the notification or the menu opens the download link', () async {
    final n = notice(info);
    await n.checkOnce();
    await notifier.shown.single.onClick!();
    await n.openLatest();
    expect(opened, [info.downloadUrl, info.downloadUrl]);
  });

  test('no update: nothing shown, the menu entry does nothing', () async {
    final n = notice(null);
    await n.checkOnce();
    await n.openLatest();
    expect(notifier.shown, isEmpty);
    expect(events, isEmpty);
    expect(opened, isEmpty);
  });
}
