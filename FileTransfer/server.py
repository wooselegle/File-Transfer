#!/usr/bin/env python3
"""
File Transfer Assistant - Signaling & Discovery Server
Features: Device discovery, message relay, whitelist, admin API
Optional: tkinter GUI (falls back to console if unavailable)
"""

import http.server
import json
import socket
import threading
import time
import sys
import os
import random
import string
from urllib.parse import urlparse, parse_qs

import builtins

# Flush print output immediately
print = lambda *args, **kwargs: builtins.print(*args, **kwargs, flush=True)

HTTP_PORT = 8000

# Admin password file
ADMIN_PASSWORD_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'admin_password.txt')

def load_admin_password():
    """Load admin password from file, or generate random one"""
    try:
        if os.path.exists(ADMIN_PASSWORD_FILE):
            with open(ADMIN_PASSWORD_FILE, 'r', encoding='utf-8') as f:
                pwd = f.read().strip()
                if pwd and len(pwd) >= 4 and pwd.isdigit():
                    return pwd
    except:
        pass
    pwd = ''.join(random.choices(string.digits, k=4))
    save_admin_password(pwd)
    return pwd

def save_admin_password(pwd):
    """Save admin password to file"""
    try:
        with open(ADMIN_PASSWORD_FILE, 'w', encoding='utf-8') as f:
            f.write(pwd)
    except:
        pass

ADMIN_PASSWORD = load_admin_password()

# Online peers storage
online_peers = {}
peers_lock = threading.Lock()

# Pending messages
pending_messages = {}
messages_lock = threading.Lock()

# Whitelist (IP based)
WHITELIST_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'whitelist.json')
BLOCKED_IPS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'blocked_ips.json')
whitelist_enabled = False
whitelist_ips = set()
blocked_ips = set()
whitelist_lock = threading.Lock()
blocked_ips_lock = threading.Lock()

# GUI reference
_gui = None

# Text history file (persisted on server)
TEXT_HISTORY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'text_history.json')
text_history = []  # list of {id, text, type, fromName, time}
text_history_lock = threading.Lock()


def load_text_history():
    global text_history
    try:
        if os.path.exists(TEXT_HISTORY_FILE):
            with open(TEXT_HISTORY_FILE, 'r', encoding='utf-8') as f:
                text_history = json.load(f)
    except Exception as e:
        text_history = []


def save_text_history():
    global text_history
    try:
        with open(TEXT_HISTORY_FILE, 'w', encoding='utf-8') as f:
            json.dump(text_history, f, ensure_ascii=False, indent=2)
    except Exception as e:
        pass


def load_whitelist():
    global whitelist_enabled, whitelist_ips
    try:
        if os.path.exists(WHITELIST_FILE):
            with open(WHITELIST_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                whitelist_enabled = data.get('enabled', False)
                whitelist_ips = set(data.get('ips', []))
    except Exception as e:
        pass


def save_whitelist():
    global whitelist_enabled, whitelist_ips
    try:
        data = {
            'enabled': whitelist_enabled,
            'ips': sorted(list(whitelist_ips))
        }
        with open(WHITELIST_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        pass


def load_blocked_ips():
    global blocked_ips
    try:
        if os.path.exists(BLOCKED_IPS_FILE):
            with open(BLOCKED_IPS_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                blocked_ips = set(data.get('ips', []))
    except Exception as e:
        pass


def save_blocked_ips():
    global blocked_ips
    try:
        data = {'ips': sorted(list(blocked_ips))}
        with open(BLOCKED_IPS_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        pass


def get_local_ip():
    """Get local LAN IP address"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(1)
        s.connect(('192.168.1.1', 1))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except:
        pass
    try:
        hostname = socket.gethostname()
        for addr_info in socket.getaddrinfo(hostname, None):
            addr = addr_info[4][0]
            if addr.startswith('192.168.') or addr.startswith('10.') or addr.startswith('172.'):
                return addr
    except:
        pass
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(1)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except:
        return '127.0.0.1'


SERVER_NAME = f"Server-{get_local_ip()}"


class CombinedHandler(http.server.BaseHTTPRequestHandler):
    """Unified HTTP handler - static files, signaling, and admin API"""

    def log_message(self, format, *args):
        pass

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        params = parse_qs(parsed.query)

        if path == '/api/peers':
            self.handle_get_peers()
        elif path == '/api/whitelist':
            self.handle_get_whitelist(params)
        elif path == '/api/verify':
            self.handle_verify_password(params)
        elif path == '/signal':
            self.handle_get_messages(params)
        elif path == '/api/text_history':
            self.handle_get_text_history()
        else:
            self.serve_static(path)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length) if content_length > 0 else b''

        try:
            data = json.loads(body.decode('utf-8')) if body else {}
        except json.JSONDecodeError:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b'Invalid JSON')
            return

        if path == '/api/register':
            self.handle_register(data)
        elif path == '/signal':
            self.handle_send_message(data)
        elif path == '/api/whitelist':
            self.handle_update_whitelist(data)
        elif path == '/api/kick':
            self.handle_kick_device(data)
        elif path == '/api/admin/block':
            self.handle_admin_block_device(data)
        elif path == '/api/admin/unblock':
            self.handle_admin_unblock_device(data)
        elif path == '/api/rename':
            self.handle_rename_device(data)
        elif path == '/api/text_history':
            self.handle_post_text_history(data)
        elif path == '/api/text_history/delete':
            self.handle_delete_text_history(data)
        else:
            self.send_response(404)
            self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()

    def send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def send_json(self, status_code, data):
        self.send_response(status_code)
        self.send_cors_headers()
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))

    # =================== API Handlers ===================

    def handle_register(self, data):
        """Device registration / heartbeat"""
        peer_id = data.get('peer_id', '')
        peer_name = data.get('name', '').strip()

        if not peer_id:
            self.send_json(400, {'error': 'missing peer_id'})
            return

        if not peer_name:
            peer_name = 'Device-' + ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
            data['name'] = peer_name

        is_server = data.get('is_server', False)
        client_ip = self.client_address[0]
        blocked = False
        blocked_reason = ''

        if not is_server:
            # Check whitelist (by IP)
            with whitelist_lock:
                if whitelist_enabled and client_ip not in whitelist_ips:
                    blocked = True
                    blocked_reason = 'Not in whitelist. Contact admin.'
            # Check blocked IPs
            with blocked_ips_lock:
                if client_ip in blocked_ips:
                    blocked = True
                    if not blocked_reason:
                        blocked_reason = 'IP blocked by admin.'

        now = time.time()

        with peers_lock:
            online_peers[peer_id] = {
                'id': peer_id,
                'name': peer_name,
                'ip': client_ip,
                'last_seen': now,
                'first_seen': online_peers.get(peer_id, {}).get('first_seen', now),
                'is_server': is_server,
                'blocked': blocked,
                'blocked_reason': blocked_reason
            }

        with peers_lock:
            peer_count = len(online_peers)

        self.send_json(200, {
            'status': 'ok',
            'peer_count': peer_count,
            'blocked': blocked,
            'blocked_reason': blocked_reason,
            'name': peer_name,
            'whitelist_enabled': whitelist_enabled
        })

    def handle_get_peers(self):
        """Get online device list"""
        now = time.time()
        with peers_lock:
            expired = [pid for pid, info in online_peers.items()
                      if now - info['last_seen'] > 15]
            for pid in expired:
                info = online_peers.get(pid)
                if info:
                    del online_peers[pid]

            peer_list = []
            for pid, info in online_peers.items():
                peer_list.append({
                    'id': pid,
                    'name': info.get('name', 'Unknown'),
                    'ip': info.get('ip', ''),
                    'is_server': info.get('is_server', False),
                    'blocked': info.get('blocked', False),
                    'blocked_reason': info.get('blocked_reason', ''),
                    'last_seen': info['last_seen']
                })

        self.send_json(200, {'peers': peer_list})

    def handle_get_whitelist(self, params):
        """Get whitelist status (password required)"""
        password = params.get('password', [''])[0]
        if password != ADMIN_PASSWORD:
            self.send_json(403, {'error': 'Wrong password'})
            return

        with whitelist_lock:
            with blocked_ips_lock:
                self.send_json(200, {
                    'enabled': whitelist_enabled,
                    'ips': sorted(list(whitelist_ips)),
                    'blocked_ips': sorted(list(blocked_ips))
                })

    def handle_verify_password(self, params):
        """Verify admin password"""
        password = params.get('password', [''])[0]
        self.send_json(200, {'valid': password == ADMIN_PASSWORD})

    def handle_update_whitelist(self, data):
        """Update whitelist (IP-based)"""
        password = data.get('password', '')
        if password != ADMIN_PASSWORD:
            self.send_json(403, {'error': 'Wrong password'})
            return

        global whitelist_enabled, whitelist_ips
        new_enabled = data.get('enabled')
        new_ips = data.get('ips')

        with whitelist_lock:
            if new_enabled is not None:
                whitelist_enabled = new_enabled
            if new_ips is not None:
                whitelist_ips = set(new_ips)
            save_whitelist()

        with peers_lock:
            for pid, info in online_peers.items():
                if info.get('is_server'):
                    continue
                ip = info.get('ip', '')
                if whitelist_enabled and ip not in whitelist_ips:
                    info['blocked'] = True
                    info['blocked_reason'] = 'Not in whitelist. Contact admin.'
                else:
                    # Also check blocked_ips
                    with blocked_ips_lock:
                        if ip in blocked_ips:
                            info['blocked'] = True
                            info['blocked_reason'] = 'IP blocked by admin.'
                        else:
                            info['blocked'] = False
                            info['blocked_reason'] = ''

        self.send_json(200, {'status': 'ok', 'enabled': whitelist_enabled, 'ips': sorted(list(whitelist_ips))})

    def handle_kick_device(self, data):
        """Force offline a device"""
        password = data.get('password', '')
        if password != ADMIN_PASSWORD:
            self.send_json(403, {'error': 'Wrong password'})
            return

        target_id = data.get('peer_id', '')
        with peers_lock:
            if target_id in online_peers:
                info = online_peers[target_id]
                if info.get('is_server'):
                    self.send_json(400, {'error': 'Cannot kick server device'})
                    return
                del online_peers[target_id]
                self.send_json(200, {'status': 'ok'})
            else:
                self.send_json(404, {'error': 'Device not online'})

    def handle_admin_block_device(self, data):
        """Admin: block a device connection (by IP, persisted)"""
        password = data.get('password', '')
        if password != ADMIN_PASSWORD:
            self.send_json(403, {'error': 'Wrong password'})
            return

        target_id = data.get('peer_id', '')
        blocked_ip = None
        with peers_lock:
            if target_id in online_peers:
                info = online_peers[target_id]
                if info.get('is_server'):
                    self.send_json(400, {'error': 'Cannot block server device'})
                    return
                blocked_ip = info.get('ip', '')
                info['blocked'] = True
                info['blocked_reason'] = 'Manually blocked by admin.'
                if blocked_ip:
                    with blocked_ips_lock:
                        blocked_ips.add(blocked_ip)
                        save_blocked_ips()
                self.send_json(200, {'status': 'ok', 'blocked_ip': blocked_ip})
            else:
                self.send_json(404, {'error': 'Device not online'})

    def handle_admin_unblock_device(self, data):
        """Admin: unblock a device connection (remove IP from blocked list, persisted)"""
        password = data.get('password', '')
        if password != ADMIN_PASSWORD:
            self.send_json(403, {'error': 'Wrong password'})
            return

        target_id = data.get('peer_id', '')
        unblocked_ip = None
        with peers_lock:
            if target_id in online_peers:
                info = online_peers[target_id]
                unblocked_ip = info.get('ip', '')
                info['blocked'] = False
                info['blocked_reason'] = ''
                if unblocked_ip:
                    with blocked_ips_lock:
                        blocked_ips.discard(unblocked_ip)
                        save_blocked_ips()
                self.send_json(200, {'status': 'ok', 'unblocked_ip': unblocked_ip})
            else:
                self.send_json(404, {'error': 'Device not online'})

    def handle_rename_device(self, data):
        """Rename a device"""
        peer_id = data.get('peer_id', '')
        new_name = data.get('name', '').strip()

        if not new_name:
            self.send_json(400, {'error': 'Name cannot be empty'})
            return

        with peers_lock:
            if peer_id in online_peers:
                info = online_peers[peer_id]
                ip = info.get('ip', '')
                # Re-evaluate block status based on IP
                blocked = False
                blocked_reason = ''
                with whitelist_lock:
                    if whitelist_enabled and ip not in whitelist_ips:
                        blocked = True
                        blocked_reason = 'Not in whitelist. Contact admin.'
                    else:
                        with blocked_ips_lock:
                            if ip in blocked_ips:
                                blocked = True
                                blocked_reason = 'IP blocked by admin.'
                online_peers[peer_id]['name'] = new_name
                online_peers[peer_id]['blocked'] = blocked
                online_peers[peer_id]['blocked_reason'] = blocked_reason
                self.send_json(200, {
                    'status': 'ok',
                    'blocked': blocked,
                    'blocked_reason': blocked_reason
                })
            else:
                self.send_json(404, {'error': 'Device not online'})

    def handle_get_messages(self, params):
        """Get pending messages - blocked devices cannot receive messages"""
        peer_id = params.get('peer_id', [''])[0]
        if not peer_id:
            self.send_json(200, {'messages': []})
            return

        # Check if this peer is blocked (cannot receive)
        with peers_lock:
            peer_info = online_peers.get(peer_id)
            if peer_info and peer_info.get('blocked', False):
                self.send_json(200, {'messages': []})
                return

        with messages_lock:
            msgs = pending_messages.pop(peer_id, [])
            now = time.time()
            msgs = [m for m in msgs if m.get('_time', 0) > now - 60]

        self.send_json(200, {'messages': msgs})

    def handle_send_message(self, data):
        """Send a message - blocked devices cannot send messages"""
        from_id = data.get('from', '')
        target = data.get('to', '')
        msg_data = data.get('data', {})

        if from_id:
            # Check if sender is blocked (cannot send)
            with peers_lock:
                sender_info = online_peers.get(from_id)
                if sender_info and sender_info.get('blocked', False):
                    self.send_json(403, {'error': 'Blocked device cannot send messages', 'blocked': True})
                    return

        if target and msg_data:
            msg_data['_time'] = time.time()
            with messages_lock:
                if target not in pending_messages:
                    pending_messages[target] = []
                pending_messages[target].append(msg_data)
                if len(pending_messages[target]) > 200:
                    pending_messages[target] = pending_messages[target][-100:]

        self.send_json(200, {'status': 'ok'})

    # =================== Text History API ===================

    def handle_get_text_history(self):
        """GET: return all persisted text history"""
        with text_history_lock:
            self.send_json(200, {'history': text_history})

    def handle_post_text_history(self, data):
        """POST: add a new text entry to history"""
        entry = data.get('entry', {})
        if not entry.get('id') or not entry.get('text'):
            self.send_json(400, {'error': 'Missing id or text field'})
            return
        # Ensure type and time
        if 'type' not in entry:
            entry['type'] = 'sent'
        if 'time' not in entry:
            entry['time'] = time.strftime('%H:%M:%S', time.localtime())
        if 'fromName' not in entry:
            entry['fromName'] = 'Unknown'

        with text_history_lock:
            # Avoid duplicates
            for existing in text_history:
                if existing.get('id') == entry.get('id'):
                    self.send_json(200, {'status': 'ok', 'history': text_history})
                    return
            text_history.append(entry)
            save_text_history()
            self.send_json(200, {'status': 'ok', 'history': text_history})

    def handle_delete_text_history(self, data):
        """POST: delete a text entry by id"""
        entry_id = data.get('id', '')
        if not entry_id:
            self.send_json(400, {'error': 'Missing id'})
            return
        with text_history_lock:
            global text_history
            text_history = [e for e in text_history if e.get('id') != entry_id]
            save_text_history()
            self.send_json(200, {'status': 'ok', 'history': text_history})

    # =================== Static File Server ===================

    def serve_static(self, path):
        """Serve static files"""
        if path == '/' or path == '':
            path = '/index.html'

        file_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), path.lstrip('/'))
        file_path = os.path.normpath(file_path)

        allowed_dir = os.path.dirname(os.path.abspath(__file__))
        if not file_path.startswith(allowed_dir):
            self.send_response(403)
            self.end_headers()
            return

        if os.path.isfile(file_path):
            _, ext = os.path.splitext(file_path)
            content_types = {
                '.html': 'text/html; charset=utf-8',
                '.css': 'text/css; charset=utf-8',
                '.js': 'application/javascript; charset=utf-8',
                '.json': 'application/json',
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.svg': 'image/svg+xml',
                '.ico': 'image/x-icon'
            }
            content_type = content_types.get(ext, 'application/octet-stream')

            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.end_headers()

            with open(file_path, 'rb') as f:
                self.wfile.write(f.read())
        else:
            self.send_response(404)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(b'<h1>404 Not Found</h1>')


def cleanup_thread():
    """Periodically clean up expired data"""
    while True:
        time.sleep(10)
        now = time.time()
        with peers_lock:
            expired = [pid for pid, info in online_peers.items()
                      if now - info['last_seen'] > 30]
            for pid in expired:
                if pid in online_peers:
                    del online_peers[pid]

        with messages_lock:
            for pid in list(pending_messages.keys()):
                pending_messages[pid] = [
                    m for m in pending_messages[pid]
                    if m.get('_time', 0) > now - 60
                ]
                if not pending_messages[pid]:
                    del pending_messages[pid]

        # Update GUI peer count
        if _gui:
            try:
                _gui.update_peer_count(len(online_peers))
            except:
                pass


def server_thread_func():
    """Start HTTP server (runs in background thread)"""
    global _server_instance
    _server_instance = http.server.HTTPServer(('0.0.0.0', HTTP_PORT), CombinedHandler)
    _server_instance.timeout = 0.5
    _server_instance.serve_forever()


# =================== tkinter GUI ===================

def create_gui():
    """Try to create tkinter GUI, return None if unavailable"""
    try:
        import tkinter as tk
        from tkinter import ttk
    except ImportError:
        return None

    class ServerGUI:
        def __init__(self):
            self.root = tk.Tk()
            self.root.title("📁 文件传输助手 - 服务器")
            self.root.resizable(False, False)
            self.root.protocol("WM_DELETE_WINDOW", self.on_close)

            # Calculate window position (center of screen)
            win_w, win_h = 500, 360
            screen_w = self.root.winfo_screenwidth()
            screen_h = self.root.winfo_screenheight()
            x = (screen_w - win_w) // 2
            y = (screen_h - win_h) // 2
            self.root.geometry(f"{win_w}x{win_h}+{x}+{y}")

            # Make window stay on top briefly
            self.root.attributes('-topmost', True)

            self.is_running = True
            self._build_ui()

        def _build_ui(self):
            self.root.configure(bg='#f5f5f5')

            # Title
            title_frame = tk.Frame(self.root, bg='#2c3e50', height=60)
            title_frame.pack(fill='x')
            title_frame.pack_propagate(False)

            tk.Label(title_frame,
                     text="📁 文件传输助手",
                     font=('Microsoft YaHei', 16, 'bold'),
                     bg='#2c3e50', fg='white').pack(expand=True)

            # Main content
            content = tk.Frame(self.root, bg='#f5f5f5', padx=20, pady=15)
            content.pack(fill='both', expand=True)

            # Server URL
            local_ip = get_local_ip()
            url_frame = tk.Frame(content, bg='#f5f5f5')
            url_frame.pack(fill='x', pady=(0, 8))

            tk.Label(url_frame, text="🌐 访问地址:",
                     font=('Microsoft YaHei', 11),
                     bg='#f5f5f5', fg='#333').pack(anchor='w')

            url_bg = tk.Frame(url_frame, bg='white', highlightbackground='#ddd',
                              highlightthickness=1, pady=5, padx=10)
            url_bg.pack(fill='x', pady=(4, 0))

            url_text = f"http://{local_ip}:{HTTP_PORT}"
            self.url_label = tk.Label(url_bg, text=url_text,
                                      font=('Consolas', 12, 'bold'),
                                      bg='white', fg='#2980b9', cursor='hand2')
            self.url_label.pack()
            self.url_label.bind('<Button-1>', lambda e: self._copy_url())

            self.copied_label = tk.Label(url_frame, text="",
                                         font=('Microsoft YaHei', 9),
                                         bg='#f5f5f5', fg='#27ae60')
            self.copied_label.pack()

            # Password
            pwd_frame = tk.Frame(content, bg='#f5f5f5')
            pwd_frame.pack(fill='x', pady=(0, 8))

            tk.Label(pwd_frame, text="🔑 管理员密码:",
                     font=('Microsoft YaHei', 11),
                     bg='#f5f5f5', fg='#333').pack(anchor='w')

            pwd_bg = tk.Frame(pwd_frame, bg='white', highlightbackground='#ddd',
                              highlightthickness=1, pady=5, padx=10)
            pwd_bg.pack(fill='x', pady=(4, 0))

            tk.Label(pwd_bg, text=ADMIN_PASSWORD,
                     font=('Consolas', 12, 'bold'),
                     bg='white', fg='#e74c3c').pack()

            # Separator
            ttk.Separator(content, orient='horizontal').pack(fill='x', pady=10)

            # Stats
            stats_frame = tk.Frame(content, bg='#f5f5f5')
            stats_frame.pack(fill='x')

            # Connected devices
            device_frame = tk.Frame(stats_frame, bg='#f5f5f5')
            device_frame.pack(side='left', fill='x', expand=True)

            tk.Label(device_frame, text="📱 已连接设备:",
                     font=('Microsoft YaHei', 11),
                     bg='#f5f5f5', fg='#333').pack(anchor='w')

            self.peer_count_label = tk.Label(device_frame, text="0",
                                              font=('Consolas', 24, 'bold'),
                                              bg='#f5f5f5', fg='#2c3e50')
            self.peer_count_label.pack(anchor='w')

            # Whitelist status
            wl_frame = tk.Frame(stats_frame, bg='#f5f5f5')
            wl_frame.pack(side='right', fill='x', expand=True, padx=(10, 0))

            tk.Label(wl_frame, text="🛡️ 白名单:",
                     font=('Microsoft YaHei', 11),
                     bg='#f5f5f5', fg='#333').pack(anchor='w')

            wl_text = "已启用" if whitelist_enabled else "未启用"
            wl_color = '#27ae60' if whitelist_enabled else '#95a5a6'
            self.wl_label = tk.Label(wl_frame, text=wl_text,
                                      font=('Consolas', 14, 'bold'),
                                      bg='#f5f5f5', fg=wl_color)
            self.wl_label.pack(anchor='w')

            # Bottom buttons
            btn_frame = tk.Frame(content, bg='#f5f5f5')
            btn_frame.pack(fill='x', pady=(15, 0))

            self.open_btn = tk.Button(btn_frame, text="🌐 打开浏览器",
                                      font=('Microsoft YaHei', 10),
                                      bg='#2980b9', fg='white',
                                      relief='flat', padx=15, pady=5,
                                      cursor='hand2',
                                      command=self._open_browser)
            self.open_btn.pack(side='left', padx=(0, 10))

            self.stop_btn = tk.Button(btn_frame, text="⏹ 停止服务器",
                                      font=('Microsoft YaHei', 10),
                                      bg='#e74c3c', fg='white',
                                      relief='flat', padx=15, pady=5,
                                      cursor='hand2',
                                      command=self.on_close)
            self.stop_btn.pack(side='right')

        def _copy_url(self):
            self.root.clipboard_clear()
            self.root.clipboard_append(self.url_label.cget('text'))
            self.copied_label.config(text="✓ 已复制到剪贴板")
            self.root.after(2000, lambda: self.copied_label.config(text=""))

        def _open_browser(self):
            import subprocess
            url = self.url_label.cget('text')
            try:
                subprocess.Popen(['start', url], shell=True)
            except:
                pass

        def _update_password(self, new_pwd):
            """Update password label in GUI"""
            # Find the password label in the pwd_bg frame
            for child in self.root.winfo_children():
                if isinstance(child, tk.Frame):
                    for sub in child.winfo_children():
                        if isinstance(sub, tk.Label) and sub.cget('bg') == 'white':
                            sub.config(text=new_pwd)
                            break

        def update_peer_count(self, count):
            try:
                self.peer_count_label.config(text=str(count))
            except:
                pass

        def _refresh_peer_count(self):
            """Periodically refresh peer count from online_peers"""
            global online_peers
            try:
                with peers_lock:
                    count = len(online_peers)
                self.update_peer_count(count)
            except:
                pass
            self.root.after(3000, self._refresh_peer_count)

        def _update_whitelist_status(self):
            """Refresh whitelist status from server"""
            global whitelist_enabled
            wl_text = "已启用" if whitelist_enabled else "未启用"
            wl_color = '#27ae60' if whitelist_enabled else '#95a5a6'
            try:
                self.wl_label.config(text=wl_text, fg=wl_color)
            except:
                pass
            self.root.after(5000, self._update_whitelist_status)

        def on_close(self):
            self.is_running = False
            try:
                self.root.destroy()
            except:
                pass

        def run(self):
            self._refresh_peer_count()
            self._update_whitelist_status()
            self.root.mainloop()

    return ServerGUI()


def main():
    global ADMIN_PASSWORD
    no_gui = '--no-gui' in sys.argv
    if no_gui:
        sys.argv.remove('--no-gui')
    
    if len(sys.argv) > 1 and sys.argv[1].isdigit() and len(sys.argv[1]) == 4:
        ADMIN_PASSWORD = sys.argv[1]

    load_whitelist()
    load_text_history()
    local_ip = get_local_ip()

    # Start server in background thread
    server_thread = threading.Thread(target=server_thread_func, daemon=True)
    server_thread.start()

    # Give the server a moment to start
    time.sleep(0.5)

    # Console mode always prints info
    print()
    print("=" * 55)
    print("   File Transfer Assistant - Server")
    print("=" * 55)
    print()
    print(f"  Web URL:  http://{local_ip}:{HTTP_PORT}")
    print()
    print(f"  Admin Password: {ADMIN_PASSWORD}")
    print()
    print(f"  Whitelist: {'enabled' if whitelist_enabled else 'disabled'}")
    if whitelist_ips:
        print(f"  Whitelist IPs: {', '.join(sorted(list(whitelist_ips)))}")
    if blocked_ips:
        print(f"  Blocked IPs: {', '.join(sorted(list(blocked_ips)))}")
    print()
    print("=" * 55)
    print()

    if not no_gui:
        # Try GUI
        gui = create_gui()
        if gui:
            global _gui
            _gui = gui
            print("  (GUI window opened)")
            gui.run()
            # When GUI closes, stop server
            print("\n  Server stopped.")
            os._exit(0)
            return

    # Console mode (no GUI)
    while True:
        time.sleep(1)


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(f"\n  [ERROR] Server failed to start: {e}")
        print(f"\n  Make sure port 8000 is not in use.")
        print(f"  Press Enter to exit...")
        try:
            input()
        except:
            pass
        sys.exit(1)
