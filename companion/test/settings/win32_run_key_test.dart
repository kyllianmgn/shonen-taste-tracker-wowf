@TestOn('windows')
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:forevertracker_sync/settings/win32_run_key.dart';

/// Real registry round trip, in a throwaway HKCU key (never the Run key).
void main() {
  const subKey = r'Software\ForeverTrackerSyncTests';
  final key = Win32RunKey(subKey: subKey);

  tearDown(() => key.delete('value'));
  tearDownAll(() => Process.runSync('reg', ['delete', 'HKCU\\$subKey', '/f']));

  test('missing value reads as null, deleting it is a no-op', () {
    expect(key.read('value'), isNull);
    key.delete('value');
  });

  test('write, read back, overwrite, delete', () {
    const exe =
        r'"C:\Users\Jaïna\AppData\Local\Programs\ForeverTracker Sync\forevertracker_sync.exe"';
    key.write('value', exe);
    expect(key.read('value'), exe);
    key.write('value', '"x"');
    expect(key.read('value'), '"x"');
    key.delete('value');
    expect(key.read('value'), isNull);
  });
}
