import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:forevertracker_sync/api/api_error.dart';
import 'package:forevertracker_sync/api/api_models.dart';
import 'package:forevertracker_sync/api/companion_api.dart';
import 'package:forevertracker_sync/api/device_token.dart';
import 'package:forevertracker_sync/queue/notifier.dart';

import 'contract.dart';
import 'fake_clock.dart';

/// Fake C-05: checks every body against the contract, records every attempt and
/// what the server accepted, and fails while [down] (network) or with [syncError] /
/// [heartbeatError].
class FakeCompanionApi implements CompanionApi {
  FakeCompanionApi(this.clock);

  final FakeClock clock;

  /// Every attempt, failed or not.
  final heartbeats = <HeartbeatRequest>[];
  final syncs = <SyncRequest>[];
  final syncTimes = <DateTime>[];
  final attemptTimes = <DateTime>[];

  /// What reached the server, in arrival order.
  final delivered = <({String kind, int sentAt, DateTime at})>[];
  final deliveredSyncs = <SyncRequest>[];

  int intervalSec = 600;
  bool down = false;
  ApiException? syncError;
  ApiException? heartbeatError;

  @override
  Future<HeartbeatResponse> heartbeat(DeviceToken token, HeartbeatRequest request) async {
    expect(contractErrors('heartbeat.request', jsonDecode(jsonEncode(request.toJson()))), isEmpty);
    heartbeats.add(request);
    attemptTimes.add(clock.now());
    if (down) throw const NetworkError('SocketException');
    final e = heartbeatError;
    if (e != null) throw e;
    delivered.add((kind: 'heartbeat', sentAt: request.sentAt, at: clock.now()));
    return HeartbeatResponse(heartbeatIntervalSec: intervalSec, serverTime: request.sentAt);
  }

  @override
  Future<SyncResponse> sync(DeviceToken token, SyncRequest request) async {
    expect(contractErrors('sync.request', jsonDecode(jsonEncode(request.toJson()))), isEmpty);
    syncs.add(request);
    syncTimes.add(clock.now());
    attemptTimes.add(clock.now());
    if (down) throw const NetworkError('SocketException');
    final e = syncError;
    if (e != null) throw e;
    delivered.add((kind: 'sync', sentAt: request.sentAt, at: clock.now()));
    deliveredSyncs.add(request);
    return SyncResponse(
      heartbeatIntervalSec: intervalSec,
      results: [
        for (final c in request.characters.cast<Map<String, Object?>>())
          SyncResult(
            key: CharacterRef.fromJson({
              for (final k in ['region', 'firstName', 'surname']) k: (c['key'] as Map)[k],
            }),
            status: SyncStatus.ok,
            acceptedEvents: (c['events'] as List).length,
            duplicateEvents: 0,
            flags: const [],
          ),
      ],
    );
  }

  /// Every event id sent, in order, across all sync attempts.
  List<String> get sentEventIds => _ids(syncs);

  /// Every event id the server accepted, in order.
  List<String> get deliveredEventIds => _ids(deliveredSyncs);

  static List<String> _ids(List<SyncRequest> syncs) => [
    for (final s in syncs)
      for (final c in s.characters.cast<Map<String, Object?>>())
        for (final e in (c['events'] as List).cast<Map<String, Object?>>()) e['id'] as String,
  ];
}

class RecordingNotifier implements Notifier {
  final shown = <({String title, String body, Future<void> Function()? onClick})>[];

  @override
  Future<void> show({
    required String title,
    required String body,
    Future<void> Function()? onClick,
  }) async => shown.add((title: title, body: body, onClick: onClick));
}
