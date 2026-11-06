// Generates the app icons, anti-aliased by supersampling:
// - assets/tray/{green,grey,orange}.ico: status disc with a white "level up"
//   chevron (16 to 48 px, the tray sizes);
// - windows/runner/resources/app_icon.ico: gold double chevron on a navy
//   rounded square (16 to 256 px), used by the exe, the shortcuts and the
//   installer.
// Run from companion/: dart run tool/make_icons.dart
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

typedef Rgb = (int, int, int);

const trayColors = <String, Rgb>{
  'green': (0x2E, 0x9E, 0x4F),
  'grey': (0x8A, 0x8F, 0x98),
  'orange': (0xE8, 0x81, 0x1A),
};
const traySizes = [16, 20, 24, 32, 40, 48];
const appSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];

const _white = (0xFF, 0xFF, 0xFF);
const _navyTop = (0x2A, 0x4A, 0x7F);
const _navyBottom = (0x16, 0x24, 0x40);
const _gold = (0xF5, 0xB9, 0x42);

void main() {
  final tray = Directory('assets/tray')..createSync(recursive: true);
  for (final MapEntry(key: name, value: rgb) in trayColors.entries) {
    File('${tray.path}/$name.ico').writeAsBytesSync(
      ico([for (final s in traySizes) (s, render(s, (x, y) => trayPixel(x, y, s, rgb)))]),
    );
  }
  File(
    'windows/runner/resources/app_icon.ico',
  ).writeAsBytesSync(ico([for (final s in appSizes) (s, render(s, (x, y) => appPixel(x, y, s)))]));
}

/// Premultiplied-free RGBA colour of one sample, coordinates in [-1, 1].
typedef Shader = (double, double, double, double) Function(double x, double y);

/// RGBA rows, top row first.
Uint8List render(int size, Shader shade) {
  const ss = 5;
  final out = Uint8List(size * size * 4);
  for (var py = 0; py < size; py++) {
    for (var px = 0; px < size; px++) {
      var r = 0.0, g = 0.0, b = 0.0, a = 0.0;
      for (var sy = 0; sy < ss; sy++) {
        for (var sx = 0; sx < ss; sx++) {
          final x = (px + (sx + 0.5) / ss) / size * 2 - 1;
          final y = (py + (sy + 0.5) / ss) / size * 2 - 1;
          final (cr, cg, cb, ca) = shade(x, y);
          r += cr * ca;
          g += cg * ca;
          b += cb * ca;
          a += ca;
        }
      }
      final o = (py * size + px) * 4;
      out[o] = a == 0 ? 0 : (r / a).round();
      out[o + 1] = a == 0 ? 0 : (g / a).round();
      out[o + 2] = a == 0 ? 0 : (b / a).round();
      out[o + 3] = (255 * a / (ss * ss)).round();
    }
  }
  return out;
}

(double, double, double, double) trayPixel(double x, double y, int size, Rgb rgb) {
  final d = sqrt(x * x + y * y);
  if (d > 1) return (0, 0, 0, 0);
  // A thin darker rim keeps the disc readable on light taskbars.
  final rim = d > 1 - max(2.0 / size, 0.08);
  final base = rim ? _scale(rgb, 0.72) : rgb;
  // One chevron at 16 px (two would blur), two from 20 px up.
  final stroke = size <= 16 ? 0.30 : 0.22;
  final hit = size <= 16
      ? chevron(x, y + 0.08, 0.46, 0.36, stroke)
      : chevron(x, y - 0.17, 0.44, 0.30, stroke) || chevron(x, y + 0.25, 0.44, 0.30, stroke);
  return _rgba(hit ? _white : base);
}

(double, double, double, double) appPixel(double x, double y, int size) {
  if (!roundedSquare(x, y, 0.94, size <= 24 ? 0.30 : 0.36)) return (0, 0, 0, 0);
  final t = (y + 1) / 2;
  final bg = _mix(_navyTop, _navyBottom, t);
  final stroke = size <= 24 ? 0.26 : 0.19;
  final hit = size <= 16
      ? chevron(x, y + 0.08, 0.48, 0.38, stroke + 0.04)
      : chevron(x, y - 0.20, 0.50, 0.34, stroke) || chevron(x, y + 0.30, 0.50, 0.34, stroke);
  return _rgba(hit ? _gold : bg);
}

/// Upward chevron centred on the origin: apex at (0, -h/2), arms down to
/// (±w, h/2), round ends.
bool chevron(double x, double y, double w, double h, double stroke) {
  final r = stroke / 2;
  return _segmentDistance(x, y, -w, h / 2, 0, -h / 2) <= r ||
      _segmentDistance(x, y, 0, -h / 2, w, h / 2) <= r;
}

bool roundedSquare(double x, double y, double half, double radius) {
  final qx = max(x.abs() - (half - radius), 0.0);
  final qy = max(y.abs() - (half - radius), 0.0);
  return x.abs() <= half && y.abs() <= half && qx * qx + qy * qy <= radius * radius;
}

double _segmentDistance(double px, double py, double ax, double ay, double bx, double by) {
  final dx = bx - ax, dy = by - ay;
  final t = (((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)).clamp(0.0, 1.0);
  final cx = ax + t * dx - px, cy = ay + t * dy - py;
  return sqrt(cx * cx + cy * cy);
}

Rgb _scale(Rgb c, double k) => ((c.$1 * k).round(), (c.$2 * k).round(), (c.$3 * k).round());

Rgb _mix(Rgb a, Rgb b, double t) => (
  (a.$1 + (b.$1 - a.$1) * t).round(),
  (a.$2 + (b.$2 - a.$2) * t).round(),
  (a.$3 + (b.$3 - a.$3) * t).round(),
);

(double, double, double, double) _rgba(Rgb c) =>
    (c.$1.toDouble(), c.$2.toDouble(), c.$3.toDouble(), 1);

/// .ico container: 256 px images as PNG (what Windows expects), smaller ones
/// as 32-bit BMP.
Uint8List ico(List<(int, Uint8List)> images) {
  final encoded = [for (final (s, rgba) in images) s >= 256 ? png(s, s, rgba) : bmp(s, rgba)];
  final header = ByteData(6 + 16 * images.length)
    ..setUint16(2, 1, Endian.little)
    ..setUint16(4, images.length, Endian.little);
  var offset = header.lengthInBytes;
  for (var i = 0; i < images.length; i++) {
    final s = images[i].$1;
    final e = 6 + 16 * i;
    header
      ..setUint8(e, s >= 256 ? 0 : s)
      ..setUint8(e + 1, s >= 256 ? 0 : s)
      ..setUint16(e + 4, 1, Endian.little)
      ..setUint16(e + 6, 32, Endian.little)
      ..setUint32(e + 8, encoded[i].length, Endian.little)
      ..setUint32(e + 12, offset, Endian.little);
    offset += encoded[i].length;
  }
  return Uint8List.fromList([...header.buffer.asUint8List(), for (final b in encoded) ...b]);
}

/// 32-bit DIB as stored inside an .ico: bottom-up BGRA, then an AND mask
/// left at 0 (alpha drives transparency).
Uint8List bmp(int size, Uint8List rgba) {
  final maskRow = ((size + 31) ~/ 32) * 4;
  final data = ByteData(40 + size * size * 4 + maskRow * size)
    ..setUint32(0, 40, Endian.little)
    ..setInt32(4, size, Endian.little)
    ..setInt32(8, size * 2, Endian.little) // colour + mask
    ..setUint16(12, 1, Endian.little)
    ..setUint16(14, 32, Endian.little);
  var o = 40;
  for (var y = size - 1; y >= 0; y--) {
    for (var x = 0; x < size; x++) {
      final i = (y * size + x) * 4;
      data
        ..setUint8(o++, rgba[i + 2])
        ..setUint8(o++, rgba[i + 1])
        ..setUint8(o++, rgba[i])
        ..setUint8(o++, rgba[i + 3]);
    }
  }
  return data.buffer.asUint8List();
}

Uint8List png(int width, int height, Uint8List rgba) {
  final raw = BytesBuilder();
  for (var y = 0; y < height; y++) {
    raw.addByte(0); // filter: none
    raw.add(Uint8List.sublistView(rgba, y * width * 4, (y + 1) * width * 4));
  }
  final ihdr = ByteData(13)
    ..setUint32(0, width)
    ..setUint32(4, height)
    ..setUint8(8, 8) // bit depth
    ..setUint8(9, 6); // RGBA
  return Uint8List.fromList([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, //
    ..._chunk('IHDR', ihdr.buffer.asUint8List()),
    ..._chunk('IDAT', Uint8List.fromList(ZLibEncoder(level: 9).convert(raw.takeBytes()))),
    ..._chunk('IEND', Uint8List(0)),
  ]);
}

Uint8List _chunk(String type, Uint8List data) {
  final body = Uint8List.fromList([...type.codeUnits, ...data]);
  final out = ByteData(12 + data.length)..setUint32(0, data.length);
  for (var i = 0; i < body.length; i++) {
    out.setUint8(4 + i, body[i]);
  }
  out.setUint32(8 + data.length, _crc32(body));
  return out.buffer.asUint8List();
}

int _crc32(Uint8List bytes) {
  var crc = 0xFFFFFFFF;
  for (final b in bytes) {
    crc ^= b;
    for (var k = 0; k < 8; k++) {
      crc = (crc & 1) != 0 ? (crc >> 1) ^ 0xEDB88320 : crc >> 1;
    }
  }
  return crc ^ 0xFFFFFFFF;
}
