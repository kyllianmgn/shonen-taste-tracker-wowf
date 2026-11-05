import 'dart:io';

/// Builds a fake game install under a temp folder for the wow_files tests.
class WowTree {
  WowTree._(this.root);

  factory WowTree.create() => WowTree._(Directory.systemTemp.createTempSync('ftsync_wow_').path);

  /// Plays the role of the "World of Warcraft" folder.
  final String root;

  String get forever => p(root, '_forever_');

  String get wtf => p(forever, 'WTF');

  String savedVariables(String account, {String file = 'ForeverTracker.lua'}) =>
      p(wtf, 'Account', account, 'SavedVariables', file);

  /// Creates `_forever_\WTF` (the minimum for a valid game folder).
  void createWtf() => Directory(wtf).createSync(recursive: true);

  File writeFile(String path, String content) {
    final file = File(path);
    file.parent.createSync(recursive: true);
    file.writeAsStringSync(content, flush: true);
    return file;
  }

  void delete() {
    final dir = Directory(root);
    if (dir.existsSync()) dir.deleteSync(recursive: true);
  }

  static String p(
    String first, [
    String? a,
    String? b,
    String? c,
    String? d,
    String? e,
    String? f,
  ]) => [first, a, b, c, d, e, f].whereType<String>().join(Platform.pathSeparator);
}
