; inb4doc - NSIS installer for inb4doc-gui (Windows).
;
; Built by .github/workflows/build-windows.yml from the predep package zip.
; Mirrors scripts/install.cmd:
;   - installs to %LOCALAPPDATA%\Programs\inb4doc, or %ProgramFiles%\inb4doc
;     when the installer is run elevated
;   - shortcuts point straight at bin\inb4doc-gui.exe (embedded icon)
;   - per-user uninstall + Add/Remove Programs entry; user data in %APPDATA% is
;     never touched
;
; The payload staging dir must contain the canonical tree:
;   bin\inb4doc-gui.exe, bin\icon.png, editor\...
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

Name "inb4doc"
OutFile "${INSTALLER_NAME}"
Unicode true
RequestExecutionLevel user
SetCompressor /SOLID lzma

InstallDir "$LOCALAPPDATA\Programs\inb4doc"
InstallDirRegKey HKCU "Software\inb4doc" "InstallDir"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
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
      "DisplayIcon" "$INSTDIR\bin\inb4doc-gui.exe,0"
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
      "$INSTDIR\bin\inb4doc-gui.exe" "" "$INSTDIR\bin\inb4doc-gui.exe" 0
  CreateShortcut "$DESKTOP\inb4doc.lnk" \
      "$INSTDIR\bin\inb4doc-gui.exe" "" "$INSTDIR\bin\inb4doc-gui.exe" 0
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
