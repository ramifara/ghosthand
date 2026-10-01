// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Win32 input and window helpers: SendInput (mouse and keyboard), foreground window, virtual screen.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace GhostHand.UiaHost;

internal static class Native
{
    private const int INPUT_MOUSE = 0;
    private const int INPUT_KEYBOARD = 1;
    private const uint MOUSEEVENTF_MOVE = 0x0001;
    private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    private const uint MOUSEEVENTF_LEFTUP = 0x0004;
    private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    private const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    private const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    private const uint MOUSEEVENTF_WHEEL = 0x0800;
    private const uint MOUSEEVENTF_HWHEEL = 0x1000;
    private const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
    private const uint MOUSEEVENTF_VIRTUALDESK = 0x4000;
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const uint KEYEVENTF_UNICODE = 0x0004;
    private const int SM_XVIRTUALSCREEN = 76;
    private const int SM_YVIRTUALSCREEN = 77;
    private const int SM_CXVIRTUALSCREEN = 78;
    private const int SM_CYVIRTUALSCREEN = 79;

    [StructLayout(LayoutKind.Sequential)]
    private struct MOUSEINPUT
    {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT
    {
        public int type;
        public InputUnion U;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int nIndex);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    private static readonly IntPtr DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = new(-4);

    /// <summary>The manifest already asks for per-monitor v2; this covers hosts started without it.</summary>
    public static bool EnsureDpiAware()
    {
        try
        {
            return SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        }
        catch (EntryPointNotFoundException)
        {
            return false;
        }
    }

    public static string WindowTitle(IntPtr hWnd)
    {
        var sb = new StringBuilder(512);
        GetWindowText(hWnd, sb, sb.Capacity);
        return sb.ToString();
    }

    public static (int X, int Y, int W, int H) VirtualScreen() =>
        (GetSystemMetrics(SM_XVIRTUALSCREEN), GetSystemMetrics(SM_YVIRTUALSCREEN),
         GetSystemMetrics(SM_CXVIRTUALSCREEN), GetSystemMetrics(SM_CYVIRTUALSCREEN));

    private static void Send(params INPUT[] inputs)
    {
        if (inputs.Length == 0) return;
        var sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<INPUT>());
        if (sent != inputs.Length)
            throw new RpcException("driver", $"SendInput sent {sent}/{inputs.Length} events (error {Marshal.GetLastWin32Error()}); UIPI or a secure desktop may block it");
    }

    private static INPUT Mouse(uint flags, int dx = 0, int dy = 0, uint data = 0) => new()
    {
        type = INPUT_MOUSE,
        U = new InputUnion { mi = new MOUSEINPUT { dx = dx, dy = dy, dwFlags = flags, mouseData = data } },
    };

    private static INPUT Key(ushort vk, ushort scan, uint flags) => new()
    {
        type = INPUT_KEYBOARD,
        U = new InputUnion { ki = new KEYBDINPUT { wVk = vk, wScan = scan, dwFlags = flags } },
    };

    /// <summary>Absolute move in physical screen pixels (the process is per-monitor DPI aware).</summary>
    public static void MoveTo(double x, double y)
    {
        var (vx, vy, vw, vh) = VirtualScreen();
        var nx = (int)Math.Round((x - vx) * 65535.0 / Math.Max(1, vw - 1));
        var ny = (int)Math.Round((y - vy) * 65535.0 / Math.Max(1, vh - 1));
        Send(Mouse(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK, nx, ny));
    }

    public static void Click(double x, double y, string button, int count)
    {
        MoveTo(x, y);
        var (down, up) = button switch
        {
            "right" => (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP),
            "middle" => (MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP),
            _ => (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP),
        };
        for (var i = 0; i < Math.Clamp(count, 1, 3); i++)
        {
            try
            {
                Send(Mouse(down));
            }
            finally
            {
                Send(Mouse(up));
            }
            Thread.Sleep(50);
        }
    }

    public static void Drag(double x0, double y0, double x1, double y1)
    {
        MoveTo(x0, y0);
        Send(Mouse(MOUSEEVENTF_LEFTDOWN));
        try
        {
            for (var i = 1; i <= 8; i++)
            {
                MoveTo(x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8);
                Thread.Sleep(15);
            }
        }
        finally
        {
            Send(Mouse(MOUSEEVENTF_LEFTUP));
        }
    }

    public static void Scroll(double dx, double dy)
    {
        // WHEEL_DELTA (120) per notch; positive dy scrolls down, so the wheel delta is negative.
        if (dy != 0) Send(Mouse(MOUSEEVENTF_WHEEL, data: unchecked((uint)(int)Math.Round(-dy / 100.0 * 120))));
        if (dx != 0) Send(Mouse(MOUSEEVENTF_HWHEEL, data: unchecked((uint)(int)Math.Round(dx / 100.0 * 120))));
    }

    /// <summary>Types text as Unicode key events (layout independent). Never logged.</summary>
    public static void TypeText(string text)
    {
        foreach (var ch in text)
        {
            if (ch == '\n')
            {
                TapVk(0x0D);
                continue;
            }
            Send(Key(0, ch, KEYEVENTF_UNICODE), Key(0, ch, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP));
            Thread.Sleep(4);
        }
    }

    private static readonly Dictionary<string, ushort> Vk = new(StringComparer.OrdinalIgnoreCase)
    {
        ["enter"] = 0x0D, ["return"] = 0x0D, ["escape"] = 0x1B, ["esc"] = 0x1B, ["tab"] = 0x09, ["backspace"] = 0x08,
        ["delete"] = 0x2E, ["insert"] = 0x2D, ["space"] = 0x20, ["arrowup"] = 0x26, ["arrowdown"] = 0x28,
        ["arrowleft"] = 0x25, ["arrowright"] = 0x27, ["up"] = 0x26, ["down"] = 0x28, ["left"] = 0x25, ["right"] = 0x27,
        ["home"] = 0x24, ["end"] = 0x23, ["pageup"] = 0x21, ["pagedown"] = 0x22, ["control"] = 0x11, ["ctrl"] = 0x11,
        ["controlormeta"] = 0x11, ["shift"] = 0x10, ["alt"] = 0x12, ["meta"] = 0x5B, ["win"] = 0x5B,
        ["capslock"] = 0x14, ["contextmenu"] = 0x5D,
    };

    private static ushort VkOf(string key)
    {
        if (Vk.TryGetValue(key, out var vk)) return vk;
        if (key.Length > 1 && (key[0] == 'F' || key[0] == 'f') && int.TryParse(key[1..], out var f) && f is >= 1 and <= 24)
            return (ushort)(0x70 + f - 1);
        if (key.Length == 1)
        {
            var c = char.ToUpperInvariant(key[0]);
            if (c is >= 'A' and <= 'Z' or >= '0' and <= '9') return c;
        }
        throw new RpcException("unsupported", $"unknown key {key}");
    }

    private static void TapVk(ushort vk)
    {
        Send(Key(vk, 0, 0));
        Thread.Sleep(30);
        Send(Key(vk, 0, KEYEVENTF_KEYUP));
    }

    /// <summary>["Control","a"] or ["Control+a"]: presses in order, releases in reverse, always.</summary>
    public static void KeyCombo(IEnumerable<string> keys)
    {
        var parts = new List<string>();
        foreach (var k in keys)
            parts.AddRange(k.Length > 1 ? k.Split('+', StringSplitOptions.RemoveEmptyEntries) : new[] { k });
        var vks = parts.ConvertAll(VkOf);
        var pressed = new List<ushort>();
        try
        {
            foreach (var vk in vks)
            {
                Send(Key(vk, 0, 0));
                pressed.Add(vk);
            }
            Thread.Sleep(35);
        }
        finally
        {
            for (var i = pressed.Count - 1; i >= 0; i--) Send(Key(pressed[i], 0, KEYEVENTF_KEYUP));
        }
    }
}
