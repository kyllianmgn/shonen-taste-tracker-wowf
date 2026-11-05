import 'dart:convert';
import 'dart:ffi';

import 'package:ffi/ffi.dart';

import 'device_token.dart';
import 'token_store.dart';

// advapi32 Credential Manager bindings (wincred.h). Calls are leaf calls so that
// GetLastError, called right after, still holds the error of the failed call.

/// CREDENTIALW. Dart lays out structs like C, padding included.
final class _Credential extends Struct {
  @Uint32()
  external int flags;
  @Uint32()
  external int type;
  external Pointer<Utf16> targetName;
  external Pointer<Utf16> comment;
  // FILETIME LastWritten
  @Uint32()
  external int lastWrittenLow;
  @Uint32()
  external int lastWrittenHigh;
  @Uint32()
  external int credentialBlobSize;
  external Pointer<Uint8> credentialBlob;
  @Uint32()
  external int persist;
  @Uint32()
  external int attributeCount;
  external Pointer<Void> attributes;
  external Pointer<Utf16> targetAlias;
  external Pointer<Utf16> userName;
}

typedef _CredWriteNative = Int32 Function(Pointer<_Credential>, Uint32);
typedef _CredWrite = int Function(Pointer<_Credential>, int);
typedef _CredReadNative = Int32 Function(
  Pointer<Utf16>,
  Uint32,
  Uint32,
  Pointer<Pointer<_Credential>>,
);
typedef _CredRead = int Function(Pointer<Utf16>, int, int, Pointer<Pointer<_Credential>>);
typedef _CredDeleteNative = Int32 Function(Pointer<Utf16>, Uint32, Uint32);
typedef _CredDelete = int Function(Pointer<Utf16>, int, int);
typedef _CredFreeNative = Void Function(Pointer<Void>);
typedef _CredFree = void Function(Pointer<Void>);
typedef _GetLastErrorNative = Uint32 Function();
typedef _GetLastError = int Function();

const _credTypeGeneric = 1;
const _credPersistLocalMachine = 2;
const _errorNotFound = 1168;

/// Stores the device token in the Windows Credential Manager (generic
/// credential, this user and this PC only), as docs/01 « Premier lancement » asks.
/// Visible in "Gestionnaire d'identifiants > Informations d'identification Windows".
class CredentialManagerTokenStore implements TokenStore {
  CredentialManagerTokenStore({String target = defaultTarget})
    : this._(target, DynamicLibrary.open('advapi32.dll'), DynamicLibrary.open('kernel32.dll'));

  CredentialManagerTokenStore._(this.target, DynamicLibrary advapi, DynamicLibrary k32)
    : _credWrite = advapi.lookupFunction<_CredWriteNative, _CredWrite>('CredWriteW', isLeaf: true),
      _credRead = advapi.lookupFunction<_CredReadNative, _CredRead>('CredReadW', isLeaf: true),
      _credDelete = advapi.lookupFunction<_CredDeleteNative, _CredDelete>(
        'CredDeleteW',
        isLeaf: true,
      ),
      _credFree = advapi.lookupFunction<_CredFreeNative, _CredFree>('CredFree', isLeaf: true),
      _getLastError = k32.lookupFunction<_GetLastErrorNative, _GetLastError>(
        'GetLastError',
        isLeaf: true,
      );

  static const defaultTarget = 'ForeverTrackerSync/deviceToken';
  static const _userName = 'ForeverTracker Sync';

  final String target;
  final _CredWrite _credWrite;
  final _CredRead _credRead;
  final _CredDelete _credDelete;
  final _CredFree _credFree;
  final _GetLastError _getLastError;

  @override
  Future<DeviceToken?> read() async {
    final name = target.toNativeUtf16();
    final out = calloc<Pointer<_Credential>>();
    try {
      if (_credRead(name, _credTypeGeneric, 0, out) == 0) {
        final error = _getLastError();
        if (error == _errorNotFound) return null;
        throw TokenStoreException('CredReadW', error);
      }
      final cred = out.value.ref;
      try {
        final bytes = cred.credentialBlob.asTypedList(cred.credentialBlobSize);
        return DeviceToken(utf8.decode(bytes));
      } finally {
        _credFree(out.value.cast());
      }
    } finally {
      calloc.free(name);
      calloc.free(out);
    }
  }

  @override
  Future<void> write(DeviceToken token) async {
    final bytes = utf8.encode(token.value);
    final name = target.toNativeUtf16();
    final user = _userName.toNativeUtf16();
    final blob = calloc<Uint8>(bytes.length);
    final cred = calloc<_Credential>();
    try {
      blob.asTypedList(bytes.length).setAll(0, bytes);
      cred.ref
        ..type = _credTypeGeneric
        ..targetName = name
        ..userName = user
        ..credentialBlobSize = bytes.length
        ..credentialBlob = blob
        ..persist = _credPersistLocalMachine;
      if (_credWrite(cred, 0) == 0) throw TokenStoreException('CredWriteW', _getLastError());
    } finally {
      // Do not leave a copy of the token in freed native memory.
      blob.asTypedList(bytes.length).fillRange(0, bytes.length, 0);
      calloc.free(blob);
      calloc.free(cred);
      calloc.free(name);
      calloc.free(user);
    }
  }

  @override
  Future<void> delete() async {
    final name = target.toNativeUtf16();
    try {
      if (_credDelete(name, _credTypeGeneric, 0) == 0) {
        final error = _getLastError();
        if (error != _errorNotFound) throw TokenStoreException('CredDeleteW', error);
      }
    } finally {
      calloc.free(name);
    }
  }
}
