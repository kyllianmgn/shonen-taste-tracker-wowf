; Inno Setup 6 script for ForeverTracker Sync (task C-08).
; Per-user install, no admin right: %LOCALAPPDATA%\Programs\ForeverTracker Sync.
; Built by .github/workflows/companion.yml, or by hand from companion/:
;   flutter build windows --release --dart-define=API_BASE_URL=https://forever.vsgsrv.fr
;   (copy msvcp140.dll, vcruntime140.dll, vcruntime140_1.dll next to the exe)
;   iscc /DAppVersion=1.0.0 /DAppVersionNumeric=1.0.0 installer\forevertracker_sync.iss
; Output: build\installer\ForeverTrackerSync-Setup-<AppVersion>.exe
; The installer is not signed in v1: SmartScreen warns until it gains reputation.

#ifndef AppVersion
  #define AppVersion "0.0.0-dev"
#endif
#ifndef AppVersionNumeric
  #define AppVersionNumeric "0.0.0"
#endif
#define AppName "ForeverTracker Sync"
#define AppExe "forevertracker_sync.exe"
#define ReleaseDir "..\build\windows\x64\runner\Release"
; Same value name as RegistryStartupLauncher.valueName (lib/settings/startup_launcher.dart).
#define RunKey "Software\Microsoft\Windows\CurrentVersion\Run"

[Setup]
; Never change AppId: upgrades and the uninstaller find the install with it.
AppId={{6F1C2B7E-4E0D-4C55-9F3A-2B8D7E5A1C40}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=ForeverTracker
AppPublisherURL=https://github.com/shokkzu/forever-tracker
AppSupportURL=https://github.com/shokkzu/forever-tracker/issues
AppUpdatesURL=https://github.com/shokkzu/forever-tracker/releases
VersionInfoVersion={#AppVersionNumeric}
VersionInfoProductVersion={#AppVersionNumeric}
VersionInfoProductTextVersion={#AppVersion}
PrivilegesRequired=lowest
DefaultDirName={autopf}\{#AppName}
DisableProgramGroupPage=yes
DisableDirPage=auto
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
SetupIconFile=..\windows\runner\resources\app_icon.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
OutputDir=..\build\installer
OutputBaseFilename=ForeverTrackerSync-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; Upgrades close the running tray app (Restart Manager), then restart it.
CloseApplications=force
RestartApplications=yes

[Languages]
Name: "french"; MessagesFile: "compiler:Languages\French.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "{#ReleaseDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; Same path as the shortcut local_notifier needs for toasts: one shortcut, not two.
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"

[Run]
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/f /im {#AppExe}"; Flags: runhidden; RunOnceId: "StopApp"

[Code]
// "Démarrer avec Windows" is written by the app itself (HKCU Run); remove it
// with the app. Settings, logs and the offline queue in %APPDATA% are kept.
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
    RegDeleteValue(HKEY_CURRENT_USER, '{#RunKey}', '{#AppName}');
end;
