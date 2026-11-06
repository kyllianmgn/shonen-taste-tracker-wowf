import 'dart:ffi';

import 'package:ffi/ffi.dart';

import 'startup_launcher.dart';

// advapi32 bindings, see learn.microsoft.com for each function.
typedef _RegGetValueNative = Int32 Function(
  IntPtr,
  Pointer<Utf16>,
  Pointer<Utf16>,
  Uint32,
  Pointer<Uint32>,
  Pointer<Void>,
  Pointer<Uint32>,
);
typedef _RegGetValue = int Function(
  int,
  Pointer<Utf16>,
  Pointer<Utf16>,
  int,
  Pointer<Uint32>,
  Pointer<Void>,
  Pointer<Uint32>,
);
typedef _RegSetKeyValueNative = Int32 Function(
  IntPtr,
  Pointer<Utf16>,
  Pointer<Utf16>,
  Uint32,
  Pointer<Void>,
  Uint32,
);
typedef _RegSetKeyValue = int Function(
  int,
  Pointer<Utf16>,
  Pointer<Utf16>,
  int,
  Pointer<Void>,
  int,
);
typedef _RegDeleteKeyValueNative = Int32 Function(IntPtr, Pointer<Utf16>, Pointer<Utf16>);
typedef _RegDeleteKeyValue = int Function(int, Pointer<Utf16>, Pointer<Utf16>);

/// HKEY_CURRENT_USER, sign-extended like the Windows headers do.
const _hkeyCurrentUser = -0x7FFFFFFF;
const _regSz = 1;
const _rrfRtRegSz = 0x2;
const _errorSuccess = 0;
const _errorFileNotFound = 2;
const _errorMoreData = 234;

/// String values of a per-user registry key, by default the Run key read by
/// Windows at logon. Never needs admin rights.
class Win32RunKey implements RunKey {
  Win32RunKey({String subKey = r'Software\Microsoft\Windows\CurrentVersion\Run'})
    : this._(subKey, DynamicLibrary.open('advapi32.dll'));

  Win32RunKey._(this.subKey, DynamicLibrary advapi)
    : _getValue = advapi.lookupFunction<_RegGetValueNative, _RegGetValue>('RegGetValueW'),
      _setValue = advapi.lookupFunction<_RegSetKeyValueNative, _RegSetKeyValue>('RegSetKeyValueW'),
      _deleteValue = advapi.lookupFunction<_RegDeleteKeyValueNative, _RegDeleteKeyValue>(
        'RegDeleteKeyValueW',
      );

  /// Under HKEY_CURRENT_USER.
  final String subKey;
  final _RegGetValue _getValue;
  final _RegSetKeyValue _setValue;
  final _RegDeleteKeyValue _deleteValue;

  @override
  String? read(String name) => using((arena) {
    final key = subKey.toNativeUtf16(allocator: arena);
    final value = name.toNativeUtf16(allocator: arena);
    final size = arena<Uint32>();
    for (var attempt = 0; attempt < 3; attempt++) {
      var status = _getValue(_hkeyCurrentUser, key, value, _rrfRtRegSz, nullptr, nullptr, size);
      if (status == _errorFileNotFound) return null;
      if (status != _errorSuccess) throw RunKeyException('RegGetValueW', status);
      final buffer = arena<Uint8>(size.value + 2);
      status = _getValue(_hkeyCurrentUser, key, value, _rrfRtRegSz, nullptr, buffer.cast(), size);
      if (status == _errorMoreData) continue; // value grew between the two calls
      if (status == _errorFileNotFound) return null;
      if (status != _errorSuccess) throw RunKeyException('RegGetValueW', status);
      return buffer.cast<Utf16>().toDartString();
    }
    throw const RunKeyException('RegGetValueW', _errorMoreData);
  });

  @override
  void write(String name, String command) => using((arena) {
    final data = command.toNativeUtf16(allocator: arena);
    final status = _setValue(
      _hkeyCurrentUser,
      subKey.toNativeUtf16(allocator: arena),
      name.toNativeUtf16(allocator: arena),
      _regSz,
      data.cast(),
      (command.length + 1) * 2, // bytes, terminator included
    );
    if (status != _errorSuccess) throw RunKeyException('RegSetKeyValueW', status);
  });

  @override
  void delete(String name) => using((arena) {
    final status = _deleteValue(
      _hkeyCurrentUser,
      subKey.toNativeUtf16(allocator: arena),
      name.toNativeUtf16(allocator: arena),
    );
    if (status != _errorSuccess && status != _errorFileNotFound) {
      throw RunKeyException('RegDeleteKeyValueW', status);
    }
  });
}
