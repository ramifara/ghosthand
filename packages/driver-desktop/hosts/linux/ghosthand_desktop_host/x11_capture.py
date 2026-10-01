# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 Rami Fara and GhostHand contributors
"""Screenshots (XShm through mss, else ImageMagick `import`, else ffmpeg x11grab) and ffmpeg recording."""

import os
import shutil
import signal
import struct
import subprocess

from .rpc import RpcError, log


def png_size(data):
    if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n":
        raise RpcError("driver", "screenshot is not a PNG")
    w, h = struct.unpack(">II", data[16:24])
    return w, h


class X11Capture:
    def __init__(self, display, size):
        self.display = display
        self.size = size
        self._mss = None
        self.method = None
        try:
            import mss  # noqa: PLC0415 - optional dependency
            import mss.tools  # noqa: PLC0415

            self._mss = mss
            self.method = "xshm"
        except ImportError:
            if shutil.which("import"):
                self.method = "import"
            elif shutil.which("ffmpeg"):
                self.method = "ffmpeg"
        self.recording = None

    def screenshot(self, region=None):
        if self.method == "xshm":
            return self._mss_shot(region)
        if self.method == "import":
            args = ["import", "-display", self.display, "-window", "root"]
            if region:
                args += ["-crop", f"{int(region['width'])}x{int(region['height'])}+{int(region['x'])}+{int(region['y'])}"]
            return self._run(args + ["png:-"])
        if self.method == "ffmpeg":
            w, h = self.size
            x = y = 0
            if region:
                x, y, w, h = int(region["x"]), int(region["y"]), int(region["width"]), int(region["height"])
            return self._run(
                ["ffmpeg", "-loglevel", "error", "-f", "x11grab", "-video_size", f"{w}x{h}", "-i", f"{self.display}+{x},{y}",
                 "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"]
            )
        raise RpcError("unsupported", "no screenshot method (install python3-mss, imagemagick or ffmpeg)")

    def _mss_shot(self, region):
        mss = self._mss
        with mss.mss(display=self.display) as sct:
            mon = sct.monitors[0]
            if region:
                mon = {
                    "left": int(region["x"]),
                    "top": int(region["y"]),
                    "width": max(1, int(region["width"])),
                    "height": max(1, int(region["height"])),
                }
            shot = sct.grab(mon)
            return mss.tools.to_png(shot.rgb, shot.size)

    def _run(self, args):
        r = subprocess.run(args, capture_output=True, timeout=15, check=False, env=dict(os.environ, DISPLAY=self.display))
        if r.returncode != 0 or not r.stdout:
            raise RpcError("driver", f"{args[0]} screenshot failed: {r.stderr.decode(errors='replace')[:200]}")
        return r.stdout

    def start_recording(self, path):
        if self.recording is not None:
            raise RpcError("driver", "already recording")
        if shutil.which("ffmpeg") is None:
            raise RpcError("unsupported", "ffmpeg is not installed; recording is unavailable")
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        w, h = self.size
        p = subprocess.Popen(
            ["ffmpeg", "-loglevel", "error", "-y", "-f", "x11grab", "-framerate", "10", "-video_size", f"{w}x{h}",
             "-i", self.display, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", path],
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        self.recording = (p, path)

    def stop_recording(self):
        if self.recording is None:
            raise RpcError("driver", "not recording")
        p, path = self.recording
        self.recording = None
        try:
            p.stdin.write(b"q")
            p.stdin.close()
            p.wait(timeout=10)
        except (BrokenPipeError, subprocess.TimeoutExpired, OSError):
            try:
                os.killpg(p.pid, signal.SIGINT)
                p.wait(timeout=5)
            except (ProcessLookupError, subprocess.TimeoutExpired):
                log("ffmpeg did not stop; killing it")
                p.kill()
        return [path] if os.path.exists(path) else []
