/// Lists the full executable path of every running process the app may query.
///
/// Processes whose path cannot be read (protected, system, already gone) are skipped,
/// never reported as errors. Implemented by `Win32ProcessLister`; tests use a fake.
abstract interface class ProcessLister {
  Future<List<String>> executablePaths();
}
