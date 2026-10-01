// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Model roles and what each one needs from a model (plan §2 "Models and decisions").
import { z } from "zod";

export const ModelRole = z.enum([
  "decision",
  "planner",
  "writer",
  "vision_reviewer",
  "vision_grounder",
  "judge",
  "speech",
]);
export type ModelRole = z.infer<typeof ModelRole>;

/** Roles this package calls through the AI SDK. */
export const CHAT_ROLES = ["planner", "writer", "vision_reviewer", "vision_grounder", "judge"] as const;
export type ChatRole = (typeof CHAT_ROLES)[number];

/** Roles declared for completeness but served elsewhere. */
export const EXTERNAL_ROLES: Readonly<Record<Exclude<ModelRole, ChatRole>, string>> = {
  decision: "DecisionProvider (@ghosthand/decision-typesafe)",
  speech: "voice package (Phase 4)",
};

export function isChatRole(role: ModelRole): role is ChatRole {
  return (CHAT_ROLES as readonly string[]).includes(role);
}

export interface RoleRequirement {
  /** The model must accept JSON-schema constrained output. */
  readonly structuredOutput: boolean;
  /** The model must accept image input. */
  readonly imageInput: boolean;
  /**
   * `native`: the model has a vendor computer-use tool. `any`: a native tool or a known grounding
   * convention for coordinates returned as JSON. `none`: not needed.
   */
  readonly computerUse: "native" | "any" | "none";
  /** Minimum context window in tokens. */
  readonly minContextTokens: number;
}

export const ROLE_REQUIREMENTS: Readonly<Record<ChatRole, RoleRequirement>> = {
  planner: { structuredOutput: true, imageInput: false, computerUse: "none", minContextTokens: 64_000 },
  writer: { structuredOutput: false, imageInput: false, computerUse: "none", minContextTokens: 16_000 },
  vision_reviewer: {
    structuredOutput: true,
    imageInput: true,
    computerUse: "none",
    minContextTokens: 32_000,
  },
  vision_grounder: {
    structuredOutput: false,
    imageInput: true,
    computerUse: "any",
    minContextTokens: 32_000,
  },
  judge: { structuredOutput: true, imageInput: true, computerUse: "none", minContextTokens: 64_000 },
};

/** Short badges for `ghosthand models list`. */
export const ROLE_BADGES: Readonly<Record<ChatRole, string>> = {
  planner: "P",
  writer: "W",
  vision_reviewer: "VR",
  vision_grounder: "VG",
  judge: "J",
};
