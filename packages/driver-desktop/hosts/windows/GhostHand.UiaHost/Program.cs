// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Entry point: `GhostHand.UiaHost.exe` speaks JSON-RPC on stdio until stdin closes or `close` arrives.
using System;
using System.Text.Json.Nodes;

namespace GhostHand.UiaHost;

internal static class Program
{
    // MTA: UI Automation clients with event handlers must not run on an STA thread.
    [MTAThread]
    private static int Main()
    {
        UiaHost host;
        try
        {
            host = new UiaHost();
        }
        catch (Exception e)
        {
            Rpc.Notify("fatal", new JsonObject { ["kind"] = "launch_failed", ["message"] = $"{e.GetType().Name}: {e.Message}" });
            return 1;
        }
        Rpc.Serve(host.Handlers());
        return 0;
    }
}
