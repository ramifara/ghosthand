// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Anthropic Messages API with an API key (`ANTHROPIC_API_KEY`). Never an OAuth token: Claude
// subscription logins stay inside the user's own `claude` CLI (see the Claude consultant).
import { createAnthropic } from "@ai-sdk/anthropic";
import type { NativeComputerTool } from "../catalog/ghosthand-fields.ts";
import type {
  ComputerDisplay,
  ModelProvider,
  NativeComputerToolSet,
  SdkLanguageModel,
} from "./provider-registry.ts";

export interface AnthropicProviderOptions {
  readonly apiKey?: string | undefined;
  /** Defaults to `https://api.anthropic.com/v1`. */
  readonly baseURL?: string;
  readonly fetch?: typeof globalThis.fetch;
  /** Catalog provider id; defaults to `anthropic`. */
  readonly id?: string;
}

/** The computer tool is named `computer` in both the toolset and the older versioned tool. */
export const ANTHROPIC_COMPUTER_TOOL_NAME = "computer";

export function createAnthropicProvider(options: AnthropicProviderOptions = {}): ModelProvider {
  const apiKey = options.apiKey?.trim() ?? "";
  const configured = apiKey.length > 0;
  const sdk = createAnthropic({
    // A placeholder keeps an unconfigured provider from reading ANTHROPIC_API_KEY from the
    // environment; it is never called.
    apiKey: configured ? apiKey : "not-configured",
    ...(options.baseURL !== undefined ? { baseURL: options.baseURL } : {}),
    ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
  });
  const nativeComputerTool = (
    tool: NativeComputerTool,
    display: ComputerDisplay,
  ): NativeComputerToolSet | undefined => {
    if (tool === "anthropic_toolset_20260801") {
      return {
        tool,
        toolName: ANTHROPIC_COMPUTER_TOOL_NAME,
        // Zoom off: grounding wants one click target from the screenshot we already sent.
        tools: {
          [ANTHROPIC_COMPUTER_TOOL_NAME]: sdk.tools.computerToolset_20260801({
            configs: { zoom: { enabled: false } },
          }),
        },
      };
    }
    if (tool === "anthropic_computer_20251124") {
      return {
        tool,
        toolName: ANTHROPIC_COMPUTER_TOOL_NAME,
        tools: {
          [ANTHROPIC_COMPUTER_TOOL_NAME]: sdk.tools.computer_20251124({
            displayWidthPx: display.width,
            displayHeightPx: display.height,
          }),
        },
      };
    }
    return undefined;
  };
  return {
    id: options.id ?? "anthropic",
    kind: "anthropic",
    configured,
    languageModel: (modelId: string): SdkLanguageModel => sdk.languageModel(modelId),
    nativeComputerTool,
  };
}
