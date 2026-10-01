// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// AXUIElement observation: native facts only (role, subrole, label, value, actions, states, frame in global
// points with a top-left origin). The TypeScript client maps roles and builds the element table.
import AppKit
import ApplicationServices
import Foundation

enum AX {
    static func attr(_ el: AXUIElement, _ name: String) -> CFTypeRef? {
        var value: CFTypeRef?
        let err = AXUIElementCopyAttributeValue(el, name as CFString, &value)
        return err == .success ? value : nil
    }

    static func string(_ el: AXUIElement, _ name: String) -> String? {
        guard let v = attr(el, name) else { return nil }
        if let s = v as? String { return s }
        if let n = v as? NSNumber { return n.stringValue }
        return nil
    }

    static func bool(_ el: AXUIElement, _ name: String) -> Bool? {
        (attr(el, name) as? NSNumber)?.boolValue
    }

    static func children(_ el: AXUIElement) -> [AXUIElement] {
        (attr(el, kAXChildrenAttribute as String) as? [AXUIElement]) ?? []
    }

    static func actions(_ el: AXUIElement) -> [String] {
        var names: CFArray?
        guard AXUIElementCopyActionNames(el, &names) == .success, let list = names as? [String] else { return [] }
        return list
    }

    static func settable(_ el: AXUIElement, _ name: String) -> Bool {
        var ok = DarwinBoolean(false)
        return AXUIElementIsAttributeSettable(el, name as CFString, &ok) == .success && ok.boolValue
    }

    static func role(_ el: AXUIElement) -> String { string(el, kAXRoleAttribute as String) ?? "AXUnknown" }

    static func subrole(_ el: AXUIElement) -> String? { string(el, kAXSubroleAttribute as String) }

    static func isSecure(_ el: AXUIElement) -> Bool { subrole(el) == "AXSecureTextField" }

    /// title, then description, then the linked title element, then the help text.
    static func label(_ el: AXUIElement) -> String {
        if let t = string(el, kAXTitleAttribute as String), !t.isEmpty { return t }
        if let d = string(el, kAXDescriptionAttribute as String), !d.isEmpty { return d }
        if let linked = attr(el, kAXTitleUIElementAttribute as String) {
            let titleEl = linked as! AXUIElement
            if let v = string(titleEl, kAXValueAttribute as String), !v.isEmpty { return v }
        }
        return string(el, kAXHelpAttribute as String) ?? ""
    }

    static func frame(_ el: AXUIElement) -> CGRect? {
        guard let p = attr(el, kAXPositionAttribute as String), let s = attr(el, kAXSizeAttribute as String) else { return nil }
        var point = CGPoint.zero
        var size = CGSize.zero
        guard AXValueGetValue(p as! AXValue, .cgPoint, &point), AXValueGetValue(s as! AXValue, .cgSize, &size) else { return nil }
        if size.width <= 0 || size.height <= 0 { return nil }
        return CGRect(origin: point, size: size)
    }

    static func rectJson(_ r: CGRect) -> Json {
        ["x": Double(r.origin.x), "y": Double(r.origin.y), "width": Double(r.size.width), "height": Double(r.size.height)]
    }

    static func valueString(_ el: AXUIElement) -> String? {
        if isSecure(el) { return nil }
        guard let v = attr(el, kAXValueAttribute as String) else { return nil }
        if let s = v as? String { return s }
        if let n = v as? NSNumber { return n.stringValue }
        return nil
    }

    static func secureLength(_ el: AXUIElement) -> Int? {
        (attr(el, kAXNumberOfCharactersAttribute as String) as? NSNumber)?.intValue
    }

    /// States in the shared vocabulary (AT-SPI names).
    static func states(_ el: AXUIElement) -> [String] {
        var s: [String] = []
        if bool(el, kAXEnabledAttribute as String) ?? true {
            s.append("enabled")
            s.append("sensitive")
        }
        if bool(el, kAXFocusedAttribute as String) == true { s.append("focused") }
        if settable(el, kAXFocusedAttribute as String) { s.append("focusable") }
        s.append("showing")
        s.append("visible")
        let r = AX.role(el)
        if r == "AXCheckBox" || r == "AXRadioButton" || r == "AXMenuItem" {
            if let n = attr(el, kAXValueAttribute as String) as? NSNumber {
                if n.intValue == 1 { s.append("checked") } else if n.intValue == 2 { s.append("indeterminate") }
            }
        }
        if bool(el, kAXSelectedAttribute as String) == true { s.append("selected") }
        if settable(el, kAXSelectedAttribute as String) { s.append("selectable") }
        if let expanded = bool(el, kAXExpandedAttribute as String) { s.append(expanded ? "expanded" : "expandable") }
        let textLike = ["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"].contains(r)
        if textLike { s.append(settable(el, kAXValueAttribute as String) ? "editable" : "read-only") }
        return s
    }

    static func interfaces(_ el: AXUIElement, actions: [String]) -> [String] {
        var i = actions
        if settable(el, kAXValueAttribute as String) { i.append("Value") }
        if attr(el, kAXSelectedChildrenAttribute as String) != nil { i.append("Selection") }
        if attr(el, kAXNumberOfCharactersAttribute as String) != nil { i.append("Text") }
        return i
    }

    static func probe(_ el: AXUIElement) -> Json? {
        guard attr(el, kAXRoleAttribute as String) != nil else { return nil }
        var o: Json = ["name": label(el), "states": states(el), "childCount": children(el).count]
        if isSecure(el) {
            if let n = secureLength(el) { o["valueLength"] = n }
        } else if let v = valueString(el) {
            o["value"] = v
        }
        if let sel = selectedOption(el) { o["selectedOption"] = sel }
        return o
    }

    static func selectedOption(_ el: AXUIElement) -> String? {
        let r = AX.role(el)
        if r == "AXPopUpButton" || r == "AXComboBox" { return valueString(el) }
        if let selected = attr(el, kAXSelectedChildrenAttribute as String) as? [AXUIElement], let first = selected.first {
            return label(first)
        }
        return nil
    }

    /// FNV-1a over roles and labels of the subtree (no values).
    static func contentHash(_ roots: [AXUIElement], budget: Int = 1500) -> String {
        var h: UInt32 = 2_166_136_261
        var stack = roots
        var left = budget
        while let el = stack.popLast(), left > 0 {
            left -= 1
            for b in "\(role(el))\u{1f}\(label(el))\u{1e}".utf8 {
                h ^= UInt32(b)
                h = h &* 16_777_619
            }
            stack.append(contentsOf: children(el))
        }
        return String(format: "%08x", h)
    }

    final class Walk {
        let maxNodes: Int
        let maxDepth: Int
        let deadline: Date
        var nodes: [Json] = []
        var elements: [AXUIElement] = []
        var complete = true
        var degraded: String?

        init(maxNodes: Int, maxDepth: Int, timeout: TimeInterval) {
            self.maxNodes = maxNodes
            self.maxDepth = maxDepth
            deadline = Date().addingTimeInterval(timeout)
        }

        func run(_ windows: [AXUIElement]) {
            for w in windows { visit(w, parent: nil, depth: 0, window: nil) }
        }

        private func visit(_ el: AXUIElement, parent: Int?, depth: Int, window: Int?) {
            if elements.count >= maxNodes {
                complete = false
                degraded = "node cap \(maxNodes) reached"
                return
            }
            if Date() > deadline {
                complete = false
                degraded = "observation timed out"
                return
            }
            let role = AX.role(el)
            let ref = elements.count
            let win = window ?? ref
            let actions = AX.actions(el)
            var node: Json = [
                "ref": ref,
                "parent": parent as Any? ?? NSNull(),
                "depth": depth,
                "role": role,
                "name": AX.label(el),
                "states": AX.states(el),
                "interfaces": AX.interfaces(el, actions: actions),
                "actions": actions,
                "bounds": AX.frame(el).map(AX.rectJson) as Any? ?? NSNull(),
                "window": win,
                "childCount": 0,
                "secret": AX.isSecure(el),
            ]
            if let sub = AX.subrole(el) { node["subrole"] = sub }
            if let id = AX.string(el, kAXIdentifierAttribute as String), !id.isEmpty { node["automationId"] = id }
            if let d = AX.string(el, kAXDescriptionAttribute as String), !d.isEmpty, d != node["name"] as? String {
                node["description"] = d
            }
            if AX.isSecure(el) {
                if let n = AX.secureLength(el) { node["valueLength"] = n }
            } else if let v = AX.valueString(el) {
                node["value"] = String(v.prefix(4000))
            }
            if role == "AXPopUpButton" || role == "AXComboBox" {
                if let sel = AX.selectedOption(el) { node["selectedOption"] = sel }
            }
            elements.append(el)
            let index = nodes.count
            nodes.append(node)
            guard depth < maxDepth else { return }
            let kids = AX.children(el)
            nodes[index]["childCount"] = kids.count
            for child in kids.prefix(2000) { visit(child, parent: ref, depth: depth + 1, window: win) }
        }
    }
}
