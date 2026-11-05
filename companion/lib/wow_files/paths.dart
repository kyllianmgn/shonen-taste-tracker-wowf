import 'dart:io';

// Minimal path helpers, so wow_files needs no extra dependency.

final _separators = RegExp(r'[\\/]+');

String joinPath(List<String> parts) => parts.join(Platform.pathSeparator);

/// Splits on both `\` and `/`, dropping empty segments.
List<String> splitPath(String path) => path.split(_separators).where((s) => s.isNotEmpty).toList();

String baseName(String path) {
  final parts = splitPath(path);
  return parts.isEmpty ? '' : parts.last;
}

String trimTrailingSeparators(String path) {
  var end = path.length;
  while (end > 1 && (path[end - 1] == r'\' || path[end - 1] == '/')) {
    end--;
  }
  // Keep the separator of a drive root such as `C:\`.
  if (end == 2 && path.length > 2 && path[1] == ':') end = 3;
  return path.substring(0, end);
}
