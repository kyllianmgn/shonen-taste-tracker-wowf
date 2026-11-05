// Generates the three tray icons (assets/tray/*.ico) as anti-aliased discs.
// Run from companion/: dart run tool/make_tray_icons.dart
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

const colors = {
  'green': (0x2E, 0x9E, 0x4F),
  'grey': (0x8A, 0x8F, 0x98),
  'orange': (0xE8, 0x81, 0x1A),
};
const sizes = [16, 24, 32, 48];

void main() {
  final out = Directory('assets/tray')..createSync(recursive: true);
  for (final MapEntry(key: name, value: rgb) in colors.entries) {
    final images = [for (final s in sizes) _bmpImage(s, rgb)];
    File('${out.path}/$name.ico').writeAsBytesSync(_ico(images));
  }
}

/// 32-bit BMP (DIB) image as stored inside an .ico.
Uint8List _bmpImage(int size, (int, int, int) rgb) {
  final (r, g, b) = rgb;
  final maskRow = ((size + 31) ~/ 32) * 4;
  final data = ByteData(40 + size * size * 4 + maskRow * size);
  data
    ..setUint32(0, 40, Endian.little)
    ..setInt32(4, size, Endian.little)
    ..setInt32(8, size * 2, Endian.little) // colour + mask
    ..setUint16(12, 1, Endian.little)
    ..setUint16(14, 32, Endian.little);
  final c = size / 2;
  final radius = size / 2 - 0.5;
  const ss = 4; // supersampling
  var o = 40;
  for (var y = size - 1; y >= 0; y--) {
    for (var x = 0; x < size; x++) {
      var inside = 0, border = 0;
      for (var sy = 0; sy < ss; sy++) {
        for (var sx = 0; sx < ss; sx++) {
          final d = sqrt(pow(x + (sx + 0.5) / ss - c, 2) + pow(y + (sy + 0.5) / ss - c, 2));
          if (d <= radius) {
            inside++;
            if (d > radius - max(1.0, size / 16)) border++;
          }
        }
      }
      final alpha = (255 * inside / (ss * ss)).round();
      final shade = inside == 0 ? 1.0 : 1 - 0.3 * border / inside;
      data
        ..setUint8(o++, (b * shade).round())
        ..setUint8(o++, (g * shade).round())
        ..setUint8(o++, (r * shade).round())
        ..setUint8(o++, alpha);
    }
  }
  return data.buffer.asUint8List(); // AND mask left at 0: alpha drives it
}

Uint8List _ico(List<Uint8List> images) {
  final header = ByteData(6 + 16 * images.length)
    ..setUint16(2, 1, Endian.little)
    ..setUint16(4, images.length, Endian.little);
  var offset = header.lengthInBytes;
  for (var i = 0; i < images.length; i++) {
    final s = sizes[i];
    final e = 6 + 16 * i;
    header
      ..setUint8(e, s)
      ..setUint8(e + 1, s)
      ..setUint16(e + 4, 1, Endian.little)
      ..setUint16(e + 6, 32, Endian.little)
      ..setUint32(e + 8, images[i].length, Endian.little)
      ..setUint32(e + 12, offset, Endian.little);
    offset += images[i].length;
  }
  return Uint8List.fromList([...header.buffer.asUint8List(), for (final i in images) ...i]);
}
