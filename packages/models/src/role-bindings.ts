// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Role → model bindings with fallback chains, and the check that a model can serve a role.
import type { Result } from "@ghosthand/protocol";
import { err, ok } from "@ghosthand/protocol";
import { z } from "zod";
import type { CatalogModel, ModelCatalog } from "./catalog/model-catalog.ts";
import { parseModelRef } from "./model-ref.ts";
import type { ChatRole, ModelRole, RoleRequirement } from "./roles.ts";
import { CHAT_ROLES, EXTERNAL_ROLES, isChatRole, ROLE_REQUIREMENTS } from "./roles.ts";

export const ReasoningEffort = z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);
export type ReasoningEffort = z.infer<typeof ReasoningEffort>;

export const RoleBinding = z.object({
  /** Primary model first, then fallbacks, as `provider/model`. */
  models: z.array(z.string().refine((r) => parseModelRef(r) !== undefined, "expected provider/model")).min(1),
  /** Per-attempt timeout. */
  timeoutMs: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  reasoningEffort: ReasoningEffort.optional(),
  temperature: z.number().min(0).max(2).optional(),
  /** SDK-level retries per model before moving down the chain. */
  maxRetries: z.number().int().min(0).max(3).optional(),
});
export type RoleBinding = z.infer<typeof RoleBinding>;

export const RoleBindings = z.partialRecord(z.enum(CHAT_ROLES), RoleBinding);
export type RoleBindings = z.infer<typeof RoleBindings>;

/**
 * Starting point for an OpenAI key until P1-12 picks defaults by measurement. The grounder uses
 * models with OpenAI's native computer tool; the rest favour the cheap, fast GPT-6 tier.
 */
export const DEFAULT_ROLE_BINDINGS: RoleBindings = {
  planner: { models: ["openai/gpt-6.1-sol", "openai/gpt-6-sol"], reasoningEffort: "low" },
  writer: { models: ["openai/gpt-6-luna", "openai/gpt-6-sol"] },
  vision_reviewer: { models: ["openai/gpt-6-luna", "openai/gpt-6.1-sol"] },
  vision_grounder: { models: ["openai/gpt-6.1-sol", "openai/gpt-6-astra"] },
  judge: { models: ["openai/gpt-6.1-sol", "openai/gpt-6-sol"] },
};

export type RequirementGap = "text_output" | "structured_output" | "image_input" | "computer_use" | "context";

export type BindingError =
  | { readonly kind: "invalid"; readonly message: string; readonly path?: string }
  | { readonly kind: "external_role"; readonly role: ModelRole; readonly message: string }
  | { readonly kind: "unbound"; readonly role: ModelRole; readonly message: string }
  | {
      readonly kind: "unknown_model";
      readonly role: ModelRole;
      readonly ref: string;
      readonly message: string;
    }
  | {
      readonly kind: "unmet_requirements";
      readonly role: ModelRole;
      readonly ref: string;
      readonly gaps: readonly RequirementGap[];
      readonly message: string;
    };

export interface RequirementOptions {
  /** The call carries images, so image input is needed whatever the role says. */
  readonly needsImages?: boolean;
}

/** Which of the role's requirements the model misses. Empty means it qualifies. */
export function requirementGaps(
  model: CatalogModel,
  requirement: RoleRequirement,
  options: RequirementOptions = {},
): RequirementGap[] {
  const gaps: RequirementGap[] = [];
  if (!model.outputModalities.includes("text")) gaps.push("text_output");
  if (requirement.structuredOutput && !model.structuredOutput) gaps.push("structured_output");
  if ((requirement.imageInput || options.needsImages === true) && !model.inputModalities.includes("image")) {
    gaps.push("image_input");
  }
  if (requirement.computerUse === "native" && model.computerUse === undefined) gaps.push("computer_use");
  if (requirement.computerUse === "any" && model.computerUse === undefined && model.grounding === "none") {
    gaps.push("computer_use");
  }
  if (model.contextTokens < requirement.minContextTokens) gaps.push("context");
  return gaps;
}

/** Roles whose requirements the model meets (for `models list` badges). */
export function compatibleRoles(model: CatalogModel): ChatRole[] {
  return CHAT_ROLES.filter((role) => requirementGaps(model, ROLE_REQUIREMENTS[role]).length === 0);
}

export function validateModelForRole(
  catalog: ModelCatalog,
  role: ModelRole,
  ref: string,
  options: RequirementOptions = {},
): Result<CatalogModel, BindingError> {
  if (!isChatRole(role)) {
    const where = EXTERNAL_ROLES[role];
    return err({
      kind: "external_role",
      role,
      message: `role "${role}" is served by ${where}, not by models`,
    });
  }
  const model = catalog.get(ref);
  if (model === undefined) {
    return err({ kind: "unknown_model", role, ref, message: `${ref} is not in the model catalog` });
  }
  const gaps = requirementGaps(model, ROLE_REQUIREMENTS[role], options);
  if (gaps.length > 0) {
    return err({
      kind: "unmet_requirements",
      role,
      ref,
      gaps,
      message: `${ref} cannot serve ${role}: missing ${gaps.join(", ")}`,
    });
  }
  return ok(model);
}

export function parseRoleBindings(input: unknown): Result<RoleBindings, BindingError> {
  const parsed = RoleBindings.safeParse(input);
  if (parsed.success) return ok(parsed.data);
  const path = parsed.error.issues[0]?.path.map(String).join(".");
  return err({ kind: "invalid", message: parsed.error.message, ...(path ? { path } : {}) });
}

/** Checks every model in every chain. For startup and settings screens; calls skip bad entries. */
export function validateBindings(
  catalog: ModelCatalog,
  bindings: RoleBindings,
): Result<void, readonly BindingError[]> {
  const errors: BindingError[] = [];
  for (const role of CHAT_ROLES) {
    for (const ref of bindings[role]?.models ?? []) {
      const checked = validateModelForRole(catalog, role, ref);
      if (!checked.ok) errors.push(checked.error);
    }
  }
  return errors.length === 0 ? ok(undefined) : err(errors);
}

export interface ResolvedChain {
  readonly role: ChatRole;
  readonly binding: RoleBinding;
  /** Models that satisfy the role, in fallback order. */
  readonly models: readonly CatalogModel[];
  /** Bound models left out, with the reason. */
  readonly skipped: readonly BindingError[];
}

/** The usable part of a role's chain. Fails when nothing in the chain qualifies. */
export function resolveRoleChain(
  catalog: ModelCatalog,
  bindings: RoleBindings,
  role: ModelRole,
  options: RequirementOptions = {},
): Result<ResolvedChain, BindingError> {
  if (!isChatRole(role)) {
    return err({
      kind: "external_role",
      role,
      message: `role "${role}" is served by ${EXTERNAL_ROLES[role]}`,
    });
  }
  const binding = bindings[role];
  if (binding === undefined) return err({ kind: "unbound", role, message: `no model is bound to ${role}` });
  const models: CatalogModel[] = [];
  const skipped: BindingError[] = [];
  for (const ref of binding.models) {
    const checked = validateModelForRole(catalog, role, ref, options);
    if (checked.ok) models.push(checked.value);
    else skipped.push(checked.error);
  }
  if (models.length === 0) {
    const reasons = skipped.map((s) => s.message).join("; ");
    return err({ kind: "unbound", role, message: `no bound model can serve ${role}: ${reasons}` });
  }
  return ok({ role, binding, models, skipped });
}
