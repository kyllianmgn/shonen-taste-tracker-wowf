@TestOn('windows')
library;

import 'dart:io';
import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:forevertracker_sync/api/credential_manager_token_store.dart';
import 'package:forevertracker_sync/api/device_token.dart';

import '../support/fake_server.dart';

/// Talks to the real Windows Credential Manager under a throw-away target name.
void main() {
  late CredentialManagerTokenStore store;

  setUp(() {
    final suffix = Random().nextInt(1 << 32).toRadixString(16);
    store = CredentialManagerTokenStore(target: 'ForeverTrackerSync/test-$pid-$suffix');
  });

  tearDown(() => store.delete());

  test('the production target name is stable', () {
    expect(CredentialManagerTokenStore.defaultTarget, 'ForeverTrackerSync/deviceToken');
  });

  test('read returns null when nothing is stored', () async {
    expect(await store.read(), isNull);
  });

  test('write, read back, overwrite, delete', () async {
    await store.write(const DeviceToken(sampleToken));
    expect(await store.read(), const DeviceToken(sampleToken));

    const other = DeviceToken('another-token-0123456789_abcdefghijklmnopqr');
    await store.write(other);
    expect(await store.read(), other);

    await store.delete();
    expect(await store.read(), isNull);
  });

  test('delete without a stored token is not an error', () async {
    await store.delete();
    await store.delete();
  });
}
