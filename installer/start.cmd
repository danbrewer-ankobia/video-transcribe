@echo off
setlocal enableextensions enabledelayedexpansion

rem -- Resolve install dir (this file's directory, no trailing backslash) --
set "APP_INSTALL=%~dp0"
if "%APP_INSTALL:~-1%"=="\" set "APP_INSTALL=%APP_INSTALL:~0,-1%"

rem -- User-writable dir holds the hot-updatable parts: ui, server bundle, transcribe.py --
set "USER_APP=%LOCALAPPDATA%\VideoTranscribe\app"
if not exist "%USER_APP%\ui"     mkdir "%USER_APP%\ui" >nul 2>&1
if not exist "%USER_APP%\server" mkdir "%USER_APP%\server" >nul 2>&1

rem -- Find Edge for app-mode window (fall back to default browser if missing) --
set "EDGE="
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"      set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
set "APP_URL=http://localhost:3001"
set "EDGE_PROFILE=%USER_APP%\edge-profile"

rem -- If server is already running, just open another window and exit --
powershell -NoProfile -Command "try { (Invoke-WebRequest -Uri '%APP_URL%/api/version' -UseBasicParsing -TimeoutSec 1) ^| Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 (
  call :LaunchWindow
  exit /b 0
)

rem -- Apply any pending .new files from a prior /api/updates/install --
for /r "%USER_APP%" %%f in (*.new) do (
  set "NEW=%%f"
  set "TARGET=!NEW:.new=!"
  move /y "!NEW!" "!TARGET!" >nul 2>&1
)

rem -- Seed/refresh from the installed bundle when its version is newer (or files missing) --
call :SeedFromInstall

rem -- Production env vars --
set "NODE_ENV=production"
set "OPEN_BROWSER=0"
set "APP_ROOT=%APP_INSTALL%"
set "USER_APP=%USER_APP%"
set "PYTHON=%APP_INSTALL%\python\python.exe"
set "STATIC_DIR=%USER_APP%\ui"
set "TRANSCRIBE_SCRIPT=%USER_APP%\server\transcribe.py"
set "VERSION_FILE=%USER_APP%\version.txt"
set "HF_HOME=%APP_INSTALL%\models"
set "UPLOADS_DIR=%LOCALAPPDATA%\VideoTranscribe\uploads"
set "SETTINGS_FILE=%LOCALAPPDATA%\VideoTranscribe\settings.json"
set "PATH=%APP_INSTALL%\ffmpeg;%PATH%"

if exist "%APP_INSTALL%\config\hf_token.txt" (
  for /f "usebackq delims=" %%i in ("%APP_INSTALL%\config\hf_token.txt") do (
    set "HF_TOKEN=%%i"
    goto :tokendone
  )
)
:tokendone

if not exist "%UPLOADS_DIR%" mkdir "%UPLOADS_DIR%" >nul 2>&1

rem -- Launch the server in the background --
start "VideoTranscribeServer" /B "%APP_INSTALL%\node\node.exe" "%USER_APP%\server\index.mjs"

rem -- Wait for it to listen (up to ~30s) --
set TRIES=0
:waitserver
set /a TRIES+=1
powershell -NoProfile -Command "try { (Invoke-WebRequest -Uri '%APP_URL%/api/version' -UseBasicParsing -TimeoutSec 1) ^| Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
  if %TRIES% gtr 30 (
    echo Server failed to start within 30s.
    exit /b 1
  )
  timeout /t 1 /nobreak >nul
  goto :waitserver
)

call :LaunchWindow
exit /b 0

:LaunchWindow
if defined EDGE (
  rem Isolated Edge profile makes this a separate msedge.exe tree from the user's regular browsing.
  start "" "%EDGE%" --app=%APP_URL% --user-data-dir="%EDGE_PROFILE%" --window-size=1280,820 --no-first-run --no-default-browser-check --disable-default-apps
) else (
  start "" %APP_URL%
)
exit /b 0

:SeedFromInstall
set "INSTALL_VER="
set "USER_VER="
if exist "%APP_INSTALL%\version.txt" set /p INSTALL_VER=<"%APP_INSTALL%\version.txt"
if exist "%USER_APP%\version.txt"   set /p USER_VER=<"%USER_APP%\version.txt"

set "DO_SEED=0"
if not exist "%USER_APP%\version.txt" set "DO_SEED=1"
if not exist "%USER_APP%\server\index.mjs" set "DO_SEED=1"
if not exist "%USER_APP%\ui\index.html" set "DO_SEED=1"
if "%INSTALL_VER%" gtr "%USER_VER%" set "DO_SEED=1"

if "%DO_SEED%"=="1" (
  if exist "%APP_INSTALL%\ui"                   xcopy /e /y /i /q "%APP_INSTALL%\ui"              "%USER_APP%\ui" >nul
  if exist "%APP_INSTALL%\server\index.mjs"     copy /y "%APP_INSTALL%\server\index.mjs"          "%USER_APP%\server\index.mjs" >nul
  if exist "%APP_INSTALL%\server\transcribe.py" copy /y "%APP_INSTALL%\server\transcribe.py"      "%USER_APP%\server\transcribe.py" >nul
  if exist "%APP_INSTALL%\version.txt"          copy /y "%APP_INSTALL%\version.txt"               "%USER_APP%\version.txt" >nul
)
exit /b 0
