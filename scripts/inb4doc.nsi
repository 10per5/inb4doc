; inb4doc - NSIS installer for inb4doc-gui (Windows).
;
; Built by .github/workflows/build-windows.yml from the predep package zip.
; Mirrors scripts/install.cmd:
;   - installs to %LOCALAPPDATA%\Programs\inb4doc, or %ProgramFiles%\inb4doc
;     when the installer is run elevated
;   - shortcuts point straight at inb4doc-gui.exe (embedded icon)
;   - per-user uninstall + Add/Remove Programs entry; user data in %APPDATA% is
;     never touched
;
; The payload staging dir must contain the flat tree:
;   inb4doc-gui.exe, icon.png, editor\...
;
;   makensis /DPAYLOAD=C:\path\to\payload /DAPP_VERSION=0.0.5 inb4doc.nsi

!include "MUI2.nsh"
!include "LogicLib.nsh"

!ifndef PAYLOAD
  !define PAYLOAD "payload"
!endif
!ifndef APP_VERSION
  !define APP_VERSION "dev"
!endif
!ifndef INSTALLER_NAME
  !define INSTALLER_NAME "inb4doc-windows-installer-x86_64.exe"
!endif
!ifndef OUTFILE
  !define OUTFILE "${INSTALLER_NAME}"
!endif

Name "inb4doc"
OutFile "${OUTFILE}"
Unicode true
RequestExecutionLevel user
SetCompressor /SOLID lzma

InstallDir "$LOCALAPPDATA\Programs\inb4doc"
InstallDirRegKey HKCU "Software\inb4doc" "InstallDir"

; Launch the freshly installed app from the Finish page. The checkbox is
; checked by default (define MUI_FINISHPAGE_RUN_NOTCHECKED to invert). A
; RUN_FUNCTION is used so the app is launched with the "open" verb — never
; "runas" — so it does not inherit an elevated installer's privileges.
!define MUI_FINISHPAGE_RUN_FUNCTION "LaunchInb4doc"
!define MUI_FINISHPAGE_RUN_TEXT "Run inb4doc now"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  UserInfo::GetAccountType
  Pop $0
  ${If} $0 == "Admin"
  ${AndIf} $INSTDIR == "$LOCALAPPDATA\Programs\inb4doc"
    StrCpy $INSTDIR "$PROGRAMFILES\inb4doc"
  ${EndIf}
FunctionEnd

; Finish-page launcher. ExecShell with the "open" verb (never "runas"), so the
; app runs unelevated even when the installer itself was elevated.
Function LaunchInb4doc
  ExecShell "open" "$INSTDIR\inb4doc-gui.exe"
FunctionEnd

Section "Install" SecMain
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  File /r "${PAYLOAD}\*"

  WriteUninstaller "$INSTDIR\uninstall.exe"

  WriteRegStr HKCU "Software\inb4doc" "InstallDir" "$INSTDIR"

  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\inb4doc" \
      "DisplayName" "inb4doc"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\inb4doc" \
      "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\inb4doc" \
      "Publisher" "10per5"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\inb4doc" \
      "DisplayIcon" "$INSTDIR\inb4doc-gui.exe,0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\inb4doc" \
      "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\inb4doc" \
      "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\inb4doc" \
      "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\inb4doc" \
      "NoRepair" 1

  CreateDirectory "$SMPROGRAMS\inb4doc"
  CreateShortcut "$SMPROGRAMS\inb4doc\inb4doc.lnk" \
      "$INSTDIR\inb4doc-gui.exe" "" "$INSTDIR\inb4doc-gui.exe" 0
  CreateShortcut "$DESKTOP\inb4doc.lnk" \
      "$INSTDIR\inb4doc-gui.exe" "" "$INSTDIR\inb4doc-gui.exe" 0
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  Delete "$SMPROGRAMS\inb4doc\inb4doc.lnk"
  RMDir "$SMPROGRAMS\inb4doc"
  Delete "$DESKTOP\inb4doc.lnk"

  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\inb4doc"
  DeleteRegKey HKCU "Software\inb4doc"

  RMDir /r "$INSTDIR"
SectionEnd
