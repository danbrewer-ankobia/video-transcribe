; Inno Setup script for Video Transcribe.
; Compile with: ISCC.exe installer.iss
; Produces:    output\VideoTranscribeSetup.exe

#define MyAppName        "Video Transcribe"
#define MyAppVersion     "0.1.0"
#define MyAppPublisher   "Dan Brewer"
#define MyAppExeName     "launch.vbs"
#define MyAppId          "{{D7B6C2F1-2D8E-4F1F-B2A1-1E9F4F1AABCD}"

[Setup]
AppId={#MyAppId}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\Video Transcribe
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
OutputDir={#SourcePath}\output
OutputBaseFilename=VideoTranscribeSetup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\ui\favicon.ico
DisableDirPage=auto

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Files]
; Everything in dist-installer\ gets installed under {app}.
Source: "{#SourcePath}\..\dist-installer\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}";       Filename: "{sys}\wscript.exe"; Parameters: """{app}\launch.vbs"""; WorkingDir: "{app}"
Name: "{group}\Stop {#MyAppName}";  Filename: "{app}\stop.cmd";    WorkingDir: "{app}"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{commondesktop}\{#MyAppName}"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\launch.vbs"""; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\launch.vbs"""; Description: "Launch {#MyAppName} now"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; Try to stop a running server before removing files.
Filename: "{app}\stop.cmd"; Flags: runhidden; RunOnceId: "StopServer"

[Code]
function InitializeUninstall(): Boolean;
begin
  Result := True;
end;
