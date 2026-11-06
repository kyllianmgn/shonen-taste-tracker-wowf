/// Semantic version (https://semver.org, 2.0.0) as used by the companion's
/// `pubspec.yaml` and its `companion-v<version>` release tags.
class Version implements Comparable<Version> {
  const Version(this.major, this.minor, this.patch, [this.preRelease = const []]);

  final int major;
  final int minor;
  final int patch;

  /// Dot-separated pre-release identifiers (`1.0.0-beta.2` → `['beta', '2']`).
  final List<String> preRelease;

  static const tagPrefix = 'companion-v';

  static final _pattern = RegExp(
    r'^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)'
    r'(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)'
    r'(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?'
    r'(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$',
  );

  /// Parses `1.2.3`, `v1.2.3`, `1.2.3-rc.1`, `1.2.3+7` (build metadata is
  /// dropped). Returns null for anything else.
  static Version? parse(String text) {
    final m = _pattern.firstMatch(text);
    if (m == null) return null;
    final [major, minor, patch] = [
      for (final g in [1, 2, 3]) int.tryParse(m[g]!),
    ];
    if (major == null || minor == null || patch == null) return null; // overflow
    return Version(major, minor, patch, m[4] == null ? const [] : m[4]!.split('.'));
  }

  /// The version of a `companion-v<version>` tag, null for any other tag
  /// (the addon's releases live in the same repository).
  static Version? fromTag(String tag) {
    if (!tag.startsWith(tagPrefix)) return null;
    final rest = tag.substring(tagPrefix.length);
    return rest.startsWith('v') ? null : parse(rest);
  }

  bool get isPreRelease => preRelease.isNotEmpty;

  @override
  int compareTo(Version other) {
    for (final (a, b) in [(major, other.major), (minor, other.minor), (patch, other.patch)]) {
      if (a != b) return a.compareTo(b);
    }
    // A release ranks above its pre-releases.
    if (preRelease.isEmpty || other.preRelease.isEmpty) {
      return other.preRelease.length.sign - preRelease.length.sign;
    }
    for (var i = 0; i < preRelease.length && i < other.preRelease.length; i++) {
      final c = _compareIdentifier(preRelease[i], other.preRelease[i]);
      if (c != 0) return c;
    }
    return preRelease.length.compareTo(other.preRelease.length);
  }

  /// Numeric identifiers compare as numbers and rank below alphanumeric ones.
  static int _compareIdentifier(String a, String b) {
    final na = int.tryParse(a), nb = int.tryParse(b);
    if (na != null && nb != null) return na.compareTo(nb);
    if (na != null) return -1;
    if (nb != null) return 1;
    return a.compareTo(b);
  }

  bool operator <(Version other) => compareTo(other) < 0;
  bool operator <=(Version other) => compareTo(other) <= 0;
  bool operator >(Version other) => compareTo(other) > 0;
  bool operator >=(Version other) => compareTo(other) >= 0;

  @override
  bool operator ==(Object other) => other is Version && compareTo(other) == 0;

  @override
  int get hashCode => Object.hash(major, minor, patch, Object.hashAll(preRelease));

  @override
  String toString() =>
      '$major.$minor.$patch${preRelease.isEmpty ? '' : '-${preRelease.join('.')}'}';
}
