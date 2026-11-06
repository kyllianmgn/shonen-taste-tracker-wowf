import 'package:flutter_test/flutter_test.dart';
import 'package:forevertracker_sync/ui/tray/tray_state.dart';

void main() {
  final t0 = DateTime(2026, 11, 5, 14, 32);
  const paired = TrayState(paired: true);

  TrayState run(TrayState s, List<TrayEvent> events) => events.fold(s, (acc, e) => acc.apply(e));

  group('icon colour', () {
    test('initial state, not paired: orange', () {
      expect(const TrayState().color, TrayColor.orange);
      expect(const TrayState().issue, TrayIssue.notPaired);
    });

    test('paired, game closed: grey', () {
      expect(paired.color, TrayColor.grey);
      expect(paired.issue, isNull);
    });

    test('paired, game running, nothing sent yet: green', () {
      expect(paired.apply(const GameStarted()).color, TrayColor.green);
    });

    test('game running and last send OK: green', () {
      final s = run(paired, [const GameStarted(), SendSucceeded(t0)]);
      expect(s.color, TrayColor.green);
    });

    test('game stopped after a successful send: grey', () {
      final s = run(paired, [const GameStarted(), SendSucceeded(t0), const GameStopped()]);
      expect(s.color, TrayColor.grey);
    });

    test('failed send: orange, even with the game closed', () {
      expect(run(paired, [const GameStarted(), const SendFailed()]).color, TrayColor.orange);
      expect(run(paired, [const SendFailed()]).color, TrayColor.orange);
      expect(run(paired, [const SendFailed()]).issue, TrayIssue.serverUnreachable);
    });

    test('a later successful send clears a failed send', () {
      final s = run(paired, [const GameStarted(), const SendFailed(), SendSucceeded(t0)]);
      expect(s.color, TrayColor.green);
      expect(s.issue, isNull);
    });

    test('unknown schema: orange until a send succeeds', () {
      var s = run(paired, [const GameStarted(), const UnknownSchema()]);
      expect(s.color, TrayColor.orange);
      expect(s.issue, TrayIssue.unknownSchema);
      s = s.apply(SendSucceeded(t0));
      expect(s.color, TrayColor.green);
    });

    test('401: orange, unpaired, and stays orange whatever the game does', () {
      final s = run(paired, [const GameStarted(), const Unauthorized(), const GameStopped()]);
      expect(s.color, TrayColor.orange);
      expect(s.issue, TrayIssue.tokenRevoked);
      expect(s.paired, isFalse);
    });

    test('pairing again clears the revoked token', () {
      final s = run(paired, [const Unauthorized(), const Paired()]);
      expect(s.color, TrayColor.grey);
      expect(s.issue, isNull);
    });

    test('unpairing: orange, not paired', () {
      final s = run(paired, [const GameStarted(), const Unpaired()]);
      expect(s.color, TrayColor.orange);
      expect(s.issue, TrayIssue.notPaired);
    });
  });

  group('issue priority', () {
    test('revoked token wins over unknown schema and network errors', () {
      final s = run(paired, [const SendFailed(), const UnknownSchema(), const Unauthorized()]);
      expect(s.issue, TrayIssue.tokenRevoked);
    });

    test('unknown schema wins over a network error', () {
      final s = run(paired, [const SendFailed(), const UnknownSchema()]);
      expect(s.issue, TrayIssue.unknownSchema);
    });
  });

  group('status details', () {
    test('a sync records its time and character; a heartbeat does not', () {
      var s = paired.apply(SendSucceeded(t0, isSync: true, character: 'Thrall'));
      expect(s.lastSyncAt, t0);
      expect(s.lastCharacter, 'Thrall');
      s = s.apply(SendSucceeded(t0.add(const Duration(minutes: 10))));
      expect(s.lastSyncAt, t0);
      expect(s.lastCharacter, 'Thrall');
    });

    test('server status follows sends', () {
      expect(paired.server, ServerStatus.unknown);
      expect(paired.apply(SendSucceeded(t0)).server, ServerStatus.ok);
      expect(paired.apply(const SendFailed()).server, ServerStatus.unreachable);
      expect(paired.apply(const Unauthorized()).server, ServerStatus.tokenRevoked);
    });
  });

  test('tooltips are French and fit the Windows 127-char limit', () {
    final states = [
      const TrayState(),
      paired,
      paired.apply(const GameStarted()),
      paired.apply(const SendFailed()),
      paired.apply(const UnknownSchema()),
      paired.apply(const Unauthorized()),
    ];
    for (final s in states) {
      expect(s.tooltip, startsWith('ForeverTracker Sync'));
      expect(s.tooltip.length, lessThanOrEqualTo(127));
    }
    expect(paired.apply(const UnknownSchema()).tooltip, contains("mets à jour l'appli"));
    expect(
      paired.apply(const Unauthorized()).tooltip,
      contains("réappaire l'appli avec /lier appli"),
    );
  });
  test('an available update is remembered without changing colour or summary', () {
    final s = paired.apply(const GameStarted());
    final u = s.apply(const UpdateAvailable('1.2.0'));
    expect(u.updateVersion, '1.2.0');
    expect(u.color, s.color);
    expect(u.summary, s.summary);
    expect(u.apply(const SendFailed()).updateVersion, '1.2.0');
    expect(const TrayState().updateVersion, isNull);
  });
}
