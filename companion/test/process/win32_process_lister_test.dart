@TestOn('windows')
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:forevertracker_sync/process/win32_process_lister.dart';

void main() {
  // Smoke test against the real Win32 API: the test runner itself must be listed.
  test('lists the current process with its full executable path', () async {
    final paths = await Win32ProcessLister().executablePaths();
    final self = File(Platform.resolvedExecutable).absolute.path.toLowerCase();

    expect(paths.length, greaterThan(1));
    expect(paths.map((p) => p.toLowerCase()), contains(self));
    expect(paths.every((p) => p.contains(r'\')), isTrue);
  });
}
