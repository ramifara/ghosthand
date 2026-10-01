// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// UI Automation observation: native facts only (control type, name, patterns, states, bounds). The TypeScript
// client maps roles (UIA Text is static text, Edit is a textbox), ranks, redacts and builds the element table.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json.Nodes;
using System.Windows.Automation;

namespace GhostHand.UiaHost;

internal static class UiaTree
{
    private const int MaxOptions = 1024;
    private const uint WM_GETTEXTLENGTH = 0x000E;

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);

    public static readonly (AutomationPattern Pattern, string Name)[] Patterns =
    {
        (InvokePattern.Pattern, "Invoke"),
        (ValuePattern.Pattern, "Value"),
        (TogglePattern.Pattern, "Toggle"),
        (SelectionItemPattern.Pattern, "SelectionItem"),
        (ExpandCollapsePattern.Pattern, "ExpandCollapse"),
        (SelectionPattern.Pattern, "Selection"),
        (RangeValuePattern.Pattern, "RangeValue"),
        (TextPattern.Pattern, "Text"),
        (ScrollItemPattern.Pattern, "ScrollItem"),
    };

    public static T? Pattern<T>(AutomationElement el, AutomationPattern p) where T : BasePattern =>
        el.TryGetCurrentPattern(p, out var obj) ? obj as T : null;

    public static string Role(AutomationElement el) =>
        el.Current.ControlType.ProgrammaticName.Replace("ControlType.", "", StringComparison.Ordinal);

    public static bool Alive(AutomationElement el)
    {
        try
        {
            _ = el.Current.ProcessId;
            return true;
        }
        catch (ElementNotAvailableException)
        {
            return false;
        }
    }

    public static JsonObject? Bounds(AutomationElement el)
    {
        var r = el.Current.BoundingRectangle;
        if (r.IsEmpty || r.Width <= 0 || r.Height <= 0 || double.IsInfinity(r.Width)) return null;
        return new JsonObject { ["x"] = r.X, ["y"] = r.Y, ["width"] = r.Width, ["height"] = r.Height };
    }

    public static (List<string> Interfaces, List<string> Actions) PatternsOf(AutomationElement el)
    {
        var ifaces = new List<string>();
        var actions = new List<string>();
        foreach (var (p, name) in Patterns)
        {
            if (!el.TryGetCurrentPattern(p, out _)) continue;
            ifaces.Add(name);
            if (name is "Invoke" or "Toggle" or "SelectionItem" or "ExpandCollapse") actions.Add(name);
        }
        return (ifaces, actions);
    }

    /// <summary>States in the shared vocabulary (AT-SPI names), so one client mapping serves every host.</summary>
    public static List<string> States(AutomationElement el)
    {
        var c = el.Current;
        var s = new List<string>();
        if (c.IsEnabled)
        {
            s.Add("enabled");
            s.Add("sensitive");
        }
        if (c.HasKeyboardFocus) s.Add("focused");
        if (c.IsKeyboardFocusable) s.Add("focusable");
        if (c.IsOffscreen) s.Add("offscreen");
        else
        {
            s.Add("showing");
            s.Add("visible");
        }
        var toggle = Pattern<TogglePattern>(el, TogglePattern.Pattern);
        if (toggle is not null)
        {
            if (toggle.Current.ToggleState == ToggleState.On) s.Add("checked");
            else if (toggle.Current.ToggleState == ToggleState.Indeterminate) s.Add("indeterminate");
        }
        var item = Pattern<SelectionItemPattern>(el, SelectionItemPattern.Pattern);
        if (item is not null)
        {
            s.Add("selectable");
            if (item.Current.IsSelected) s.Add(Role(el) == "RadioButton" ? "checked" : "selected");
        }
        var ec = Pattern<ExpandCollapsePattern>(el, ExpandCollapsePattern.Pattern);
        if (ec is not null)
        {
            if (ec.Current.ExpandCollapseState == ExpandCollapseState.Expanded) s.Add("expanded");
            else if (ec.Current.ExpandCollapseState != ExpandCollapseState.LeafNode) s.Add("expandable");
        }
        var value = Pattern<ValuePattern>(el, ValuePattern.Pattern);
        if (value is not null) s.Add(value.Current.IsReadOnly ? "read-only" : "editable");
        else if (Role(el) is "Edit" or "Document" && c.IsKeyboardFocusable && el.TryGetCurrentPattern(TextPattern.Pattern, out _))
            s.Add("editable"); // rich edit controls (Win11 Notepad) expose TextPattern only; typing edits them
        return s;
    }

    /// <summary>Length of a password field's text (Win32 edits answer WM_GETTEXTLENGTH without the text).</summary>
    public static int? PasswordLength(AutomationElement el)
    {
        var hwnd = new IntPtr(el.Current.NativeWindowHandle);
        if (hwnd == IntPtr.Zero) return null;
        return SendMessageTimeout(hwnd, WM_GETTEXTLENGTH, IntPtr.Zero, IntPtr.Zero, 0x0002, 500, out var len) == IntPtr.Zero
            ? null
            : (int)len.ToInt64();
    }

    public static string? ValueOf(AutomationElement el)
    {
        var v = Pattern<ValuePattern>(el, ValuePattern.Pattern);
        if (v is not null) return v.Current.Value;
        var rv = Pattern<RangeValuePattern>(el, RangeValuePattern.Pattern);
        if (rv is not null) return rv.Current.Value.ToString(System.Globalization.CultureInfo.InvariantCulture);
        if (Role(el) is "Edit" or "Document" && Pattern<TextPattern>(el, TextPattern.Pattern) is { } tp)
            return tp.DocumentRange.GetText(4000).TrimEnd('\r', '\n');
        return null;
    }

    public static string? SelectedOption(AutomationElement el)
    {
        var sel = Pattern<SelectionPattern>(el, SelectionPattern.Pattern);
        if (sel is not null)
        {
            var items = sel.Current.GetSelection();
            if (items.Length > 0) return items[0].Current.Name;
        }
        return Role(el) == "ComboBox" ? Pattern<ValuePattern>(el, ValuePattern.Pattern)?.Current.Value : null;
    }

    public static List<AutomationElement> Options(AutomationElement el)
    {
        var cond = new OrCondition(
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.ListItem),
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.MenuItem),
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.TreeItem),
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.DataItem));
        var found = el.FindAll(TreeScope.Descendants, cond);
        var list = new List<AutomationElement>();
        foreach (AutomationElement item in found)
        {
            list.Add(item);
            if (list.Count >= MaxOptions) break;
        }
        return list;
    }

    public static JsonObject? Probe(AutomationElement el)
    {
        if (!Alive(el)) return null;
        try
        {
            var o = new JsonObject
            {
                ["name"] = el.Current.Name ?? "",
                ["states"] = ToArray(States(el)),
                ["childCount"] = ChildCount(el),
            };
            if (el.Current.IsPassword)
            {
                var len = PasswordLength(el);
                if (len is not null) o["valueLength"] = len;
            }
            else
            {
                var v = ValueOf(el);
                if (v is not null) o["value"] = v;
            }
            var sel = SelectedOption(el);
            if (sel is not null) o["selectedOption"] = sel;
            return o;
        }
        catch (ElementNotAvailableException)
        {
            return null;
        }
    }

    public static int ChildCount(AutomationElement el)
    {
        var n = 0;
        var walker = TreeWalker.ControlViewWalker;
        for (var c = walker.GetFirstChild(el); c is not null && n < 2000; c = walker.GetNextSibling(c)) n++;
        return n;
    }

    public static JsonArray ToArray(IEnumerable<string> items)
    {
        var a = new JsonArray();
        foreach (var i in items) a.Add(i);
        return a;
    }

    /// <summary>FNV-1a over control types and names of the subtree (no values): visible content changed.</summary>
    public static string ContentHash(IEnumerable<AutomationElement> roots, int budget = 1500)
    {
        uint h = 2166136261;
        var walker = TreeWalker.ControlViewWalker;
        var stack = new Stack<AutomationElement>(roots);
        while (stack.Count > 0 && budget-- > 0)
        {
            var el = stack.Pop();
            try
            {
                foreach (var ch in $"{el.Current.ControlType.Id}\u001f{el.Current.Name}\u001e")
                {
                    h ^= ch;
                    h *= 16777619;
                }
                for (var c = walker.GetFirstChild(el); c is not null; c = walker.GetNextSibling(c)) stack.Push(c);
            }
            catch (ElementNotAvailableException)
            {
                // gone mid-walk
            }
        }
        return h.ToString("x8");
    }

    public sealed class Walk
    {
        private readonly int _maxNodes;
        private readonly int _maxDepth;
        private readonly Stopwatch _clock = Stopwatch.StartNew();
        private readonly long _timeoutMs;

        public Walk(int maxNodes, int maxDepth, long timeoutMs)
        {
            _maxNodes = maxNodes;
            _maxDepth = maxDepth;
            _timeoutMs = timeoutMs;
        }

        private readonly object _lock = new();
        private bool _abandoned;

        public JsonArray Nodes { get; } = new();
        public List<AutomationElement> Elements { get; } = new();
        public bool Complete { get; private set; } = true;
        public string? Degraded { get; private set; }

        public void Run(IEnumerable<AutomationElement> windows)
        {
            foreach (var w in windows) Visit(w, null, 0, null);
        }

        /// <summary>Stops the walk where it is (it may be blocked inside a UIA call).</summary>
        public void Abandon()
        {
            lock (_lock)
            {
                _abandoned = true;
                Complete = false;
                Degraded = "observation timed out inside a UI Automation call";
            }
        }

        /// <summary>A consistent copy of the nodes collected so far.</summary>
        public JsonArray Snapshot()
        {
            lock (_lock)
            {
                var copy = new JsonArray();
                foreach (var n in Nodes) copy.Add(n?.DeepClone());
                return copy;
            }
        }

        private void Visit(AutomationElement el, int? parent, int depth, int? window)
        {
            if (Elements.Count >= _maxNodes)
            {
                Complete = false;
                Degraded = $"node cap {_maxNodes} reached";
                return;
            }
            if (_abandoned) return;
            if (Elements.Count % 100 == 0 && Elements.Count > 0)
                Rpc.Log($"observe: {Elements.Count} nodes after {_clock.ElapsedMilliseconds} ms");
            if (_clock.ElapsedMilliseconds > _timeoutMs)
            {
                Complete = false;
                Degraded = "observation timed out";
                return;
            }
            AutomationElement.AutomationElementInformation c;
            try
            {
                c = el.Current;
            }
            catch (ElementNotAvailableException)
            {
                return;
            }
            if (depth > 0 && c.IsOffscreen && Role(el) is not ("ListItem" or "TreeItem" or "DataItem")) return;
            var role = Role(el);
            var refId = Elements.Count;
            window ??= refId;
            var (ifaces, actions) = PatternsOf(el);
            var node = new JsonObject
            {
                ["ref"] = refId,
                ["parent"] = parent,
                ["depth"] = depth,
                ["role"] = role,
                ["name"] = c.Name ?? "",
                ["states"] = ToArray(States(el)),
                ["interfaces"] = ToArray(ifaces),
                ["actions"] = ToArray(actions),
                ["bounds"] = Bounds(el),
                ["window"] = window,
                ["childCount"] = 0,
                ["secret"] = c.IsPassword,
            };
            if (!string.IsNullOrEmpty(c.LocalizedControlType)) node["subrole"] = c.LocalizedControlType;
            if (!string.IsNullOrEmpty(c.AutomationId)) node["automationId"] = c.AutomationId;
            if (!string.IsNullOrEmpty(c.HelpText)) node["description"] = c.HelpText;
            if (c.IsPassword)
            {
                var len = PasswordLength(el);
                if (len is not null) node["valueLength"] = len;
            }
            else
            {
                var v = ValueOf(el);
                if (v is not null) node["value"] = v.Length > 4000 ? v[..4000] : v;
            }
            var rv = Pattern<RangeValuePattern>(el, RangeValuePattern.Pattern);
            if (rv is not null)
                node["range"] = new JsonObject
                {
                    ["min"] = rv.Current.Minimum,
                    ["max"] = rv.Current.Maximum,
                    ["step"] = rv.Current.SmallChange,
                };
            if (role is "ComboBox" or "List")
            {
                var options = Options(el);
                if (options.Count > 0)
                {
                    var names = new JsonArray();
                    foreach (var o in options) names.Add(o.Current.Name ?? "");
                    node["options"] = names;
                    node["optionCount"] = options.Count;
                }
                var selected = SelectedOption(el);
                if (selected is not null) node["selectedOption"] = selected;
            }
            var slow = _clock.ElapsedMilliseconds;
            lock (_lock)
            {
                if (_abandoned) return;
                Nodes.Add(node);
                Elements.Add(el);
            }
            if (slow > 1000 && Elements.Count < 5) Rpc.Log($"observe: first nodes slow ({slow} ms at {role})");
            if (role == "ComboBox" || depth >= _maxDepth) return;
            var walker = TreeWalker.ControlViewWalker;
            var count = 0;
            for (var ch = walker.GetFirstChild(el); ch is not null; ch = walker.GetNextSibling(ch))
            {
                count++;
                Visit(ch, refId, depth + 1, window);
                if (count >= 2000) break;
            }
            node["childCount"] = count;
        }
    }
}
