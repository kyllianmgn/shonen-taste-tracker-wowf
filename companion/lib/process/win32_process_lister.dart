import 'dart:ffi';

import 'package:ffi/ffi.dart';

import 'process_lister.dart';

// kernel32 bindings, see docs.microsoft.com for each function.
typedef _EnumProcessesNative = Int32 Function(Pointer<Uint32>, Uint32, Pointer<Uint32>);
typedef _EnumProcesses = int Function(Pointer<Uint32>, int, Pointer<Uint32>);
typedef _OpenProcessNative = IntPtr Function(Uint32, Int32, Uint32);
typedef _OpenProcess = int Function(int, int, int);
typedef _QueryImageNameNative = Int32 Function(IntPtr, Uint32, Pointer<Utf16>, Pointer<Uint32>);
typedef _QueryImageName = int Function(int, int, Pointer<Utf16>, Pointer<Uint32>);
typedef _CloseHandleNative = Int32 Function(IntPtr);
typedef _CloseHandle = int Function(int);

const _processQueryLimitedInformation = 0x1000;
const _win32PathFormat = 0;

/// Long-path aware buffer size, in UTF-16 code units.
const _maxPath = 32768;

/// Lists processes with `K32EnumProcesses`, then reads each executable path with
/// `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` + `QueryFullProcessImageNameW`.
/// Needs no admin rights; processes that refuse the query are skipped.
class Win32ProcessLister implements ProcessLister {
  Win32ProcessLister() : this._(DynamicLibrary.open('kernel32.dll'));

  Win32ProcessLister._(DynamicLibrary k32)
    : _enumProcesses = k32.lookupFunction<_EnumProcessesNative, _EnumProcesses>('K32EnumProcesses'),
      _openProcess = k32.lookupFunction<_OpenProcessNative, _OpenProcess>('OpenProcess'),
      _queryImageName = k32.lookupFunction<_QueryImageNameNative, _QueryImageName>(
        'QueryFullProcessImageNameW',
      ),
      _closeHandle = k32.lookupFunction<_CloseHandleNative, _CloseHandle>('CloseHandle');

  final _EnumProcesses _enumProcesses;
  final _OpenProcess _openProcess;
  final _QueryImageName _queryImageName;
  final _CloseHandle _closeHandle;

  @override
  Future<List<String>> executablePaths() async {
    final paths = <String>[];
    final name = calloc<Uint16>(_maxPath).cast<Utf16>();
    final size = calloc<Uint32>();
    try {
      for (final pid in _processIds()) {
        if (pid == 0) continue; // System Idle Process
        final handle = _openProcess(_processQueryLimitedInformation, 0, pid);
        if (handle == 0) continue;
        try {
          size.value = _maxPath;
          if (_queryImageName(handle, _win32PathFormat, name, size) != 0) {
            paths.add(name.toDartString(length: size.value));
          }
        } finally {
          _closeHandle(handle);
        }
      }
    } finally {
      calloc.free(name);
      calloc.free(size);
    }
    return paths;
  }

  /// `K32EnumProcesses` cannot say how many ids exist: grow until the buffer is not full.
  List<int> _processIds() {
    var capacity = 1024;
    while (true) {
      final ids = calloc<Uint32>(capacity);
      final needed = calloc<Uint32>();
      try {
        final bytes = capacity * sizeOf<Uint32>();
        if (_enumProcesses(ids, bytes, needed) == 0) {
          throw StateError('K32EnumProcesses failed');
        }
        if (needed.value < bytes) {
          return ids.asTypedList(needed.value ~/ sizeOf<Uint32>()).toList();
        }
      } finally {
        calloc.free(ids);
        calloc.free(needed);
      }
      capacity *= 2;
    }
  }
}
