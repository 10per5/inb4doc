@echo off
setlocal enabledelayedexpansion
rem ===========================================================================
rem  install.cmd - installer for inb4doc-gui (Windows)
rem
rem  Standalone downloader: pulls the release payload from GitHub and installs
rem  it. No build tools, no checkout, single file. Eval it straight from a
rem  console:
rem
rem    curl.exe -fsSL https://raw.githubusercontent.com/10per5/inb4doc/main/scripts/install.cmd -o %TEMP%\inb4doc-install.cmd && %TEMP%\inb4doc-install.cmd
rem
rem  or PowerShell:
rem
rem    irm https://raw.githubusercontent.com/10per5/inb4doc/main/scripts/install.cmd -o $env:TEMP\inb4doc-install.cmd; & $env:TEMP\inb4doc-install.cmd
rem
rem  Payload: <releases>/latest/download/inb4doc-windows-x86_64.zip
rem  Default prefix (no admin): %LOCALAPPDATA%\Programs\inb4doc
rem  If run elevated:           %ProgramFiles%\inb4doc
rem
rem  Usage:
rem    install.cmd [--prefix DIR] [--version TAG] [--source SRC]
rem                [--no-shortcuts] [--uninstall] [--verify] [--help]
rem ===========================================================================

set "VERSION="
set "SOURCE="
set "PREFIX="
set "NO_SHORTCUTS=0"
set "UNINSTALL=0"
set "VERIFY=0"

rem ---- parse args ----
:parse
if "%~1"=="" goto :parse_done
if /i "%~1"=="--prefix" (
  if "%~2"=="" (
    echo error: --prefix requires a value
    goto :usage
  )
  set "PREFIX=%~2"
  shift
  shift
  goto :parse
)
if /i "%~1"=="--version" (
  if "%~2"=="" (
    echo error: --version requires a value
    goto :usage
  )
  set "VERSION=%~2"
  shift
  shift
  goto :parse
)
if /i "%~1"=="--source" (
  if "%~2"=="" (
    echo error: --source requires a value
    goto :usage
  )
  set "SOURCE=%~2"
  shift
  shift
  goto :parse
)
if /i "%~1"=="--no-shortcuts" (
  set "NO_SHORTCUTS=1"
  shift
  goto :parse
)
if /i "%~1"=="--uninstall" (
  set "UNINSTALL=1"
  shift
  goto :parse
)
if /i "%~1"=="--verify" (
  set "VERIFY=1"
  shift
  goto :parse
)
if /i "%~1"=="--help" goto :usage
echo error: unknown option: %~1
goto :usage
:parse_done

rem ---- defaults ----
if not defined LOCALAPPDATA set "LOCALAPPDATA=%USERPROFILE%\AppData\Local"

rem ---- detect elevation (net session needs admin) ----
net session >nul 2>&1
if errorlevel 1 (
  set "IS_ADMIN=0"
) else (
  set "IS_ADMIN=1"
)

if not defined PREFIX (
  if "%IS_ADMIN%"=="1" (
    set "PREFIX=%ProgramFiles%\inb4doc"
  ) else (
    set "PREFIX=%LOCALAPPDATA%\Programs\inb4doc"
  )
)

if "%UNINSTALL%"=="1" (
  call :uninstall
) else (
  call :install
  call :verify
)
exit /b 0

rem ===========================================================================
:usage
echo.
echo Usage: install.cmd [--prefix DIR] [--version TAG] [--source SRC]
echo                [--no-shortcuts] [--uninstall] [--verify] [--help]
echo.
echo Installs inb4doc-gui. Default prefix:
echo   no admin   %LOCALAPPDATA%\Programs\inb4doc
echo   elevated   %ProgramFiles%\inb4doc
echo.
echo By default the payload is downloaded from GitHub releases (latest):
echo   https://github.com/10per5/inb4doc/releases/latest
echo.
echo Options:
echo   --prefix DIR       Install prefix
echo   --version TAG      Install a pinned release tag instead of latest
echo   --source SRC       Payload source override: URL, .zip file or directory
echo   --no-shortcuts     Skip Start Menu / Desktop shortcuts
echo   --uninstall        Remove prefix and shortcuts
echo   --verify           Run the GUI with --debug after install
exit /b 0

rem ===========================================================================
rem Download a URL to a file (curl first, PowerShell fallback).
:download
curl.exe -fsSL --retry 3 "%~1" -o "%~2" >nul 2>&1
if not errorlevel 1 exit /b 0
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%~1' -OutFile '%~2'"
if errorlevel 1 (
  echo error: download failed: %~1
  exit /b 1
)
exit /b 0

rem ===========================================================================
rem Expand a zip archive into a directory.
:expand
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '%~1' -DestinationPath '%~2' -Force"
if errorlevel 1 (
  echo error: failed to extract %~1
  exit /b 1
)
exit /b 0

rem ===========================================================================
rem Obtain the payload; sets PAYLOAD_BASE to a directory with the payload.
:obtain_payload
set "PAYLOAD_BASE=%TEMP%\inb4doc-payload"
set "PAYLOAD_ZIP=%TEMP%\inb4doc-payload.zip"
if exist "%PAYLOAD_BASE%" rmdir /s /q "%PAYLOAD_BASE%"
if exist "%PAYLOAD_ZIP%" del /q "%PAYLOAD_ZIP%"

if defined SOURCE goto :use_source

set "URL=https://github.com/10per5/inb4doc/releases/latest/download/inb4doc-windows-x86_64.zip"
if defined VERSION set "URL=https://github.com/10per5/inb4doc/releases/download/%VERSION%/inb4doc-windows-x86_64.zip"
echo Downloading %URL% ...
call :download "%URL%" "%PAYLOAD_ZIP%"
if errorlevel 1 exit /b 1
call :expand "%PAYLOAD_ZIP%" "%PAYLOAD_BASE%"
exit /b 0

:use_source
rem --source can be a directory, a .zip file, or a URL
if exist "%SOURCE%\" (
  set "PAYLOAD_BASE=%SOURCE%"
  exit /b 0
)
if exist "%SOURCE%" (
  echo Copying %SOURCE% ...
  copy /y "%SOURCE%" "%PAYLOAD_ZIP%" >nul
) else (
  echo Downloading %SOURCE% ...
  call :download "%SOURCE%" "%PAYLOAD_ZIP%"
  if errorlevel 1 exit /b 1
)
call :expand "%PAYLOAD_ZIP%" "%PAYLOAD_BASE%"
exit /b 0

rem ===========================================================================
rem Locate bin\ + editor\ (canonical) or inb4doc-gui.exe + dist\ (flat legacy)
rem inside PAYLOAD_BASE; sets PAYLOAD_BIN / PAYLOAD_EDITOR.
:find_payload
set "PAYLOAD_BIN="
set "PAYLOAD_EDITOR="
call :probe_payload "%PAYLOAD_BASE%"
if not "!PAYLOAD_BIN!"=="" goto :payload_found
for /d %%d in ("%PAYLOAD_BASE%\*") do (
  call :probe_payload "%%~fd"
  if not "!PAYLOAD_BIN!"=="" goto :payload_found
)
echo error: no usable payload in archive.
exit /b 1
:payload_found
exit /b 0

:probe_payload
if exist "%~1\bin\inb4doc-gui.exe" (
  if exist "%~1\editor\index.html" (
    set "PAYLOAD_BIN=%~1\bin"
    set "PAYLOAD_EDITOR=%~1\editor"
    exit /b 0
  )
)
if exist "%~1\inb4doc-gui.exe" (
  if exist "%~1\dist\index.html" (
    set "PAYLOAD_BIN=%~1"
    set "PAYLOAD_EDITOR=%~1\dist"
    exit /b 0
  )
)
exit /b 0

rem ===========================================================================
rem robocopy returns 0-7 on success, >= 8 on failure. Fall back to xcopy.
:copy_tree
robocopy "%~1" "%~2" /E /NFL /NDL /NJH /NJS /NP >nul 2>&1
if not errorlevel 8 exit /b 0
if not exist "%~2" mkdir "%~2"
xcopy "%~1\*" "%~2\" /E /I /Y /Q >nul 2>&1
exit /b 0

rem ===========================================================================
:install
if defined VERSION (set "LABEL=%VERSION%") else (set "LABEL=latest")
echo Installing inb4doc (%LABEL%) into %PREFIX%

call :obtain_payload
if errorlevel 1 exit /b 1

call :find_payload
if errorlevel 1 exit /b 1

if not exist "%PREFIX%\bin" mkdir "%PREFIX%\bin"
call :copy_tree "%PAYLOAD_BIN%" "%PREFIX%\bin"
if errorlevel 1 (
  echo error: failed to copy %PAYLOAD_BIN% to %PREFIX%\bin
  exit /b 1
)
call :copy_tree "%PAYLOAD_EDITOR%" "%PREFIX%\editor"
if errorlevel 1 (
  echo error: failed to copy %PAYLOAD_EDITOR% to %PREFIX%\editor
  exit /b 1
)
echo Copied thin-shell editor to %PREFIX%\editor\

call :write_launcher

if "%NO_SHORTCUTS%"=="1" (
  echo Skipped shortcuts.
) else (
  call :create_shortcuts
)
exit /b 0

rem ===========================================================================
:write_launcher
(
  echo @echo off
  echo rem inb4doc launcher - robust to double-click path issues
  echo start "" "%%~dp0bin\inb4doc-gui.exe" %%*
) > "%PREFIX%\inb4doc.cmd"
echo Created launcher %PREFIX%\inb4doc.cmd
exit /b 0

rem ===========================================================================
rem Start Menu + Desktop shortcuts, written inline so install.cmd stays a
rem single self-contained file that works when eval'd from a console.
:create_shortcuts
echo Creating Start Menu / Desktop shortcuts ...
call :write_shortcuts_script
if errorlevel 1 exit /b 0
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" "%PREFIX%" create
if errorlevel 1 (
  echo warning: shortcut creation failed. The launcher is still available at %PREFIX%\inb4doc.cmd
)
exit /b 0

:remove_shortcuts
call :write_shortcuts_script
if errorlevel 1 exit /b 0
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" "%PREFIX%" remove
exit /b 0

:write_shortcuts_script
set "PS_SCRIPT=%TEMP%\inb4doc-shortcuts.ps1"
> "%PS_SCRIPT%" echo $ErrorActionPreference = 'Stop'
>>"%PS_SCRIPT%" echo $wsh = New-Object -ComObject WScript.Shell
>>"%PS_SCRIPT%" echo $p = $args[0]
>>"%PS_SCRIPT%" echo $mode = $args[1]
>>"%PS_SCRIPT%" echo $apps = [Environment]::GetFolderPath('Programs')
>>"%PS_SCRIPT%" echo $desk = [Environment]::GetFolderPath('Desktop')
>>"%PS_SCRIPT%" echo foreach ($dir in @($apps, $desk)) {
>>"%PS_SCRIPT%" echo   $lnkPath = Join-Path $dir 'inb4doc.lnk'
>>"%PS_SCRIPT%" echo   if ($mode -eq 'remove') {
>>"%PS_SCRIPT%" echo     if (Test-Path $lnkPath) { Remove-Item $lnkPath -Force }
>>"%PS_SCRIPT%" echo     continue
>>"%PS_SCRIPT%" echo   }
>>"%PS_SCRIPT%" echo   $lnk = $wsh.CreateShortcut($lnkPath)
>>"%PS_SCRIPT%" echo   $lnk.TargetPath = Join-Path $p 'inb4doc.cmd'
>>"%PS_SCRIPT%" echo   $lnk.WorkingDirectory = $p
>>"%PS_SCRIPT%" echo   $lnk.IconLocation = (Join-Path $p 'bin\inb4doc-gui.exe') + ',0'
>>"%PS_SCRIPT%" echo   $lnk.Description = 'inb4doc - local-first Markdown editor'
>>"%PS_SCRIPT%" echo   $lnk.Save()
>>"%PS_SCRIPT%" echo }
exit /b 0

rem ===========================================================================
:uninstall
echo Uninstalling inb4doc
call :remove_shortcuts
set /p "CONFIRM=Delete %PREFIX% and all its contents? [y/N] "
if /i "%CONFIRM%"=="y" (
  rmdir /s /q "%PREFIX%"
  echo Removed %PREFIX%.
) else (
  echo Skipped deleting %PREFIX%.
)
exit /b 0

rem ===========================================================================
:verify
if not exist "%PREFIX%\bin\inb4doc-gui.exe" (
  echo FAIL: %PREFIX%\bin\inb4doc-gui.exe missing
  exit /b 1
)
if not exist "%PREFIX%\editor\index.html" (
  echo FAIL: %PREFIX%\editor\index.html missing
  exit /b 1
)
echo OK: binary and thin-shell editor present.
if "%VERIFY%"=="1" (
  echo Starting inb4doc... after ~30s check %APPDATA%\inb4doc\JsStaticFs for the live editor.
  start "" "%PREFIX%\bin\inb4doc-gui.exe"
) else (
  echo Launch with: %PREFIX%\bin\inb4doc-gui.exe
)
exit /b 0
