// ============================================================
// File Transfer Assistant - Client Application
// ============================================================

// Application state
const AppState = {
    peerId: '',
    peerName: '',
    adminPassword: '',
    serverUrl: '',
    connectedPeers: new Set(),
    isBlocked: false,
    pollingActive: false,
    fileSendItems: [],
    fileReceiveItems: [],
    textHistory: [],
    adminLoggedIn: false,
    adminPeersRefreshTimer: null,
    version: 4
};

// ============================================================
// Initialization
// ============================================================

function init() {
    let storedId = localStorage.getItem('ft_peer_id');
    if (storedId) {
        AppState.peerId = storedId;
    } else {
        AppState.peerId = generateId(4);
        localStorage.setItem('ft_peer_id', AppState.peerId);
    }

    let storedName = localStorage.getItem('ft_peer_name');
    if (storedName) {
        AppState.peerName = storedName;
        document.getElementById('deviceNameInput').value = storedName;
        updateMobileDeviceName(storedName);
    }

    AppState.serverUrl = window.location.origin;

    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const tab = this.dataset.tab;
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            document.getElementById('tab-' + tab).classList.add('active');
        });
    });

    const textInput = document.getElementById('textInput');
    textInput.addEventListener('input', function() {
        document.getElementById('sendTextBtn').disabled = this.value.trim() === '';
    });

document.getElementById('fileInput').addEventListener('change', handleFileInput);
    document.getElementById('fileInputSingle').addEventListener('change', handleFileInput);

    const dropZone = document.getElementById('dropZone');
    dropZone.addEventListener('dragover', function(e) {
        e.preventDefault();
        this.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', function(e) {
        e.preventDefault();
        this.classList.remove('drag-over');
    });
    dropZone.addEventListener('drop', handleDrop);
    document.getElementById('adminPasswordInput').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') adminLogin();
    });

    // 检测是否为移动/触屏设备
    if (isMobileDevice()) {
        document.body.classList.add('mobile-device');
    }

    registerDevice();
    setInterval(registerDevice, 5000);
    startPolling();
    loadTextHistoryFromServer();
}

// ============================================================
// Mobile Sidebar Toggle
// ============================================================

function toggleMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (!overlay) {
        const div = document.createElement('div');
        div.id = 'sidebarOverlay';
        div.className = 'sidebar-overlay';
        div.addEventListener('click', toggleMobileSidebar);
        document.body.appendChild(div);
    }
    sidebar.classList.toggle('open');
    const ov = document.getElementById('sidebarOverlay');
    if (ov) ov.classList.toggle('show');
}

function updateMobileDeviceName(name) {
    const el = document.getElementById('mobileDeviceName');
    if (el) el.textContent = name || '未命名设备';
}

function updateMobileStatus(connected) {
    const dot = document.getElementById('mobileStatusDot');
    if (dot) {
        dot.className = 'mobile-status ' + (connected ? 'online' : 'disconnected');
    }
}

function isMobileDevice() {
    // 检测触摸能力 + 窄屏幕，或常见的移动端 UA
    const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const isNarrow = window.innerWidth <= 1024;
    const mobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent);
    // 触屏 + 窄屏 或 明确的移动端 UA 都视为移动设备
    return (hasTouch && isNarrow) || mobileUA;
}

function generateId(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function showToast(message, type = 'info') {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px;';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.style.cssText = 'padding:12px 24px;border-radius:8px;color:#fff;font-size:14px;min-width:200px;box-shadow:0 4px 12px rgba(0,0,0,.3);word-break:break-word;';
    if (type === 'error') toast.style.background = '#e74c3c';
    else if (type === 'warning') toast.style.background = '#f39c12';
    else if (type === 'success') toast.style.background = '#2ecc71';
    else toast.style.background = '#3498db';
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity .3s';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ============================================================
// Device Registration & Connection
// ============================================================

async function registerDevice() {
    try {
        const name = document.getElementById('deviceNameInput').value.trim() || AppState.peerName;
        const resp = await fetch(AppState.serverUrl + '/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ peer_id: AppState.peerId, name: name })
        });
        const data = await resp.json();

        if (data.name) AppState.peerName = data.name;
        if (data.blocked !== undefined) {
            AppState.isBlocked = data.blocked;
            const warning = document.getElementById('blockedWarning');
            if (data.blocked) {
                warning.style.display = 'flex';
                document.getElementById('blockedReason').textContent = data.blocked_reason || '';
            } else {
                warning.style.display = 'none';
            }
        }
        updateConnectionStatus(data.peer_count || 0);
        updateConnectedPeers();
        refreshPeerList();
    } catch (e) { /* ignore */ }
}

async function updateConnectedPeers() {
    try {
        const resp = await fetch(AppState.serverUrl + '/api/peers');
        const data = await resp.json();
        AppState.connectedPeers.clear();
        for (const peer of data.peers) {
            if (peer.id !== AppState.peerId && !peer.is_server) {
                AppState.connectedPeers.add(peer.id);
            }
        }
    } catch (e) { /* ignore */ }
}

function updateConnectionStatus(peerCount) {
    updateMobileStatus(peerCount > 0);
    const statusEl = document.getElementById('connectionStatus');
    const dot = statusEl.querySelector('.dot');
    const label = statusEl.querySelector('.label');
    const otherPeers = peerCount - 2 < 0 ? 0 : peerCount - 2;
    if (peerCount === 0) {
        dot.className = 'dot disconnected';
        statusEl.className = 'status-indicator disconnected';
        label.textContent = '未连接';
    } else if (otherPeers > 0) {
        dot.className = 'dot online';
        statusEl.className = 'status-indicator connected';
        label.textContent = '已连接';
    } else {
        dot.className = 'dot online';
        statusEl.className = 'status-indicator connected';
        label.textContent = '在线';
    }
}

async function refreshPeerList() {
    try {
        const resp = await fetch(AppState.serverUrl + '/api/peers');
        const data = await resp.json();
        const container = document.getElementById('peerListContainer');
        const peers = (data.peers || []).filter(function(p) { return p.id !== AppState.peerId && !p.is_server; });
        if (peers.length === 0) {
            container.innerHTML = '<div class="peer-item empty">暂无其他设备</div>';
            return;
        }
        var html = '';
        for (var i = 0; i < peers.length; i++) {
            var peer = peers[i];
            var statusIcon = peer.blocked ? '🔴' : '🟢';
            html += '<div class="peer-item"><span class="peer-status">' + statusIcon + '</span><div class="peer-info"><div class="peer-name">' + escapeHtml(peer.name || 'Unknown') + '</div><div class="peer-ip">' + (peer.ip || '') + '</div></div></div>';
        }
        container.innerHTML = html;
    } catch (e) { /* ignore */ }
}

function saveDeviceName() {
    var name = document.getElementById('deviceNameInput').value.trim();
    if (!name) { showToast('请输入设备名称', 'warning'); return; }
    AppState.peerName = name;
    localStorage.setItem('ft_peer_name', name);
    updateMobileDeviceName(name);
    showToast('设备名称已保存', 'success');
}

// ============================================================
// Message Polling
// ============================================================

function startPolling() { AppState.pollingActive = true; pollMessages(); }
function stopPolling() { AppState.pollingActive = false; }

async function pollMessages() {
    if (!AppState.pollingActive) return;
    try {
        var resp = await fetch(AppState.serverUrl + '/signal?peer_id=' + encodeURIComponent(AppState.peerId));
        var data = await resp.json();
        if (data.messages && data.messages.length > 0) {
            for (var i = 0; i < data.messages.length; i++) {
                handleIncomingMessage(data.messages[i]);
            }
        }
    } catch (e) { /* ignore */ }
    setTimeout(pollMessages, 500);
}

async function sendMessage(targetPeerId, msgData) {
    try {
        var resp = await fetch(AppState.serverUrl + '/signal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: AppState.peerId, to: targetPeerId, data: msgData })
        });
        var result = await resp.json();
        if (result.blocked) {
            showToast('您已被阻止，无法发送消息', 'error');
        }
    } catch (e) {
        showToast('发送失败：' + e.message, 'error');
    }
}

// ============================================================
// Message Handling
// ============================================================

function handleIncomingMessage(msg) {
    if (msg.type === 'text') {
        addTextHistory(msg.text, 'received', msg.fromName || 'Unknown');
    } else if (msg.type === 'file_offer') {
        handleFileOffer(msg);
    } else if (msg.type === 'file_chunk') {
        handleFileChunk(msg);
    } else if (msg.type === 'file_complete') {
        handleFileComplete(msg);
    }
}

// ============================================================
// File Send
// ============================================================

function handleFileInput(e) {
    var files = e.target.files;
    for (var i = 0; i < files.length; i++) {
        var file = files[i];
        var relativePath = file.webkitRelativePath || file.name;
        addFileToList(file, relativePath);
    }
    e.target.value = '';
}

async function handleDrop(e) {
    e.preventDefault();
    document.getElementById('dropZone').classList.remove('drag-over');
    var items = e.dataTransfer.items;
    if (!items) return;
    var fileEntries = [];

    async function traverseEntry(entry, path) {
        if (!path) path = '';
        if (entry.isFile) {
            var file = await new Promise(function(resolve) { entry.file(resolve); });
            fileEntries.push({ file: file, path: path + file.name });
        } else if (entry.isDirectory) {
            var reader = entry.createReader();
            var entries = await new Promise(function(resolve) { reader.readEntries(resolve); });
            for (var e = 0; e < entries.length; e++) {
                await traverseEntry(entries[e], path + entry.name + '/');
            }
        }
    }

    for (var i = 0; i < items.length; i++) {
        var entry = items[i].webkitGetAsEntry();
        if (entry) await traverseEntry(entry, '');
    }

    for (var i = 0; i < fileEntries.length; i++) {
        await addFileToList(fileEntries[i].file, fileEntries[i].path);
    }
}

async function addFileToList(file, relativePath) {
    var buffer = await file.arrayBuffer();
    AppState.fileSendItems.push({
        name: file.name,
        size: file.size,
        type: file.type,
        relativePath: relativePath,
        data: buffer
    });
    renderFileSendList();
    updateSendButtonState();
}

function removeFileSendItem(index) {
    AppState.fileSendItems.splice(index, 1);
    renderFileSendList();
    updateSendButtonState();
}

function clearFileSendList() {
    AppState.fileSendItems = [];
    renderFileSendList();
    updateSendButtonState();
}

function updateSendButtonState() {
    document.getElementById('sendFilesBtn').disabled = AppState.fileSendItems.length === 0 || AppState.isBlocked;
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB'];
    var i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
}

function renderFileSendList() {
    var container = document.getElementById('fileSendList');
    if (AppState.fileSendItems.length === 0) {
        container.innerHTML = '<div class="empty-hint">尚未添加文件</div>';
        return;
    }
    var html = '';
    var dirs = {};
    for (var i = 0; i < AppState.fileSendItems.length; i++) {
        var item = AppState.fileSendItems[i];
        var parts = item.relativePath.split('/');
        if (parts.length > 1) {
            var dir = parts[0];
            if (!dirs[dir]) dirs[dir] = [];
            dirs[dir].push(item);
        } else {
            if (!dirs.__files__) dirs.__files__ = [];
            dirs.__files__.push(item);
        }
    }
    for (var dir in dirs) {
        if (dirs.hasOwnProperty(dir)) {
            var items = dirs[dir];
            if (dir === '__files__') {
                for (var j = 0; j < items.length; j++) {
                    var item = items[j];
                    var idx = AppState.fileSendItems.indexOf(item);
                    html += '<div class="file-item"><span class="file-icon">📄</span><div class="file-info"><div class="file-name">' + escapeHtml(item.name) + '</div><div class="file-size">' + formatFileSize(item.size) + '</div></div><button class="remove-btn" onclick="removeFileSendItem(' + idx + ')">✕</button></div>';
                }
            } else {
                html += '<div class="file-item folder"><span class="file-icon">📁</span><div class="file-info"><div class="file-name">' + escapeHtml(dir) + '/</div><div class="file-size">' + items.length + ' 个文件</div></div></div>';
                for (var j = 0; j < items.length; j++) {
                    var item = items[j];
                    var idx = AppState.fileSendItems.indexOf(item);
                    html += '<div class="file-item sub-file"><span class="file-icon">📄</span><div class="file-info"><div class="file-name">' + escapeHtml(item.name) + '</div><div class="file-size">' + formatFileSize(item.size) + '</div></div><button class="remove-btn" onclick="removeFileSendItem(' + idx + ')">✕</button></div>';
                }
            }
        }
    }
    container.innerHTML = html;
}

// ============================================================
// File Send via Signaling
// ============================================================

async function sendFiles() {
    if (AppState.fileSendItems.length === 0) {
        showToast('没有文件可发送', 'warning');
        return;
    }
    if (AppState.connectedPeers.size === 0) {
        showToast('没有已连接的设备', 'error');
        return;
    }
    showToast('正在发送文件...', 'info');

    for (var fi = 0; fi < AppState.fileSendItems.length; fi++) {
        var fileItem = AppState.fileSendItems[fi];
        var chunkSize = 256 * 1024;
        var totalChunks = Math.ceil(fileItem.data.byteLength / chunkSize);
        var fileId = generateId(8);

        var peerIds = Array.from(AppState.connectedPeers);
        for (var pi = 0; pi < peerIds.length; pi++) {
            await sendMessage(peerIds[pi], { type: 'file_offer', from: AppState.peerId, fromName: AppState.peerName, fileId: fileId, fileName: fileItem.relativePath, fileSize: fileItem.size, totalChunks: totalChunks });
        }

        for (var ci = 0; ci < totalChunks; ci++) {
            var start = ci * chunkSize;
            var end = Math.min(start + chunkSize, fileItem.data.byteLength);
            var chunk = fileItem.data.slice(start, end);
            var bytes = new Uint8Array(chunk);
            var binary = '';
            for (var bj = 0; bj < bytes.length; bj++) {
                binary += String.fromCharCode(bytes[bj]);
            }
            var base64Data = btoa(binary);

            for (var pi = 0; pi < peerIds.length; pi++) {
                await sendMessage(peerIds[pi], { type: 'file_chunk', from: AppState.peerId, fileId: fileId, chunkIndex: ci, totalChunks: totalChunks, data: base64Data });
            }
            if (ci % 10 === 0) {
                await new Promise(function(r) { setTimeout(r, 10); });
            }
        }

        for (var pi = 0; pi < peerIds.length; pi++) {
            await sendMessage(peerIds[pi], { type: 'file_complete', from: AppState.peerId, fromName: AppState.peerName, fileId: fileId, fileName: fileItem.relativePath, fileSize: fileItem.size });
        }
    }

    showToast('文件发送完成', 'success');
    clearFileSendList();
}

// ============================================================
// File Receive
// ============================================================

var fileReceiveBuffers = {};

function handleFileOffer(msg) {
    fileReceiveBuffers[msg.fileId] = {
        name: msg.fileName, size: msg.fileSize, totalChunks: msg.totalChunks, chunks: {}, from: msg.fromName || msg.from
    };
    var existing = AppState.fileReceiveItems.findIndex(function(item) {
        return item.fileId === msg.fileId || (item.name === msg.fileName && item.size === msg.fileSize);
    });
    if (existing === -1) {
        AppState.fileReceiveItems.push({
            fileId: msg.fileId, name: msg.fileName, size: msg.fileSize, totalChunks: msg.totalChunks,
            receivedChunks: 0, from: msg.fromName || msg.from, expanded: false, selected: true,
            folderMode: msg.fileName.indexOf('/') >= 0
        });
        renderFileReceiveList();
    }
}

function handleFileChunk(msg) {
    var buffer = fileReceiveBuffers[msg.fileId];
    if (!buffer) return;
    buffer.chunks[msg.chunkIndex] = msg.data;
    buffer.receivedCount = (buffer.receivedCount || 0) + 1;
    var item = AppState.fileReceiveItems.find(function(i) { return i.fileId === msg.fileId; });
    if (item) {
        item.receivedChunks = buffer.receivedCount || Object.keys(buffer.chunks).length;
        renderFileReceiveList();
    }
}

function handleFileComplete(msg) {
    var buffer = fileReceiveBuffers[msg.fileId];
    if (!buffer) return;
    var item = AppState.fileReceiveItems.find(function(i) { return i.fileId === msg.fileId; });
    if (item) { item.complete = true; renderFileReceiveList(); }
}

function toggleFileSelection(fileId) {
    var item = AppState.fileReceiveItems.find(function(i) { return i.fileId === fileId; });
    if (item) { item.selected = !item.selected; renderFileReceiveList(); updateDownloadButtonState(); }
}

function updateDownloadButtonState() {
    var hasSelected = AppState.fileReceiveItems.some(function(i) { return i.selected; });
    document.getElementById('downloadSelectedBtn').disabled = !hasSelected;
}

function clearFileReceiveList() {
    AppState.fileReceiveItems = [];
    fileReceiveBuffers = {};
    renderFileReceiveList();
    updateDownloadButtonState();
}

function renderFileReceiveList() {
    var container = document.getElementById('fileReceiveList');
    if (AppState.fileReceiveItems.length === 0) {
        container.innerHTML = '<div class="empty-hint">等待接收文件...</div>';
        return;
    }
    var folders = {};
    var rootFiles = [];
    for (var i = 0; i < AppState.fileReceiveItems.length; i++) {
        var item = AppState.fileReceiveItems[i];
        var parts = item.name.split('/');
        if (parts.length > 1) {
            var folderName = parts[0];
            if (!folders[folderName]) folders[folderName] = { fileId: generateId(8) + '_folder', name: folderName + '/', items: [] };
            folders[folderName].items.push(item);
        } else {
            rootFiles.push(item);
        }
    }

    var html = '';
    for (var ri = 0; ri < rootFiles.length; ri++) {
        html += renderFileItemHtml(rootFiles[ri]);
    }

    for (var folderName in folders) {
        if (folders.hasOwnProperty(folderName)) {
            var folder = folders[folderName];
            var allSelected = folder.items.every(function(f) { return f.selected; });
            var someSelected = folder.items.some(function(f) { return f.selected; });
            var allComplete = folder.items.every(function(f) { return f.complete; });
            var totalProgress = 0;
            if (folder.items.length > 0) {
                var sum = 0;
                for (var si = 0; si < folder.items.length; si++) {
                    var f = folder.items[si];
                    sum += f.complete ? 100 : Math.round((f.receivedChunks / f.totalChunks) * 100);
                }
                totalProgress = Math.round(sum / folder.items.length);
            }

            html += '<div class="file-item folder">';
            html += '<label class="checkbox-label"><input type="checkbox" ' + (allSelected ? 'checked' : '') + ' onchange="toggleFolderSelection(\'' + escapeAttr(folderName) + '\', this.checked)"><span class="checkbox-custom' + (someSelected && !allSelected ? ' partial' : '') + '"></span></label>';
            html += '<span class="file-icon folder-toggle" onclick="toggleFolderExpand(\'' + escapeAttr(folderName) + '\')">📁</span>';
            html += '<div class="file-info"><div class="file-name">' + escapeHtml(folderName) + '/</div><div class="file-size">' + folder.items.length + ' 个文件</div>';
            html += '<div class="progress-bar"><div class="progress-fill ' + (allComplete ? 'complete' : '') + '" style="width:' + totalProgress + '%"></div><span>' + totalProgress + '%</span></div></div></div>';

            for (var si = 0; si < folder.items.length; si++) {
                html += renderFileItemHtml(folder.items[si], 'sub-file');
            }
        }
    }
    container.innerHTML = html;
    updateDownloadButtonState();
}

function renderFileItemHtml(item, extraClass) {
    if (!extraClass) extraClass = '';
    var progress = item.totalChunks > 0 ? Math.round((item.receivedChunks / item.totalChunks) * 100) : 0;
    var isComplete = item.complete || progress >= 100;
    var progressHtml = isComplete
        ? '<div class="progress-bar"><div class="progress-fill complete" style="width:100%"></div><span>✅ 已完成</span></div>'
        : '<div class="progress-bar"><div class="progress-fill" style="width:' + progress + '%"></div><span>' + progress + '%</span></div>';

    return '<div class="file-item ' + extraClass + '"><label class="checkbox-label"><input type="checkbox" ' + (item.selected ? 'checked' : '') + ' data-fileid="' + escapeAttr(item.fileId) + '" onchange="toggleFileSelection(this.dataset.fileid)"><span class="checkbox-custom"></span></label><span class="file-icon">📄</span><div class="file-info"><div class="file-name">' + escapeHtml(item.name.split('/').pop()) + '</div><div class="file-size">' + formatFileSize(item.size) + ' | 来自 ' + escapeHtml(item.from || 'Unknown') + '</div>' + progressHtml + '</div></div>';
}

function toggleFolderExpand(folderName) {
    var container = document.getElementById('fileReceiveList');
    var folderDiv = container.querySelector('.file-item.folder');
    if (folderDiv) {
        var isExpanded = folderDiv.classList.toggle('expanded');
        folderDiv.querySelector('.file-icon').textContent = isExpanded ? '📂' : '📁';
        var next = folderDiv.nextElementSibling;
        while (next && next.classList.contains('sub-file')) {
            next.style.display = isExpanded ? '' : 'none';
            next = next.nextElementSibling;
        }
    }
}

function toggleFolderSelection(folderName, checked) {
    for (var i = 0; i < AppState.fileReceiveItems.length; i++) {
        var item = AppState.fileReceiveItems[i];
        if (item.name.indexOf(folderName + '/') === 0) {
            item.selected = checked;
        }
    }
    renderFileReceiveList();
}

async function downloadSelectedFiles() {
    var selected = AppState.fileReceiveItems.filter(function(i) { return i.selected && i.complete; });
    if (selected.length === 0) {
        showToast('请选择已完成下载的文件', 'warning');
        return;
    }
    for (var di = 0; di < selected.length; di++) {
        var item = selected[di];
        var buffer = fileReceiveBuffers[item.fileId];
        if (!buffer) continue;
        try {
            var chunks = [];
            for (var ci = 0; ci < item.totalChunks; ci++) {
                if (buffer.chunks[ci]) {
                    var binaryStr = atob(buffer.chunks[ci]);
                    var bytes = new Uint8Array(binaryStr.length);
                    for (var bj = 0; bj < binaryStr.length; bj++) {
                        bytes[bj] = binaryStr.charCodeAt(bj);
                    }
                    chunks.push(bytes);
                }
            }
            var blob = new Blob(chunks);
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            var fileName = item.name.split('/').pop();
            a.href = url;
            a.download = fileName;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            showToast('下载失败: ' + e.message, 'error');
        }
    }
}

// ============================================================
// Text Transfer
// ============================================================

async function sendText() {
    if (AppState.isBlocked) {
        showToast('设备已被阻止，无法发送文字', 'error');
        return;
    }
    var textarea = document.getElementById('textInput');
    var text = textarea.value.trim();
    if (!text) { showToast('请输入要发送的文字', 'warning'); return; }

    var peers = await getConnectedPeers();
    if (peers.length === 0) { showToast('没有已连接的设备', 'error'); return; }

    addTextHistory(text, 'sent', AppState.peerName || 'Me');
    for (var pi = 0; pi < peers.length; pi++) {
        await sendMessage(peers[pi].id, { type: 'text', from: AppState.peerId, fromName: AppState.peerName, text: text });
    }
    textarea.value = '';
    document.getElementById('sendTextBtn').disabled = true;
    showToast('文字已发送', 'success');
}

async function getConnectedPeers() {
    try {
        var resp = await fetch(AppState.serverUrl + '/api/peers');
        var data = await resp.json();
        return data.peers.filter(function(p) { return p.id !== AppState.peerId && !p.is_server; });
    } catch (e) { return []; }
}

// ============================================================
// Text History
// ============================================================

// ============================================================
// Server-Based Text History (shared across all devices)
// ============================================================

async function loadTextHistoryFromServer() {
    try {
        var resp = await fetch(AppState.serverUrl + '/api/text_history');
        var data = await resp.json();
        if (data.history) {
            AppState.textHistory = data.history;
            renderTextHistory();
        }
    } catch (e) {
        // fallback: local only
    }
}

async function addTextHistory(text, type, fromName) {
    var entry = {
        id: Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        text: text,
        type: type,
        fromName: fromName || '',
        time: Date.now()
    };
    AppState.textHistory.push(entry);
    if (AppState.textHistory.length > 200) AppState.textHistory = AppState.textHistory.slice(-200);
    renderTextHistory();
    // Sync to server
    try {
        await fetch(AppState.serverUrl + '/api/text_history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entry: entry })
        });
    } catch (e) {
        // ignore server sync failure
    }
}

async function clearTextHistory() {
    // Delete all entries one by one on server
    var idsToDelete = AppState.textHistory.map(function(e) { return e.id; });
    for (var i = 0; i < idsToDelete.length; i++) {
        try {
            await fetch(AppState.serverUrl + '/api/text_history/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: idsToDelete[i] })
            });
        } catch (e) {}
    }
    AppState.textHistory = [];
    renderTextHistory();
}

async function deleteTextEntry(id) {
    // Delete from server
    try {
        var resp = await fetch(AppState.serverUrl + '/api/text_history/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: id })
        });
        var data = await resp.json();
        if (data.history) {
            AppState.textHistory = data.history;
        } else {
            AppState.textHistory = AppState.textHistory.filter(function(e) { return e.id !== id; });
        }
    } catch (e) {
        AppState.textHistory = AppState.textHistory.filter(function(e) { return e.id !== id; });
    }
    renderTextHistory();
    showToast('已删除该条历史', 'info');
}

function copyTextToClipboard(text) {
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).catch(function() {
                fallbackCopy(text);
            });
        } else {
            fallbackCopy(text);
        }
    } catch (e) {
        fallbackCopy(text);
    }
}

function fallbackCopy(text) {
    var textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
    } catch (e) {
        // ignore
    }
    document.body.removeChild(textarea);
}

function renderTextHistory() {
    var container = document.getElementById('textHistory');
    if (AppState.textHistory.length === 0) {
        container.innerHTML = '<div class="empty-hint">暂无历史记录</div>';
        return;
    }
    var html = '';
    for (var i = AppState.textHistory.length - 1; i >= 0; i--) {
        var entry = AppState.textHistory[i];
        var timeStr = new Date(entry.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        var isSent = entry.type === 'sent';
        html += '<div class="text-entry ' + (isSent ? 'sent' : 'received') + '" data-id="' + escapeAttr(entry.id) + '">';
        html += '<div class="text-entry-header"><span class="text-from">' + escapeHtml(entry.fromName || (isSent ? '我' : '对方')) + '</span><span class="text-time">' + timeStr + '</span><button class="delete-text-btn" onclick="event.stopPropagation();deleteTextEntry(\'' + escapeAttr(entry.id) + '\')" title="删除此条">🗑️</button></div>';
        html += '<div class="text-entry-content" onclick="copyTextEntry(\'' + escapeAttr(entry.id) + '\')">' + escapeHtml(entry.text).replace(/\n/g, '<br>') + '</div></div>';
    }
    container.innerHTML = html;
    container.scrollTop = 0;
}

function copyTextEntry(id) {
    var entry = AppState.textHistory.find(function(e) { return e.id === id; });
    if (entry) {
        copyTextToClipboard(entry.text);
        showToast('✅ 已复制到剪贴板', 'success');
        // 添加闪烁反馈
        var el = document.querySelector('.text-entry[data-id="' + id.replace(/"/g, '\\"') + '"]');
        if (el) {
            el.classList.add('copied');
            setTimeout(function() { el.classList.remove('copied'); }, 600);
        }
    }
}

// ============================================================
// Admin Panel
// ============================================================

function adminLogin() {
    var password = document.getElementById('adminPasswordInput').value.trim();
    var errorEl = document.getElementById('adminError');
    if (!password) { errorEl.textContent = '请输入密码'; errorEl.style.display = 'block'; return; }

    fetch(AppState.serverUrl + '/api/verify?password=' + encodeURIComponent(password))
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.valid) {
                AppState.adminPassword = password;
                AppState.adminLoggedIn = true;
                document.getElementById('adminLoginForm').style.display = 'none';
                document.getElementById('adminPanel').style.display = 'block';
                loadAdminPanel();
                startAdminRefresh();
                showToast('登录成功', 'success');
            } else {
                errorEl.textContent = '密码错误';
                errorEl.style.display = 'block';
            }
        })
        .catch(function() {
            errorEl.textContent = '连接服务器失败';
            errorEl.style.display = 'block';
        });
}

function startAdminRefresh() {
    if (AppState.adminPeersRefreshTimer) clearInterval(AppState.adminPeersRefreshTimer);
    AppState.adminPeersRefreshTimer = setInterval(loadAdminPeers, 3000);
    if (AppState.adminWhitelistRefreshTimer) clearInterval(AppState.adminWhitelistRefreshTimer);
    AppState.adminWhitelistRefreshTimer = setInterval(loadWhitelistSettings, 3000);
}

function stopAdminRefresh() {
    if (AppState.adminPeersRefreshTimer) { clearInterval(AppState.adminPeersRefreshTimer); AppState.adminPeersRefreshTimer = null; }
    if (AppState.adminWhitelistRefreshTimer) { clearInterval(AppState.adminWhitelistRefreshTimer); AppState.adminWhitelistRefreshTimer = null; }
}

async function loadAdminPanel() {
    loadWhitelistSettings();
    loadAdminPeers();
}

// ============================================================
// Whitelist Management
// ============================================================

async function loadWhitelistSettings() {
    if (!AppState.adminPassword) return;
    try {
        var resp = await fetch(AppState.serverUrl + '/api/whitelist?password=' + encodeURIComponent(AppState.adminPassword));
        var data = await resp.json();
        if (data && data.enabled !== undefined) {
            document.getElementById('whitelistToggle').checked = data.enabled;
            renderWhitelistIps(data.ips || []);
        }
    } catch (e) { /* ignore */ }
}

async function toggleWhitelist() {
    if (!AppState.adminPassword) return;
    var enabled = document.getElementById('whitelistToggle').checked;
    try {
        var resp = await fetch(AppState.serverUrl + '/api/whitelist?password=' + encodeURIComponent(AppState.adminPassword));
        var data = await resp.json();
        var currentIps = data.ips || [];
        var updateResp = await fetch(AppState.serverUrl + '/api/whitelist', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: AppState.adminPassword, enabled: enabled, ips: currentIps })
        });
        var result = await updateResp.json();
        if (result.status === 'ok') {
            renderWhitelistIps(result.ips || []);
            showToast(enabled ? '白名单已启用' : '白名单已关闭', 'success');
        }
    } catch (e) { showToast('操作失败', 'error'); document.getElementById('whitelistToggle').checked = !enabled; }
}

async function addWhitelistIp() {
    var input = document.getElementById('whitelistIpInput');
    var ip = input.value.trim();
    if (!ip) { showToast('请输入IP地址', 'warning'); return; }
    try {
        var resp = await fetch(AppState.serverUrl + '/api/whitelist?password=' + encodeURIComponent(AppState.adminPassword));
        var data = await resp.json();
        var ips = data.ips || [];
        if (ips.indexOf(ip) >= 0) { showToast('该IP已在白名单中', 'warning'); return; }
        ips.push(ip);
        var updateResp = await fetch(AppState.serverUrl + '/api/whitelist', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: AppState.adminPassword, ips: ips })
        });
        var result = await updateResp.json();
        if (result.status === 'ok') {
            renderWhitelistIps(result.ips || []);
            input.value = '';
            showToast('已添加IP: ' + ip, 'success');
        } else { showToast('添加失败', 'error'); }
    } catch (e) { showToast('操作失败: ' + e.message, 'error'); }
}

async function removeWhitelistIp(ip) {
    try {
        var resp = await fetch(AppState.serverUrl + '/api/whitelist?password=' + encodeURIComponent(AppState.adminPassword));
        var data = await resp.json();
        var ips = data.ips || [];
        var idx = ips.indexOf(ip);
        if (idx < 0) { showToast('该IP不在白名单中', 'warning'); return; }
        ips.splice(idx, 1);
        var updateResp = await fetch(AppState.serverUrl + '/api/whitelist', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: AppState.adminPassword, ips: ips })
        });
        var result = await updateResp.json();
        if (result.status === 'ok') {
            renderWhitelistIps(result.ips || []);
            showToast('已移除IP: ' + ip, 'success');
        } else { showToast('移除失败', 'error'); }
    } catch (e) { showToast('操作失败: ' + e.message, 'error'); }
}

function renderWhitelistIps(ips) {
    var container = document.getElementById('whitelistIps');
    if (!ips || ips.length === 0) {
        container.innerHTML = '<div class="whitelist-tag" style="color:var(--text-secondary);background:var(--bg);border-style:dashed;">暂无白名单IP</div>';
        return;
    }
    var html = '';
    for (var i = 0; i < ips.length; i++) {
        html += '<div class="whitelist-tag"><span>' + escapeHtml(ips[i]) + '</span><button class="remove-tag-btn" onclick="removeWhitelistIp(\'' + escapeAttr(ips[i]) + '\')">×</button></div>';
    }
    container.innerHTML = html;
}

// ============================================================
// Admin Peer Management
// ============================================================

async function loadAdminPeers() {
    if (!AppState.adminPassword) return;
    try {
        var resp = await fetch(AppState.serverUrl + '/api/peers');
        var data = await resp.json();
        renderAdminPeers(data.peers || []);
    } catch (e) { /* ignore */ }
}

function renderAdminPeers(peers) {
    var container = document.getElementById('adminDeviceList');
    if (!peers || peers.length === 0) {
        container.innerHTML = '<div class="empty-hint">暂无设备</div>';
        return;
    }
    var html = '<div class="admin-device-list">';
    for (var i = 0; i < peers.length; i++) {
        var peer = peers[i];
        var statusIcon = peer.blocked ? '🔴' : (peer.is_server ? '🟢' : '🟢');
        var tags = '';
        if (peer.is_server) { tags += '<span class="device-tag server-tag">服务器</span>'; }
        else if (peer.blocked) { tags += '<span class="device-tag blocked-tag">已阻止</span>'; }
        else if (peer.online) { tags += '<span class="device-tag online-tag">在线</span>'; }

        html += '<div class="admin-device-item">';
        html += '<span class="device-status-icon">' + statusIcon + '</span>';
        html += '<div class="device-info"><span class="device-name">' + escapeHtml(peer.name || 'Unknown') + '</span>';
        if (peer.ip) html += '<span class="device-ip">' + escapeHtml(peer.ip) + '</span>';
        html += tags + '</div>';
        if (!peer.is_server) {
            if (peer.blocked) {
                html += '<button class="kick-btn" onclick="unblockPeer(\'' + escapeAttr(peer.id) + '\')" title="取消阻止">✅</button>';
            } else {
                html += '<button class="kick-btn" onclick="blockPeer(\'' + escapeAttr(peer.id) + '\')" title="阻止连接">🚫</button>';
            }
        }
        html += '</div>';
    }
    html += '</div>';
    container.innerHTML = html;
}

async function blockPeer(peerId) {
    if (!AppState.adminPassword) return;
    try {
        var resp = await fetch(AppState.serverUrl + '/api/admin/block', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: AppState.adminPassword, peer_id: peerId })
        });
        var data = await resp.json();
        if (data.status === 'ok') {
            showToast('设备已被阻止', 'success');
            loadAdminPeers();
        } else { showToast('操作失败', 'error'); }
    } catch (e) { showToast('操作失败: ' + e.message, 'error'); }
}

async function unblockPeer(peerId) {
    if (!AppState.adminPassword) return;
    try {
        var resp = await fetch(AppState.serverUrl + '/api/admin/unblock', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: AppState.adminPassword, peer_id: peerId })
        });
        var data = await resp.json();
        if (data.status === 'ok') {
            showToast('设备已解除阻止', 'success');
            loadAdminPeers();
        } else { showToast('操作失败', 'error'); }
    } catch (e) { showToast('操作失败: ' + e.message, 'error'); }
}
// ============================================================
// Utility Functions
// ============================================================

function escapeHtml(str) {
    if (!str) return '';
    var s = String(str);
    var e = String.fromCharCode;
    s = s.split(e(38)).join(e(38,97,109,112,59));
    s = s.split(e(60)).join(e(38,108,116,59));
    s = s.split(e(62)).join(e(38,103,116,59));
    s = s.split(e(34)).join(e(38,113,117,111,116,59));
    s = s.split(e(39)).join(e(38,35,51,57,59));
    return s;
}

function escapeAttr(str) {
    if (!str) return '';
    var s = String(str);
    var e = String.fromCharCode;
    s = s.split(e(38)).join(e(38,97,109,112,59));
    s = s.split(e(34)).join(e(38,113,117,111,116,59));
    s = s.split(e(39)).join(e(38,35,51,57,59));
    s = s.split(e(60)).join(e(38,108,116,59));
    s = s.split(e(62)).join(e(38,103,116,59));
    return s;
}

// ============================================================
// Initialize on page load
// ============================================================

document.addEventListener('DOMContentLoaded', function() {
    init();
});

document.addEventListener('visibilitychange', function() {
    if (!document.hidden) {
        registerDevice();
        refreshPeerList();
    }
});

// ============================================================
// Polling control
// ============================================================

window.addEventListener('beforeunload', function() {
    stopPolling();
    stopAdminRefresh();
});
