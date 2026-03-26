import base64
import hashlib
import json
import os
import random
import secrets
import shutil
import socket
import struct
import subprocess
import tempfile
import threading
import time
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


WORKDIR = Path(__file__).resolve().parent
BROWSER_CANDIDATES = [
    Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
    Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"),
]


class SilentHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, directory=None, **kwargs):
        super().__init__(*args, directory=str(WORKDIR), **kwargs)

    def log_message(self, fmt, *args):
        return


def find_browser():
    for candidate in BROWSER_CANDIDATES:
        if candidate.exists():
            return candidate
    raise RuntimeError("No supported browser found")


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def start_server():
    port = free_port()
    server = ThreadingHTTPServer(("127.0.0.1", port), SilentHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, port


def http_json(url, timeout=10):
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


class CDPClient:
    def __init__(self, ws_url):
        parsed = urlparse(ws_url)
        port = parsed.port or 80
        host = parsed.hostname or "127.0.0.1"
        path = parsed.path or "/"
        if parsed.query:
            path = f"{path}?{parsed.query}"

        self.sock = socket.create_connection((host, port), timeout=10)
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        request = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(request.encode("ascii"))
        response = self._recv_until(b"\r\n\r\n")
        if b"101" not in response.split(b"\r\n", 1)[0]:
            raise RuntimeError(f"WebSocket handshake failed: {response!r}")
        self.next_id = 1

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass

    def call(self, method, params=None, timeout=10):
        message_id = self.next_id
        self.next_id += 1
        payload = json.dumps({"id": message_id, "method": method, "params": params or {}})
        self._send_text(payload)
        deadline = time.time() + timeout

        while time.time() < deadline:
            data = self._recv_message(timeout=max(0.1, deadline - time.time()))
            if data is None:
                continue
            if "id" in data and data["id"] == message_id:
                if "error" in data:
                    raise RuntimeError(f"CDP error for {method}: {data['error']}")
                return data.get("result", {})
        raise TimeoutError(f"Timed out waiting for CDP response to {method}")

    def _recv_until(self, marker):
        data = b""
        while marker not in data:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise RuntimeError("Socket closed during handshake")
            data += chunk
        return data

    def _send_text(self, text):
        payload = text.encode("utf-8")
        frame = bytearray()
        frame.append(0x81)
        mask_bit = 0x80
        length = len(payload)
        if length < 126:
            frame.append(mask_bit | length)
        elif length < 65536:
            frame.append(mask_bit | 126)
            frame.extend(struct.pack("!H", length))
        else:
            frame.append(mask_bit | 127)
            frame.extend(struct.pack("!Q", length))
        mask = os.urandom(4)
        frame.extend(mask)
        frame.extend(bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload)))
        self.sock.sendall(frame)

    def _recv_message(self, timeout=10):
        self.sock.settimeout(timeout)
        first = self.sock.recv(1)
        if not first:
            return None
        second = self.sock.recv(1)
        fin_opcode = first[0]
        opcode = fin_opcode & 0x0F
        masked = bool(second[0] & 0x80)
        length = second[0] & 0x7F
        if length == 126:
            length = struct.unpack("!H", self.sock.recv(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", self.sock.recv(8))[0]
        mask = self.sock.recv(4) if masked else None
        payload = bytearray()
        while len(payload) < length:
            payload.extend(self.sock.recv(length - len(payload)))
        if masked and mask:
            payload = bytearray(byte ^ mask[index % 4] for index, byte in enumerate(payload))

        if opcode == 0x8:
            return None
        if opcode == 0x9:
            self._send_control(0xA, payload)
            return self._recv_message(timeout)
        if opcode != 0x1:
            return self._recv_message(timeout)
        return json.loads(payload.decode("utf-8"))

    def _send_control(self, opcode, payload=b""):
        frame = bytearray([0x80 | opcode, 0x80 | len(payload)])
        mask = os.urandom(4)
        frame.extend(mask)
        frame.extend(bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload)))
        self.sock.sendall(frame)


class BrowserSession:
    def __init__(self, browser_path, url):
        self.browser_path = Path(browser_path)
        self.url = url
        self.debug_port = free_port()
        self.user_data_dir = Path(tempfile.mkdtemp(prefix="rose-verify-browser-"))
        self.process = None
        self.client = None

    def __enter__(self):
        args = [
            str(self.browser_path),
            "--headless=new",
            "--disable-gpu",
            "--no-first-run",
            "--no-default-browser-check",
            "--autoplay-policy=no-user-gesture-required",
            f"--remote-debugging-port={self.debug_port}",
            f"--user-data-dir={self.user_data_dir}",
            self.url,
        ]
        self.process = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        target = self._wait_for_target()
        self.client = CDPClient(target["webSocketDebuggerUrl"])
        self.client.call("Page.enable")
        self.client.call("Runtime.enable")
        self.client.call("Page.bringToFront")
        self.evaluate(
            """
            (() => {
              window.__roseErrors = [];
              window.addEventListener('error', (event) => window.__roseErrors.push(String(event.message || event.error || 'error')));
              window.addEventListener('unhandledrejection', (event) => window.__roseErrors.push(String(event.reason || 'rejection')));
              const oldConsoleError = console.error.bind(console);
              console.error = (...args) => {
                window.__roseErrors.push(args.map(String).join(' '));
                oldConsoleError(...args);
              };
            })()
            """
        )
        self.wait_for("document.readyState === 'complete'")
        return self

    def __exit__(self, exc_type, exc, tb):
        if self.client:
            self.client.close()
        if self.process:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
        shutil.rmtree(self.user_data_dir, ignore_errors=True)

    def _wait_for_target(self):
        deadline = time.time() + 20
        while time.time() < deadline:
          try:
            targets = http_json(f"http://127.0.0.1:{self.debug_port}/json/list", timeout=2)
            for target in targets:
                if target.get("type") == "page" and "index.html" in target.get("url", ""):
                    return target
          except Exception:
            time.sleep(0.2)
            continue
          time.sleep(0.2)
        raise RuntimeError("Browser target did not appear")

    def evaluate(self, expression, await_promise=True):
        result = self.client.call(
            "Runtime.evaluate",
            {
                "expression": expression,
                "awaitPromise": await_promise,
                "returnByValue": True,
                "userGesture": True,
            },
            timeout=20,
        )
        if "exceptionDetails" in result:
            details = result["exceptionDetails"]
            description = ""
            if "exception" in details:
                description = details["exception"].get("description", "")
            raise RuntimeError(description or details.get("text", "JavaScript evaluation failed"))
        inner = result.get("result", {})
        if inner.get("subtype") == "error" or inner.get("className", "").endswith("Error"):
            raise RuntimeError(inner.get("description", "JavaScript error"))
        if "value" in inner:
            return inner["value"]
        return inner

    def wait_for(self, expression, timeout=20, interval=0.1):
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                if self.evaluate(expression):
                    return True
            except Exception:
                pass
            time.sleep(interval)
        raise TimeoutError(f"Condition not met: {expression}")

    def screenshot(self, output_path):
        result = self.client.call("Page.captureScreenshot", {"format": "png"}, timeout=20)
        Path(output_path).write_bytes(base64.b64decode(result["data"]))


def ensure(condition, message):
    if not condition:
        raise AssertionError(message)


def verify_yes_path(base_url, browser_path):
    results = {}
    with BrowserSession(browser_path, f"{base_url}/index.html?admin=rose") as browser:
        browser.screenshot(WORKDIR / "verify-cover.png")
        results["cover_loaded"] = browser.evaluate("document.getElementById('openBookButton').textContent.trim()")
        ensure(results["cover_loaded"] == "Open The Book", "Cover did not load properly")

        browser.evaluate("document.getElementById('openBookButton').click()")
        browser.wait_for("document.querySelector('.page.is-active').id === 'page-1'")

        before = browser.evaluate("document.getElementById('noButton').style.transform || ''")
        browser.evaluate(
            """
            (() => {
              const noButton = document.getElementById('noButton');
              noButton.dispatchEvent(new Event('mouseenter', { bubbles: true }));
              return noButton.style.transform || '';
            })()
            """
        )
        after = browser.evaluate("document.getElementById('noButton').style.transform || ''")
        results["page1_no_moves"] = before != after and after != ""
        ensure(results["page1_no_moves"], "Page 1 No button did not move")

        browser.evaluate("document.getElementById('yesButton').click()")
        browser.wait_for("document.querySelector('.page.is-active').id === 'page-2'", timeout=10)

        browser.evaluate("document.getElementById('waterButton').click()")
        browser.wait_for("document.getElementById('flowerStage').classList.contains('is-watered')", timeout=8)
        browser.wait_for("document.getElementById('waterButton').textContent.trim() === 'Rose Bloomed'", timeout=8)
        results["page2_bloom"] = browser.evaluate(
            """
            (() => {
              const image = document.getElementById('rosePortrait');
              return {
                watered: document.getElementById('flowerStage').classList.contains('is-watered'),
                imageLoaded: image.complete && image.naturalWidth > 0,
                button: document.getElementById('waterButton').textContent.trim()
              };
            })()
            """
        )
        ensure(results["page2_bloom"]["watered"], "Page 2 never entered watered state")
        ensure(results["page2_bloom"]["imageLoaded"], "Page 2 portrait did not load")
        browser.screenshot(WORKDIR / "verify-page2.png")

        browser.evaluate("document.getElementById('nextButton').click()")
        browser.wait_for("document.querySelector('.page.is-active').id === 'page-3'", timeout=10)

        browser.evaluate(
            """
            (async () => {
              const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
              while (document.getElementById('missingPieceNote').classList.contains('is-hidden')) {
                const tiles = [...document.querySelectorAll('.puzzle-tile')].map((tile) => ({
                  slot: Number(tile.dataset.slot),
                  piece: Number(tile.dataset.piece)
                }));
                let swapped = false;
                for (const tile of tiles) {
                  if (tile.piece !== tile.slot) {
                    const correct = tiles.find((candidate) => candidate.piece === tile.slot);
                    if (!correct) {
                      continue;
                    }
                    document.querySelector(`.puzzle-tile[data-slot="${tile.slot}"]`).click();
                    await delay(40);
                    document.querySelector(`.puzzle-tile[data-slot="${correct.slot}"]`).click();
                    await delay(120);
                    swapped = true;
                    break;
                  }
                }
                if (!swapped) {
                  break;
                }
              }
              return !document.getElementById('missingPieceNote').classList.contains('is-hidden');
            })()
            """
        )
        browser.wait_for("!document.getElementById('missingPieceNote').classList.contains('is-hidden')", timeout=8)
        browser.evaluate("document.getElementById('missingPieceYes').click()")
        browser.wait_for("!document.getElementById('missingPieceReveal').classList.contains('is-hidden')", timeout=8)
        browser.wait_for("!document.getElementById('nextButton').disabled", timeout=8)
        results["page3_yes_branch"] = browser.evaluate(
            """
            ({
              revealVisible: !document.getElementById('missingPieceReveal').classList.contains('is-hidden'),
              nextEnabled: !document.getElementById('nextButton').disabled
            })
            """
        )
        ensure(results["page3_yes_branch"]["revealVisible"], "Page 3 reveal did not appear after Yes")

        browser.evaluate("document.getElementById('nextButton').click()")
        browser.wait_for("document.querySelector('.page.is-active').id === 'page-4'", timeout=10)
        browser.evaluate(
            """
            (async () => {
              document.getElementById('heartToken').click();
              return true;
            })()
            """
        )
        browser.wait_for("!document.getElementById('videoReveal').classList.contains('is-hidden')", timeout=8)
        results["page4_video_reveal"] = browser.evaluate(
            """
            ({
              videoVisible: !document.getElementById('videoReveal').classList.contains('is-hidden'),
              videoSource: document.getElementById('roseVideo').currentSrc
            })
            """
        )
        ensure(results["page4_video_reveal"]["videoVisible"], "Page 4 video did not reveal")

        browser.evaluate("document.getElementById('nextButton').click()")
        browser.wait_for("document.querySelector('.page.is-active').id === 'page-5'", timeout=10)
        results["page5_saved"] = browser.evaluate(
            """
            (async () => {
              const area = document.getElementById('letterArea');
              area.value = 'Verification note from headless browser.';
              area.dispatchEvent(new Event('input', { bubbles: true }));
              await new Promise((resolve) => setTimeout(resolve, 900));
              const saved = JSON.parse(localStorage.getItem('rose-story-notes') || '[]');
              return {
                status: document.getElementById('letterStatus').textContent,
                savedCount: saved.length,
                body: saved[0] ? saved[0].body : ''
              };
            })()
            """
        )
        ensure(results["page5_saved"]["savedCount"] >= 1, "Page 5 did not auto-save any note")

        browser.evaluate("document.getElementById('nextButton').click()")
        browser.wait_for("document.querySelector('.page.is-active').id === 'page-6'", timeout=10)
        results["page6_music"] = browser.evaluate(
            """
            (async () => {
              document.getElementById('envelopeButton').click();
              await new Promise((resolve) => setTimeout(resolve, 1200));
              const audio = document.getElementById('roseSong');
              return {
                playerVisible: !document.getElementById('musicPlayer').classList.contains('is-hidden'),
                readyState: audio.readyState,
                paused: audio.paused,
                currentTime: audio.currentTime
              };
            })()
            """
        )
        ensure(results["page6_music"]["playerVisible"], "Page 6 player never appeared")
        ensure(results["page6_music"]["readyState"] >= 1, "Page 6 audio did not load")

        browser.evaluate("document.getElementById('nextButton').click()")
        browser.wait_for("document.querySelector('.page.is-active').id === 'page-7'", timeout=10)
        results["page7_text"] = browser.evaluate("document.querySelector('#page-7 .final-main-text').textContent.trim()")
        ensure("not for appreciation" in results["page7_text"], "Page 7 text mismatch")

        browser.evaluate("document.getElementById('nextButton').click()")
        browser.wait_for("document.querySelector('.page.is-active').id === 'page-8'", timeout=10)
        results["page8_custom_page"] = browser.evaluate(
            """
            (() => {
              document.getElementById('toggleCustomForm').click();
              document.getElementById('customTitle').value = 'Verification Page';
              document.getElementById('customBody').value = 'This page was added by the verification script.';
              document.getElementById('customAccent').value = 'gold';
              document.getElementById('customForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
              const exists = [...document.querySelectorAll('.page--custom')].some((page) => page.dataset.title === 'Verification Page');
              const listed = document.getElementById('customPagesList').textContent.includes('Verification Page');
              return { exists, listed, count: document.querySelectorAll('.page--custom').length };
            })()
            """
        )
        ensure(results["page8_custom_page"]["exists"], "Page 8 custom page was not created")

        results["runtime_errors"] = browser.evaluate("window.__roseErrors")
        ensure(not results["runtime_errors"], f"Runtime errors detected: {results['runtime_errors']}")
    return results


def verify_no_path(base_url, browser_path):
    results = {}
    with BrowserSession(browser_path, f"{base_url}/index.html") as browser:
        browser.evaluate("document.getElementById('openBookButton').click()")
        browser.wait_for("document.querySelector('.page.is-active').id === 'page-1'")
        browser.evaluate("document.getElementById('yesButton').click()")
        browser.wait_for("document.querySelector('.page.is-active').id === 'page-2'", timeout=10)
        browser.evaluate("document.getElementById('waterButton').click()")
        browser.wait_for("document.getElementById('waterButton').textContent.trim() === 'Rose Bloomed'", timeout=8)
        browser.evaluate("document.getElementById('nextButton').click()")
        browser.wait_for("document.querySelector('.page.is-active').id === 'page-3'", timeout=10)
        browser.evaluate(
            """
            (async () => {
              const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
              while (document.getElementById('missingPieceNote').classList.contains('is-hidden')) {
                const tiles = [...document.querySelectorAll('.puzzle-tile')].map((tile) => ({
                  slot: Number(tile.dataset.slot),
                  piece: Number(tile.dataset.piece)
                }));
                for (const tile of tiles) {
                  if (tile.piece !== tile.slot) {
                    const correct = tiles.find((candidate) => candidate.piece === tile.slot);
                    if (correct) {
                      document.querySelector(`.puzzle-tile[data-slot="${tile.slot}"]`).click();
                      await delay(40);
                      document.querySelector(`.puzzle-tile[data-slot="${correct.slot}"]`).click();
                      await delay(120);
                      break;
                    }
                  }
                }
              }
              document.getElementById('missingPieceNo').click();
              return true;
            })()
            """
        )
        browser.wait_for("!document.getElementById('neverEndingBook').classList.contains('is-hidden')", timeout=10)
        results["page3_no_branch"] = browser.evaluate(
            """
            ({
              storyEnded: document.getElementById('bookFrame').classList.contains('story-ended'),
              neverEndingVisible: !document.getElementById('neverEndingBook').classList.contains('is-hidden'),
              neverEndingText: document.querySelector('.never-ending-book__title').textContent.trim()
            })
            """
        )
        ensure(results["page3_no_branch"]["storyEnded"], "No-branch did not end the story")
        ensure(results["page3_no_branch"]["neverEndingVisible"], "Never ending book did not appear")
        browser.screenshot(WORKDIR / "verify-no-branch.png")
    return results


def main():
    browser = find_browser()
    server, port = start_server()
    base_url = f"http://127.0.0.1:{port}"
    report = {"browser": str(browser)}

    try:
        report["yes_path"] = verify_yes_path(base_url, browser)
        report["no_path"] = verify_no_path(base_url, browser)
        report["status"] = "ok"
    except Exception as error:
        report["status"] = "failed"
        report["error"] = str(error)
    finally:
        server.shutdown()
        server.server_close()

    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
