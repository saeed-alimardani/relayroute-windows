#define AppName "RelayRoute"
#define AppVersion "0.2.0"
#define Publisher "RelayRoute contributors"
#define AppUrl "https://github.com/saeed-alimardani/relayroute-windows"

[Setup]
AppId={{AB90F4A9-8191-4BC0-9D14-815AF96EA1DD}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName=RelayRoute v{#AppVersion}
AppPublisher={#Publisher}
AppPublisherURL={#AppUrl}
AppSupportURL={#AppUrl}/issues
AppUpdatesURL={#AppUrl}/releases
DefaultDirName={autopf}\RelayRoute
DefaultGroupName=RelayRoute
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
WizardStyle=modern
WizardSizePercent=110
OutputDir=..\build\releases
OutputBaseFilename=RelayRoute-Setup-v{#AppVersion}-win-x64
Compression=lzma2/ultra64
SolidCompression=yes
UninstallDisplayIcon={app}\RelayRoute.exe
SetupIconFile=..\assets\relayroute.ico
LicenseFile=..\LICENSE
CloseApplications=yes
RestartApplications=no
ChangesAssociations=no
ChangesEnvironment=no
VersionInfoVersion={#AppVersion}
VersionInfoDescription=RelayRoute Installer
VersionInfoProductName=RelayRoute

[Files]
Source: "..\build\staging\RelayRoute.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\build\staging\runtime\*"; DestDir: "{app}\runtime"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\build\staging\src\*"; DestDir: "{app}\src"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\build\staging\bin\*"; DestDir: "{app}\bin"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\SECURITY.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\THIRD_PARTY_NOTICES.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\Repair-Network.ps1"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\RelayRoute"; Filename: "{app}\RelayRoute.exe"
Name: "{autodesktop}\RelayRoute"; Filename: "{app}\RelayRoute.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"

[UninstallRun]
Filename: "{app}\runtime\node.exe"; Parameters: """{app}\src\controller.mjs"" stop"; WorkingDir: "{app}"; Flags: runhidden waituntilterminated; RunOnceId: "StopRelayRouteTunnel"

[Run]
Filename: "{app}\RelayRoute.exe"; Description: "Launch RelayRoute"; Flags: nowait postinstall skipifsilent
