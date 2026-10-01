// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// RPC methods over UI Automation. Rules (plan §3.2): only refs of the latest snapshot act and are never
// re-resolved; patterns first (Invoke, Value, Toggle, SelectionItem, ExpandCollapse), SendInput only as a
// fallback; every act returns before/after read-backs; typed values are never logged.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Automation;

namespace GhostHand.UiaHost;

internal sealed class UiaHost
{
    private const int ProtocolVersion = 1;
    private const string HostVersion = "0.1.0";
    private readonly List<Process> _launched = new();
    private readonly HashSet<int> _pids = new();
    private readonly bool _dpiAware;
    private List<AutomationElement> _latest = new();
    private string? _latestId;
    private int _seq;
    private long _events;
    private Process? _recorder;

    public UiaHost()
    {
        _dpiAware = Native.EnsureDpiAware();
        try
        {
            Automation.AddAutomationFocusChangedEventHandler((_, _) => Interlocked.Increment(ref _events));
        }
        catch (Exception e)
        {
            Rpc.Log($"focus events unavailable: {e.GetType().Name}");
        }
    }

    public Dictionary<string, Func<JsonObject, JsonNode?>> Handlers() => new()
    {
        ["hello"] = Hello,
        ["doctor"] = Doctor,
        ["launch"] = Launch,
        ["observe"] = Observe,
        ["act"] = Act,
        ["input"] = Input,
        ["screenshot"] = Screenshot,
        ["wait_idle"] = WaitIdle,
        ["record_start"] = RecordStart,
        ["record_stop"] = RecordStop,
        ["close"] = Close,
    };

    // ---- scope ---------------------------------------------------------------------------------

    private static List<AutomationElement> TopWindows()
    {
        var list = new List<AutomationElement>();
        var walker = TreeWalker.ControlViewWalker;
        for (var w = walker.GetFirstChild(AutomationElement.RootElement); w is not null; w = walker.GetNextSibling(w))
            list.Add(w);
        return list;
    }

    private List<AutomationElement> AppWindows(bool desktop = false)
    {
        var all = TopWindows();
        if (desktop) return all;
        var mine = all.Where(w => UiaTree.Alive(w) && _pids.Contains(w.Current.ProcessId)).ToList();
        if (mine.Count > 0) return mine;
        var fg = Native.GetForegroundWindow();
        if (fg == IntPtr.Zero) return new List<AutomationElement>();
        try
        {
            return new List<AutomationElement> { AutomationElement.FromHandle(fg) };
        }
        catch (ElementNotAvailableException)
        {
            return new List<AutomationElement>();
        }
    }

    private JsonObject Global()
    {
        var windows = new JsonArray();
        var apps = AppWindows();
        foreach (var w in apps)
            if (UiaTree.Alive(w)) windows.Add($"{UiaTree.Role(w)}:{w.Current.Name}");
        var o = new JsonObject
        {
            ["windows"] = windows,
            ["events"] = Interlocked.Read(ref _events),
            ["contentHash"] = UiaTree.ContentHash(apps),
        };
        var fg = Native.GetForegroundWindow();
        if (fg != IntPtr.Zero) o["activeWindow"] = Native.WindowTitle(fg);
        try
        {
            var f = AutomationElement.FocusedElement;
            if (f is not null) o["focused"] = $"{UiaTree.Role(f)}:{f.Current.Name}";
        }
        catch (ElementNotAvailableException)
        {
            // focus moved during the read
        }
        return o;
    }

    private void Watch(AutomationElement window)
    {
        try
        {
            Automation.AddStructureChangedEventHandler(window, TreeScope.Subtree, (_, _) => Interlocked.Increment(ref _events));
            Automation.AddAutomationPropertyChangedEventHandler(window, TreeScope.Subtree,
                (_, _) => Interlocked.Increment(ref _events),
                AutomationElement.NameProperty, ValuePattern.ValueProperty, TogglePattern.ToggleStateProperty,
                SelectionItemPattern.IsSelectedProperty, ExpandCollapsePattern.ExpandCollapseStateProperty);
        }
        catch (Exception e)
        {
            Rpc.Log($"events unavailable for a window: {e.GetType().Name}");
        }
    }

    // ---- methods -------------------------------------------------------------------------------

    private JsonNode Hello(JsonObject p)
    {
        var (_, _, w, h) = Native.VirtualScreen();
        return new JsonObject
        {
            ["protocolVersion"] = ProtocolVersion,
            ["host"] = new JsonObject { ["name"] = "ghosthand-desktop-host-windows", ["version"] = HostVersion },
            ["platform"] = "windows",
            ["capabilities"] = new JsonObject
            {
                ["semanticActions"] = true,
                ["pointer"] = true,
                ["screenshots"] = true,
                ["recording"] = FfmpegPath() is not null,
                // Per-monitor v2 DPI awareness: UIA rectangles and SendInput share physical pixels.
                ["boundsTrust"] = _dpiAware || Environment.OSVersion.Version.Major >= 10 ? "exact" : "approximate",
            },
            ["screen"] = new JsonObject { ["width"] = w, ["height"] = h, ["scale"] = 1 },
        };
    }

    private JsonNode Doctor(JsonObject p)
    {
        var checks = new JsonArray();
        void Check(string name, bool ok, string detail) =>
            checks.Add(new JsonObject { ["name"] = name, ["ok"] = ok, ["detail"] = detail });
        var session = Process.GetCurrentProcess().SessionId;
        Check("interactive session", session != 0, session == 0 ? "Session 0 has no desktop (service context)" : $"session {session}");
        try
        {
            Check("uia", true, $"{TopWindows().Count} top-level windows");
        }
        catch (Exception e)
        {
            Check("uia", false, e.Message);
        }
        Check("dpi awareness", true, _dpiAware ? "per-monitor v2 (set at runtime)" : "from the manifest");
        var (x, y, w, h) = Native.VirtualScreen();
        Check("virtual screen", w > 0, $"{w}x{h} at {x},{y}");
        Check("ffmpeg", true, FfmpegPath() ?? "missing (optional: recording)");
        return new JsonObject { ["checks"] = checks };
    }

    private JsonNode Launch(JsonObject p)
    {
        var argv = (p["argv"] as JsonArray)?.Select(a => a?.GetValue<string>() ?? "").ToList() ?? new List<string>();
        if (argv.Count == 0) throw new RpcException("launch_failed", "argv is empty");
        var before = new HashSet<IntPtr>(TopWindows().Where(UiaTree.Alive).Select(w => new IntPtr(w.Current.NativeWindowHandle)));
        Process? proc;
        try
        {
            var psi = new ProcessStartInfo(argv[0]) { UseShellExecute = argv.Count == 1 };
            if (argv.Count > 1)
                foreach (var a in argv.Skip(1)) psi.ArgumentList.Add(a);
            if (p["cwd"] is JsonNode cwd) psi.WorkingDirectory = cwd.GetValue<string>();
            if (p["env"] is JsonObject env && !psi.UseShellExecute)
                foreach (var (k, v) in env) psi.Environment[k] = v?.GetValue<string>() ?? "";
            proc = Process.Start(psi);
        }
        catch (Exception e)
        {
            throw new RpcException("launch_failed", $"cannot start {Path.GetFileName(argv[0])}: {e.Message}");
        }
        if (proc is not null)
        {
            _launched.Add(proc);
            _pids.Add(proc.Id);
        }
        var waitMs = p["waitMs"]?.GetValue<int>() ?? 15000;
        var clock = Stopwatch.StartNew();
        AutomationElement? window = null;
        while (clock.ElapsedMilliseconds < waitMs && window is null)
        {
            foreach (var w in TopWindows())
            {
                if (!UiaTree.Alive(w)) continue;
                var pid = w.Current.ProcessId;
                var isNew = !before.Contains(new IntPtr(w.Current.NativeWindowHandle));
                // Packaged apps (new Notepad) relaunch under another process: adopt the new window's process.
                if (_pids.Contains(pid) || isNew)
                {
                    window = w;
                    _pids.Add(pid);
                    break;
                }
            }
            if (window is null) Thread.Sleep(150);
        }
        if (window is null)
            throw new RpcException("launch_failed", $"no window from {Path.GetFileName(argv[0])} within {waitMs} ms");
        Watch(window);
        Quiet(2000, 300);
        return new JsonObject { ["pid"] = window.Current.ProcessId, ["windowTitle"] = window.Current.Name };
    }

    private JsonNode Observe(JsonObject p)
    {
        var clock = Stopwatch.StartNew();
        var windows = AppWindows(p["scope"]?.GetValue<string>() == "desktop");
        var walk = new UiaTree.Walk(p["maxNodes"]?.GetValue<int>() ?? 2000, p["maxDepth"]?.GetValue<int>() ?? 40,
            p["timeoutMs"]?.GetValue<int>() ?? 5000);
        walk.Run(windows);
        var id = $"w{++_seq}";
        if (p["transient"]?.GetValue<bool>() != true)
        {
            _latestId = id;
            _latest = walk.Elements;
        }
        var (vx, vy, vw, vh) = Native.VirtualScreen();
        var fg = Native.GetForegroundWindow();
        var o = new JsonObject
        {
            ["snapshotId"] = id,
            ["takenAt"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            ["screen"] = new JsonObject { ["x"] = vx, ["y"] = vy, ["width"] = vw, ["height"] = vh },
            ["scale"] = 1,
            ["title"] = fg != IntPtr.Zero ? Native.WindowTitle(fg) : "",
            ["nodes"] = walk.Nodes,
            ["complete"] = walk.Complete,
            ["walkMs"] = clock.ElapsedMilliseconds,
        };
        if (walk.Degraded is not null) o["degradedReason"] = walk.Degraded;
        return o;
    }

    private AutomationElement Resolve(JsonObject p)
    {
        var sid = p["snapshotId"]?.GetValue<string>();
        var r = p["ref"]?.GetValue<int>() ?? -1;
        if (sid != _latestId) throw new RpcException("stale_token", $"snapshot {sid} is not the latest ({_latestId}); observe again");
        if (r < 0 || r >= _latest.Count) throw new RpcException("stale_token", $"ref {r} is not in snapshot {sid}");
        var el = _latest[r];
        if (!UiaTree.Alive(el)) throw new RpcException("stale_token", $"the element of ref {r} is gone; observe again");
        return el;
    }

    private (long Waited, string Reason) Quiet(int capMs, int quietMs)
    {
        var clock = Stopwatch.StartNew();
        var last = Interlocked.Read(ref _events);
        var lastHash = UiaTree.ContentHash(AppWindows(), 400);
        var since = clock.ElapsedMilliseconds;
        while (true)
        {
            Thread.Sleep(40);
            var ev = Interlocked.Read(ref _events);
            var hash = UiaTree.ContentHash(AppWindows(), 400);
            if (ev != last || hash != lastHash)
            {
                last = ev;
                lastHash = hash;
                since = clock.ElapsedMilliseconds;
            }
            if (clock.ElapsedMilliseconds - since >= quietMs) return (clock.ElapsedMilliseconds, "quiet");
            if (clock.ElapsedMilliseconds >= capMs) return (clock.ElapsedMilliseconds, "cap");
        }
    }

    private JsonNode Act(JsonObject p)
    {
        var op = p["op"]?.GetValue<string>() ?? "";
        var el = Resolve(p);
        var g0 = Global();
        var before = UiaTree.Probe(el);
        _latestId = null;
        _latest = new List<AutomationElement>();
        string route;
        string native;
        JsonObject? error = null;
        try
        {
            (route, native) = Dispatch(op, el, p, before);
        }
        catch (RpcException e) when (e.Kind is "not_interactable" or "unsupported" or "not_found")
        {
            return new JsonObject
            {
                ["ok"] = false, ["route"] = "none", ["nativeRoute"] = "", ["before"] = before?.DeepClone(),
                ["after"] = before?.DeepClone(), ["globalBefore"] = g0, ["globalAfter"] = g0.DeepClone(),
                ["error"] = new JsonObject { ["kind"] = e.Kind, ["message"] = e.Message },
            };
        }
        catch (RpcException e)
        {
            (route, native) = ("semantic", "");
            error = new JsonObject { ["kind"] = e.Kind, ["message"] = e.Message };
        }
        catch (ElementNotAvailableException e)
        {
            (route, native) = ("semantic", "");
            error = new JsonObject { ["kind"] = "driver", ["message"] = e.Message };
        }
        var quick = op is "set_value" or "toggle" or "focus" or "scroll_into_view" or "select_text" or "select_option";
        Quiet(quick ? 600 : 1500, quick ? 120 : 250);
        var o = new JsonObject
        {
            ["ok"] = error is null,
            ["route"] = route,
            ["nativeRoute"] = native,
            ["before"] = before,
            ["after"] = UiaTree.Probe(el),
            ["globalBefore"] = g0,
            ["globalAfter"] = Global(),
        };
        if (error is not null) o["error"] = error;
        return o;
    }

    /// <summary>Invoke can block while the target shows a modal dialog: run it with a 2 s watchdog.</summary>
    private static string InvokeWithWatchdog(InvokePattern invoke)
    {
        var task = Task.Run(invoke.Invoke);
        return task.Wait(2000) ? "uia.invoke" : "uia.invoke(still running after 2 s)";
    }

    private (string Route, string Native)? PointerClick(AutomationElement el)
    {
        var r = el.Current.BoundingRectangle;
        if (r.IsEmpty) return null;
        Native.Click(r.X + r.Width / 2, r.Y + r.Height / 2, "left", 1);
        return ("pointer", "sendinput.click");
    }

    private (string Route, string Native) Dispatch(string op, AutomationElement el, JsonObject p, JsonObject? before)
    {
        switch (op)
        {
            case "press":
            {
                if (UiaTree.Pattern<InvokePattern>(el, InvokePattern.Pattern) is { } inv) return ("semantic", InvokeWithWatchdog(inv));
                if (UiaTree.Pattern<TogglePattern>(el, TogglePattern.Pattern) is { } tg)
                {
                    tg.Toggle();
                    return ("semantic", "uia.toggle");
                }
                if (UiaTree.Pattern<SelectionItemPattern>(el, SelectionItemPattern.Pattern) is { } si)
                {
                    si.Select();
                    return ("semantic", "uia.selection_item.select");
                }
                if (UiaTree.Pattern<ExpandCollapsePattern>(el, ExpandCollapsePattern.Pattern) is { } ec)
                {
                    if (ec.Current.ExpandCollapseState == ExpandCollapseState.Expanded) ec.Collapse();
                    else ec.Expand();
                    return ("semantic", "uia.expand_collapse");
                }
                return PointerClick(el) ?? throw new RpcException("not_interactable", "no pattern and no bounds");
            }
            case "set_value":
                return SetValue(el, p["value"]?.GetValue<string>() ?? "", before);
            case "toggle":
            {
                var want = p["checked"]?.GetValue<bool>();
                var states = (before?["states"] as JsonArray)?.Select(s => s?.GetValue<string>()).ToList() ?? new List<string?>();
                var on = states.Contains("checked");
                if (want is not null && want.Value == on) return ("semantic", "noop.already_in_state");
                if (UiaTree.Pattern<TogglePattern>(el, TogglePattern.Pattern) is { } tg)
                {
                    tg.Toggle();
                    return ("semantic", "uia.toggle");
                }
                if (UiaTree.Pattern<SelectionItemPattern>(el, SelectionItemPattern.Pattern) is { } si)
                {
                    si.Select();
                    return ("semantic", "uia.selection_item.select");
                }
                return PointerClick(el) ?? throw new RpcException("not_interactable", "cannot toggle");
            }
            case "select_option":
                return SelectOption(el, p["option"]?.GetValue<string>() ?? "");
            case "focus":
                el.SetFocus();
                return ("semantic", "uia.set_focus");
            case "scroll_into_view":
                if (UiaTree.Pattern<ScrollItemPattern>(el, ScrollItemPattern.Pattern) is { } sc)
                {
                    sc.ScrollIntoView();
                    return ("semantic", "uia.scroll_item");
                }
                return ("semantic", "noop.no_scroll_item");
            case "select_text":
            {
                var text = p["text"]?.GetValue<string>() ?? "";
                var tp = UiaTree.Pattern<TextPattern>(el, TextPattern.Pattern) ?? throw new RpcException("not_interactable", "no text pattern");
                var range = tp.DocumentRange.FindText(text, false, true) ?? throw new RpcException("not_found", "text not found");
                range.Select();
                return ("semantic", "uia.text.select");
            }
            default:
                throw new RpcException("unsupported", $"unknown op {op}");
        }
    }

    private (string Route, string Native) SetValue(AutomationElement el, string value, JsonObject? before)
    {
        var vp = UiaTree.Pattern<ValuePattern>(el, ValuePattern.Pattern);
        if (vp is not null && !vp.Current.IsReadOnly)
        {
            try
            {
                vp.SetValue(value);
                var after = UiaTree.Probe(el);
                var got = after?["value"]?.GetValue<string>();
                var len = after?["valueLength"]?.GetValue<int>();
                if (got == value || len == value.Length) return ("semantic", "uia.value.set_value");
            }
            catch (InvalidOperationException)
            {
                // some controls (password boxes) refuse SetValue: fall through to typing
            }
        }
        else if (UiaTree.Pattern<RangeValuePattern>(el, RangeValuePattern.Pattern) is { } rv)
        {
            if (!double.TryParse(value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var num))
                throw new RpcException("not_interactable", "this control takes a number");
            rv.SetValue(num);
            return ("semantic", "uia.range_value.set_value");
        }
        // Idempotent keyboard fallback: focus, select all, type. Only when the semantic route changed nothing.
        var now = UiaTree.Probe(el);
        var unchanged = now?["value"]?.ToJsonString() == before?["value"]?.ToJsonString()
                        && now?["valueLength"]?.ToJsonString() == before?["valueLength"]?.ToJsonString();
        if (!unchanged) return ("semantic", "uia.value.set_value");
        el.SetFocus();
        Native.KeyCombo(new[] { "Control", "a" });
        Native.TypeText(value);
        return ("keyboard", "sendinput.type");
    }

    private (string Route, string Native) SelectOption(AutomationElement el, string option)
    {
        var want = option.Trim();
        AutomationElement? Find()
        {
            var opts = UiaTree.Options(el);
            var exact = opts.FirstOrDefault(o => string.Equals(o.Current.Name?.Trim(), want, StringComparison.OrdinalIgnoreCase));
            if (exact is not null) return exact;
            var partial = opts.Where(o => (o.Current.Name ?? "").Contains(want, StringComparison.OrdinalIgnoreCase)).ToList();
            return partial.Count == 1 ? partial[0] : null;
        }
        var item = Find();
        var ec = UiaTree.Pattern<ExpandCollapsePattern>(el, ExpandCollapsePattern.Pattern);
        var expanded = false;
        if (item is null && ec is not null)
        {
            ec.Expand();
            expanded = true;
            Thread.Sleep(200);
            item = Find();
        }
        try
        {
            if (item is null) throw new RpcException("not_found", "no single option matches");
            if (UiaTree.Pattern<SelectionItemPattern>(item, SelectionItemPattern.Pattern) is { } si)
            {
                si.Select();
                return ("semantic", "uia.selection_item.select");
            }
            if (UiaTree.Pattern<InvokePattern>(item, InvokePattern.Pattern) is { } inv) return ("semantic", InvokeWithWatchdog(inv));
            throw new RpcException("not_interactable", "the option has no pattern");
        }
        finally
        {
            if (expanded && UiaTree.Alive(el) && ec!.Current.ExpandCollapseState == ExpandCollapseState.Expanded) ec.Collapse();
        }
    }

    private JsonNode Input(JsonObject p)
    {
        var op = p["op"]?.GetValue<string>() ?? "";
        var g0 = Global();
        var f0 = FocusedValue();
        _latestId = null;
        _latest = new List<AutomationElement>();
        double D(string k) => p[k]?.GetValue<double>() ?? throw new RpcException("driver", $"{k} is required");
        switch (op)
        {
            case "click":
                Native.Click(D("x"), D("y"), p["button"]?.GetValue<string>() ?? "left", p["count"]?.GetValue<int>() ?? 1);
                break;
            case "move":
                Native.MoveTo(D("x"), D("y"));
                break;
            case "drag":
                Native.Drag(D("x"), D("y"), D("toX"), D("toY"));
                break;
            case "scroll":
                if (p["x"] is not null && p["y"] is not null) Native.MoveTo(D("x"), D("y"));
                Native.Scroll(p["dx"]?.GetValue<double>() ?? 0, p["dy"]?.GetValue<double>() ?? 0);
                break;
            case "type":
                Native.TypeText(p["text"]?.GetValue<string>() ?? "");
                break;
            case "key":
                Native.KeyCombo((p["keys"] as JsonArray)?.Select(k => k?.GetValue<string>() ?? "") ?? Array.Empty<string>());
                break;
            default:
                throw new RpcException("unsupported", $"unknown input op {op}");
        }
        Quiet(1500, 200);
        var o = new JsonObject
        {
            ["ok"] = true,
            ["route"] = op is "type" or "key" ? "keyboard" : "pointer",
            ["nativeRoute"] = $"sendinput.{op}",
            ["globalBefore"] = g0,
            ["globalAfter"] = Global(),
        };
        if (f0 is not null) o["focusedBefore"] = f0;
        var f1 = FocusedValue();
        if (f1 is not null) o["focusedAfter"] = f1;
        return o;
    }

    private static JsonObject? FocusedValue()
    {
        try
        {
            var f = AutomationElement.FocusedElement;
            if (f is null) return null;
            var probe = UiaTree.Probe(f);
            if (probe is null) return null;
            var o = new JsonObject { ["role"] = UiaTree.Role(f), ["name"] = f.Current.Name ?? "" };
            if (probe["value"] is JsonNode v) o["value"] = v.DeepClone();
            if (probe["valueLength"] is JsonNode l) o["valueLength"] = l.DeepClone();
            return o;
        }
        catch (ElementNotAvailableException)
        {
            return null;
        }
    }

    private JsonNode Screenshot(JsonObject p)
    {
        var (vx, vy, vw, vh) = Native.VirtualScreen();
        int x = vx, y = vy, w = vw, h = vh;
        if (p["region"] is JsonObject r)
        {
            x = (int)r["x"]!.GetValue<double>();
            y = (int)r["y"]!.GetValue<double>();
            w = Math.Max(1, (int)r["width"]!.GetValue<double>());
            h = Math.Max(1, (int)r["height"]!.GetValue<double>());
        }
        using var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp)) g.CopyFromScreen(x, y, 0, 0, new Size(w, h), CopyPixelOperation.SourceCopy);
        using var ms = new MemoryStream();
        bmp.Save(ms, ImageFormat.Png);
        return new JsonObject
        {
            ["data"] = Convert.ToBase64String(ms.ToArray()),
            ["mimeType"] = "image/png",
            ["width"] = w,
            ["height"] = h,
            ["scale"] = 1,
        };
    }

    private JsonNode WaitIdle(JsonObject p)
    {
        var (waited, reason) = Quiet(p["capMs"]?.GetValue<int>() ?? 3000, p["quietMs"]?.GetValue<int>() ?? 250);
        return new JsonObject { ["waitedMs"] = waited, ["reason"] = reason };
    }

    private static string? FfmpegPath()
    {
        foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator))
        {
            if (string.IsNullOrEmpty(dir)) continue;
            var f = Path.Combine(dir, "ffmpeg.exe");
            if (File.Exists(f)) return f;
        }
        return null;
    }

    private JsonNode RecordStart(JsonObject p)
    {
        if (_recorder is not null) throw new RpcException("driver", "already recording");
        var ffmpeg = FfmpegPath() ?? throw new RpcException("unsupported", "ffmpeg is not on PATH; recording is unavailable");
        var path = p["path"]?.GetValue<string>() ?? throw new RpcException("driver", "path is required");
        Directory.CreateDirectory(Path.GetDirectoryName(path) ?? ".");
        var psi = new ProcessStartInfo(ffmpeg) { UseShellExecute = false, RedirectStandardInput = true, CreateNoWindow = true };
        foreach (var a in new[] { "-loglevel", "error", "-y", "-f", "gdigrab", "-framerate", "10", "-i", "desktop", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", path })
            psi.ArgumentList.Add(a);
        _recorder = Process.Start(psi) ?? throw new RpcException("driver", "ffmpeg did not start");
        _recordPath = path;
        return new JsonObject();
    }

    private string? _recordPath;

    private JsonNode RecordStop(JsonObject p)
    {
        var rec = _recorder ?? throw new RpcException("driver", "not recording");
        _recorder = null;
        try
        {
            rec.StandardInput.Write("q");
            rec.StandardInput.Close();
            if (!rec.WaitForExit(10000)) rec.Kill();
        }
        catch (Exception e)
        {
            Rpc.Log($"ffmpeg stop: {e.GetType().Name}");
        }
        var files = new JsonArray();
        if (_recordPath is not null && File.Exists(_recordPath)) files.Add(_recordPath);
        return new JsonObject { ["files"] = files };
    }

    private JsonNode Close(JsonObject p)
    {
        if (_recorder is not null) RecordStop(new JsonObject());
        foreach (var proc in _launched)
        {
            try
            {
                // Close politely; never kill an app that may hold the user's unsaved work.
                if (!proc.HasExited) proc.CloseMainWindow();
            }
            catch (InvalidOperationException)
            {
                // already gone
            }
        }
        try
        {
            Automation.RemoveAllEventHandlers();
        }
        catch (Exception)
        {
            // best effort
        }
        return new JsonObject();
    }
}
