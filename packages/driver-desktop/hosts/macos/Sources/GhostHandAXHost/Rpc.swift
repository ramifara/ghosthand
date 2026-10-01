// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Newline-delimited JSON-RPC 2.0 on stdin/stdout (contract: packages/protocol/src/desktop-rpc.ts).
// One request at a time; logs go to stderr and never carry typed values.
import Foundation

struct RpcError: Error {
    let kind: String
    let message: String
}

typealias Json = [String: Any]
typealias Handler = (Json) throws -> Any

enum Rpc {
    static func log(_ message: String) {
        FileHandle.standardError.write(Data("[ghosthand-ax] \(message)\n".utf8))
    }

    static func write(_ obj: Json) {
        guard let data = try? JSONSerialization.data(withJSONObject: obj, options: []) else { return }
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
    }

    static func notify(_ method: String, _ params: Json = [:]) {
        write(["jsonrpc": "2.0", "method": method, "params": params])
    }

    private static func error(_ id: Any, _ code: Int, _ message: String, _ kind: String) -> Json {
        ["jsonrpc": "2.0", "id": id, "error": ["code": code, "message": message, "data": ["kind": kind]] as Json]
    }

    static func serve(_ handlers: [String: Handler]) {
        notify("ready")
        while let line = readLine(strippingNewline: true) {
            if line.trimmingCharacters(in: .whitespaces).isEmpty { continue }
            guard let data = line.data(using: .utf8),
                  let msg = (try? JSONSerialization.jsonObject(with: data)) as? Json
            else {
                write(["jsonrpc": "2.0", "id": NSNull(), "error": ["code": -32700, "message": "parse error"] as Json])
                continue
            }
            let id = msg["id"]
            let method = msg["method"] as? String ?? ""
            let params = msg["params"] as? Json ?? [:]
            guard let handler = handlers[method] else {
                if let id { write(error(id, -32601, "unknown method \(method)", "unsupported")) }
                continue
            }
            do {
                let result = try handler(params)
                if let id { write(["jsonrpc": "2.0", "id": id, "result": result]) }
            } catch let e as RpcError {
                if let id { write(error(id, -32000, e.message, e.kind)) }
            } catch {
                log("handler error in \(method): \(error)")
                if let id { write(Self.error(id, -32603, "\(error)", "driver")) }
            }
            if method == "close" { return }
        }
    }
}
