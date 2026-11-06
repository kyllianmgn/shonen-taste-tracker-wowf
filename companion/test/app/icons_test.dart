import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';

/// Sizes declared in each .ico directory (0 means 256).
List<int> icoSizes(String path) {
  final data = ByteData.sublistView(File(path).readAsBytesSync());
  expect(data.getUint16(2, Endian.little), 1, reason: '$path is not an icon');
  return [
    for (var i = 0; i < data.getUint16(4, Endian.little); i++)
      switch (data.getUint8(6 + 16 * i)) {
        0 => 256,
        final s => s,
      },
  ];
}

void main() {
  // Regenerated with: dart run tool/make_icons.dart
  test('tray icons cover the tray sizes up to 200 % scaling', () {
    for (final name in ['green', 'grey', 'orange']) {
      expect(icoSizes('assets/tray/$name.ico'), [16, 20, 24, 32, 40, 48], reason: name);
    }
  });

  test('the app icon goes up to 256 px (Explorer, installer, Start menu)', () {
    expect(icoSizes('windows/runner/resources/app_icon.ico'), [
      16,
      20,
      24,
      32,
      40,
      48,
      64,
      128,
      256,
    ]);
    final bytes = File('windows/runner/resources/app_icon.ico').readAsBytesSync();
    final last = ByteData.sublistView(bytes, 6 + 16 * 8);
    final offset = last.getUint32(12, Endian.little);
    expect(bytes.sublist(offset, offset + 4), [0x89, 0x50, 0x4E, 0x47], reason: '256 px as PNG');
  });
}
