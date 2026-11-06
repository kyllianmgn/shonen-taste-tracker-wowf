import 'package:flutter_test/flutter_test.dart';
import 'package:forevertracker_sync/ui/tray/tray_menu.dart';
import 'package:forevertracker_sync/ui/tray/tray_state.dart';

void main() {
  const paired = TrayState(paired: true);

  List<String> labels(List<TrayMenuEntry> m) =>
      m.map((e) => e.isSeparator ? '---' : e.label).toList();

  TrayMenuEntry byAction(List<TrayMenuEntry> m, TrayAction a) =>
      m.singleWhere((e) => e.action == a);

  test('lists status, then the actions required by the spec', () {
    final s = paired.apply(
      SendSucceeded(DateTime(2026, 11, 5, 9, 7), isSync: true, character: 'Jaina'),
    );
    final menu = buildTrayMenu(s, startWithWindows: true);
    expect(labels(menu), [
      'Statut : Jeu fermé',
      'Perso : Jaina',
      'Dernière synchro : 05/11 09:07',
      'Serveur : connecté',
      '---',
      'Synchroniser maintenant',
      'Délier',
      'Démarrer avec Windows',
      'Ouvrir les logs',
      '---',
      'Quitter',
    ]);
    expect(menu.take(4).every((e) => !e.enabled && e.action == null), isTrue);
  });

  test('empty status before any sync', () {
    final menu = buildTrayMenu(paired, startWithWindows: true);
    expect(labels(menu).sublist(1, 4), [
      'Perso : aucun',
      'Dernière synchro : jamais',
      'Serveur : en attente',
    ]);
  });

  test('not paired: offers pairing and disables sync', () {
    final menu = buildTrayMenu(const TrayState(), startWithWindows: true);
    expect(byAction(menu, TrayAction.pair).label, 'Appairer…');
    expect(menu.any((e) => e.action == TrayAction.unpair), isFalse);
    expect(byAction(menu, TrayAction.syncNow).enabled, isFalse);
  });

  test('paired: offers unpairing and enables sync', () {
    final menu = buildTrayMenu(paired, startWithWindows: true);
    expect(byAction(menu, TrayAction.unpair).label, 'Délier');
    expect(byAction(menu, TrayAction.syncNow).enabled, isTrue);
  });

  test('"Démarrer avec Windows" reflects the setting', () {
    expect(
      byAction(
        buildTrayMenu(paired, startWithWindows: true),
        TrayAction.toggleStartWithWindows,
      ).checked,
      isTrue,
    );
    expect(
      byAction(
        buildTrayMenu(paired, startWithWindows: false),
        TrayAction.toggleStartWithWindows,
      ).checked,
      isFalse,
    );
  });

  test('server line follows the server status', () {
    String line(TrayState s) => buildTrayMenu(s, startWithWindows: true)[3].label;
    expect(line(paired.apply(const SendFailed())), 'Serveur : injoignable');
    expect(line(paired.apply(const Unauthorized())), 'Serveur : jeton révoqué');
  });
  test('an available update adds a download entry under the status', () {
    expect(
      buildTrayMenu(paired, startWithWindows: true).any((e) => e.action == TrayAction.openUpdate),
      isFalse,
    );
    final menu = buildTrayMenu(
      paired.apply(const UpdateAvailable('1.2.0')),
      startWithWindows: true,
    );
    expect(labels(menu)[4], 'Télécharger la version 1.2.0');
    expect(byAction(menu, TrayAction.openUpdate).enabled, isTrue);
    expect(labels(menu)[5], '---');
  });
}
