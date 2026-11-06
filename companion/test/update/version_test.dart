import 'package:flutter_test/flutter_test.dart';
import 'package:forevertracker_sync/update/version.dart';

void main() {
  Version v(String s) => Version.parse(s)!;

  group('parse', () {
    test('reads major.minor.patch', () {
      final x = v('1.12.3');
      expect((x.major, x.minor, x.patch), (1, 12, 3));
      expect(x.preRelease, isEmpty);
    });

    test('reads a pre-release and ignores build metadata', () {
      expect(v('1.0.0-beta.2').preRelease, ['beta', '2']);
      expect(v('1.0.0+7'), v('1.0.0'));
      expect(v('1.0.0-rc.1+abc').preRelease, ['rc', '1']);
    });

    test('accepts a leading v', () => expect(v('v2.0.1'), v('2.0.1')));

    test('toString round-trips without build metadata', () {
      expect(v('1.2.3-beta.1+9').toString(), '1.2.3-beta.1');
    });

    for (final bad in [
      '',
      '1',
      '1.2',
      '1.2.3.4',
      '01.2.3',
      '1.2.x',
      '-1.2.3',
      '1.2.3-',
      '1.2.3-beta..1',
      '1.2.3-01',
      ' 1.2.3',
      'companion-v1.2.3',
    ]) {
      test('rejects "$bad"', () => expect(Version.parse(bad), isNull));
    }
  });

  group('fromTag', () {
    test('reads companion-v tags', () {
      expect(Version.fromTag('companion-v1.4.0'), v('1.4.0'));
      expect(Version.fromTag('companion-v1.4.0-beta.1'), v('1.4.0-beta.1'));
    });

    test('ignores other tags (addon releases share the repo)', () {
      expect(Version.fromTag('addon-v1.4.0'), isNull);
      expect(Version.fromTag('v1.4.0'), isNull);
      expect(Version.fromTag('companion-1.4.0'), isNull);
      expect(Version.fromTag('companion-vnext'), isNull);
    });
  });

  group('compare (SemVer 2.0 precedence)', () {
    test('numbers compare numerically, not as text', () {
      expect(v('1.10.0') > v('1.9.0'), isTrue);
      expect(v('2.0.0') > v('1.99.99'), isTrue);
      expect(v('1.0.10') > v('1.0.2'), isTrue);
    });

    test('a release is newer than its pre-releases', () {
      expect(v('1.0.0') > v('1.0.0-rc.1'), isTrue);
      expect(v('1.0.0-rc.1') < v('1.0.0'), isTrue);
    });

    test('orders the SemVer spec example list', () {
      final ordered = [
        '1.0.0-alpha',
        '1.0.0-alpha.1',
        '1.0.0-alpha.beta',
        '1.0.0-beta',
        '1.0.0-beta.2',
        '1.0.0-beta.11',
        '1.0.0-rc.1',
        '1.0.0',
      ].map(v).toList();
      final shuffled = [...ordered.reversed]..sort();
      expect(shuffled, ordered);
    });

    test('equal versions', () {
      expect(v('1.2.3').compareTo(v('1.2.3')), 0);
      expect(v('1.2.3') == v('v1.2.3+4'), isTrue);
      expect(v('1.2.3').hashCode, v('1.2.3+4').hashCode);
      expect(v('1.2.3') >= v('1.2.3'), isTrue);
      expect(v('1.2.3') <= v('1.2.3'), isTrue);
    });

    test('isPreRelease', () {
      expect(v('1.0.0-test').isPreRelease, isTrue);
      expect(v('1.0.0').isPreRelease, isFalse);
    });
  });
}
