// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Model references are `provider/model`. Only the first slash splits, so OpenRouter ids such as
// `openrouter/openai/gpt-6-luna` keep their own slash.

export interface ModelRef {
  readonly provider: string;
  readonly model: string;
}

export function parseModelRef(ref: string): ModelRef | undefined {
  const slash = ref.indexOf("/");
  if (slash <= 0 || slash === ref.length - 1) return undefined;
  return { provider: ref.slice(0, slash), model: ref.slice(slash + 1) };
}

export function formatModelRef(ref: ModelRef): string {
  return `${ref.provider}/${ref.model}`;
}
