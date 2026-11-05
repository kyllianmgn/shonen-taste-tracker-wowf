import 'dart:io';

import 'paths.dart';

/// Why a folder picked by the player cannot be used as the game folder.
enum ForeverFolderProblem {
  notFound('Ce dossier est introuvable.'),
  noForeverFolder(
    'Aucun dossier _forever_ ici. Choisis le dossier World of Warcraft qui contient _forever_.',
  ),
  noWtf(
    'Le dossier _forever_ ne contient pas de dossier WTF. Lance le jeu une fois puis réessaie.',
  );

  const ForeverFolderProblem(this.message);

  /// Shown as is in the first-run window (C-05).
  final String message;
}

/// Outcome of [ForeverFolderLocator.check]: either a `_forever_` path or a problem.
class ForeverFolderCheck {
  const ForeverFolderCheck.valid(String this.foreverPath) : problem = null;

  const ForeverFolderCheck.invalid(ForeverFolderProblem this.problem) : foreverPath = null;

  final String? foreverPath;
  final ForeverFolderProblem? problem;

  bool get isValid => foreverPath != null;
}

/// Finds the `_forever_` folder (spec docs/01, "Premier lancement" step 1).
class ForeverFolderLocator {
  const ForeverFolderLocator({this.candidates = defaultCandidates});

  /// Tried in this order before asking the player.
  static const defaultCandidates = [
    r'C:\Program Files (x86)\World of Warcraft\_forever_',
    r'C:\Program Files\World of Warcraft\_forever_',
  ];

  static const foreverFolderName = '_forever_';

  final List<String> candidates;

  /// The first candidate that passes [check], or null when the player has to choose.
  Future<String?> detect() async {
    for (final candidate in candidates) {
      final result = await check(candidate);
      if (result.isValid) return result.foreverPath;
    }
    return null;
  }

  /// Validates a folder chosen by the player: either the World of Warcraft folder
  /// or the `_forever_` folder itself. It must contain `_forever_\WTF`.
  Future<ForeverFolderCheck> check(String chosen) async {
    final folder = trimTrailingSeparators(chosen);
    if (!await Directory(folder).exists()) {
      return const ForeverFolderCheck.invalid(ForeverFolderProblem.notFound);
    }
    final forever = baseName(folder).toLowerCase() == foreverFolderName
        ? folder
        : joinPath([folder, foreverFolderName]);
    if (!await Directory(forever).exists()) {
      return const ForeverFolderCheck.invalid(ForeverFolderProblem.noForeverFolder);
    }
    if (!await Directory(joinPath([forever, 'WTF'])).exists()) {
      return const ForeverFolderCheck.invalid(ForeverFolderProblem.noWtf);
    }
    return ForeverFolderCheck.valid(forever);
  }
}
