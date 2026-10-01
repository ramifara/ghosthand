// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Newline-delimited JSON-RPC 2.0 on stdin/stdout (contract: packages/protocol/src/desktop-rpc.ts).
// One request at a time: input is serialized by design. Logs go to stderr and never carry typed values.
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace GhostHand.UiaHost;

/// <summary>An expected failure, reported to the client as a JSON-RPC error with data.kind.</summary>
internal sealed class RpcException : Exception
{
    public RpcException(string kind, string message) : base(message) => Kind = kind;

    public string Kind { get; }
}

internal static class Rpc
{
    private static readonly JsonSerializerOptions Compact = new() { WriteIndented = false };
    private static TextWriter _out = Console.Out;

    public static void Log(string message) => Console.Error.WriteLine($"[ghosthand-uia] {message}");

    private static void Write(JsonObject msg)
    {
        _out.Write(msg.ToJsonString(Compact));
        _out.Write('\n');
        _out.Flush();
    }

    public static void Notify(string method, JsonObject? @params = null) =>
        Write(new JsonObject { ["jsonrpc"] = "2.0", ["method"] = method, ["params"] = @params ?? new JsonObject() });

    public static void Serve(Dictionary<string, Func<JsonObject, JsonNode?>> handlers)
    {
        var stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = false };
        _out = stdout;
        // Anything else that writes to Console.Out goes to stderr, keeping stdout for the protocol.
        Console.SetOut(Console.Error);
        var stdin = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
        Notify("ready");
        while (true)
        {
            var line = stdin.ReadLine();
            if (line is null) return;
            if (string.IsNullOrWhiteSpace(line)) continue;
            JsonObject? msg;
            try
            {
                msg = JsonNode.Parse(line) as JsonObject;
            }
            catch (JsonException)
            {
                msg = null;
            }
            if (msg is null)
            {
                Write(new JsonObject
                {
                    ["jsonrpc"] = "2.0",
                    ["id"] = null,
                    ["error"] = new JsonObject { ["code"] = -32700, ["message"] = "parse error" },
                });
                continue;
            }
            var id = msg["id"]?.DeepClone();
            var method = msg["method"]?.GetValue<string>() ?? "";
            var @params = msg["params"] as JsonObject ?? new JsonObject();
            if (!handlers.TryGetValue(method, out var handler))
            {
                if (id is not null) Write(Error(id, -32601, $"unknown method {method}", "unsupported"));
                continue;
            }
            try
            {
                var result = handler(@params) ?? new JsonObject();
                if (id is not null)
                    Write(new JsonObject { ["jsonrpc"] = "2.0", ["id"] = id, ["result"] = result });
            }
            catch (RpcException e)
            {
                if (id is not null) Write(Error(id, -32000, e.Message, e.Kind));
            }
            catch (Exception e)
            {
                Log($"handler error in {method}: {e.GetType().Name}: {Trim(e.Message)}");
                if (id is not null) Write(Error(id, -32603, $"{e.GetType().Name}: {Trim(e.Message)}", "driver"));
            }
            if (method == "close") return;
        }
    }

    private static string Trim(string s) => s.Length > 300 ? s[..300] : s;

    private static JsonObject Error(JsonNode id, int code, string message, string kind) => new()
    {
        ["jsonrpc"] = "2.0",
        ["id"] = id,
        ["error"] = new JsonObject { ["code"] = code, ["message"] = message, ["data"] = new JsonObject { ["kind"] = kind } },
    };
}
