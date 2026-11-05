import 'dart:io';

import 'paths.dart';

const _savedVariablesDir = 'savedvariables';
const _addonFile = 'forevertracker.lua';

/// Lists every `_forever_\WTF\Account\*\SavedVariables\ForeverTracker.lua`
/// (spec docs/01, "Premier lancement" step 3). One file per account; sorted.
///
/// Names are compared case-insensitively, like Windows. Per-character folders
/// (`Account\X\Realm\Char\SavedVariables`) are not looked at.
Future<List<String>> discoverSavedVariables(String foreverPath) async {
  final found = <String>[];
  for (final account in await _subdirectories(Directory(_accountRoot(foreverPath)))) {
    for (final dir in await _subdirectories(account)) {
      if (baseName(dir.path).toLowerCase() != _savedVariablesDir) continue;
      for (final entry in await _entries(dir)) {
        if (entry is File && baseName(entry.path).toLowerCase() == _addonFile) {
          found.add(entry.path);
        }
      }
    }
  }
  found.sort();
  return found;
}

/// True when [path] has the shape discovered by [discoverSavedVariables].
/// Pure string check: the file does not need to exist.
bool isSavedVariablesFile(String foreverPath, String path) {
  final root = splitPath(_accountRoot(foreverPath)).map((s) => s.toLowerCase()).toList();
  final parts = splitPath(path).map((s) => s.toLowerCase()).toList();
  if (parts.length != root.length + 3) return false;
  for (var i = 0; i < root.length; i++) {
    if (parts[i] != root[i]) return false;
  }
  return parts[root.length + 1] == _savedVariablesDir && parts[root.length + 2] == _addonFile;
}

String _accountRoot(String foreverPath) =>
    joinPath([trimTrailingSeparators(foreverPath), 'WTF', 'Account']);

Future<List<Directory>> _subdirectories(Directory dir) async =>
    (await _entries(dir)).whereType<Directory>().toList();

/// Entries of [dir], or none when it is missing or vanishes while listed
/// (the game may be rewriting it).
Future<List<FileSystemEntity>> _entries(Directory dir) async {
  try {
    if (!await dir.exists()) return const [];
    return await dir.list(followLinks: false).toList();
  } on FileSystemException {
    return const [];
  }
}
