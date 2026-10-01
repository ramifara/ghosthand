// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Stable interfaces between the loop and its drivers, decision providers and consultants (plan §3.2).
import type { ActionResult, FieldValue, PointerTarget } from "./action.ts";
import type { ConsultantError, ConsultantProbe, RateLimits } from "./consultant.ts";
import type { DecisionCapabilities, DecisionError, DecisionResponse, Questions } from "./decision.ts";
import type { ComputerError } from "./errors.ts";
import type { VerifyState } from "./events.ts";
import type { Rect } from "./geometry.ts";
import type { Entry } from "./json.ts";
import type { Result } from "./result.ts";
import type { Capture, Snapshot, SurfaceKind } from "./snapshot.ts";
import type { Predicate } from "./task.ts";

export interface ComputerCapabilities {
  surface: SurfaceKind;
  semanticActions: boolean;
  pointer: boolean;
  screenshots: boolean;
  recording: boolean;
}

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface ObserveScope {
  /** Restrict to a region (e.g. a dialog) by element token or region name. */
  region?: string;
  maxElements?: number;
}

export interface PredicateResult {
  predicate: Predicate;
  state: VerifyState;
  detail?: string;
}

export interface Computer {
  capabilities(): ComputerCapabilities;
  doctor(): Promise<DoctorCheck[]>;
  open(target: string): Promise<Result<void, ComputerError>>;
  observe(scope?: ObserveScope): Promise<Result<Snapshot, ComputerError>>;
  screenshot(region?: Rect): Promise<Result<{ capture: Capture; data: Uint8Array }, ComputerError>>;
  press(token: string): Promise<ActionResult>;
  setValue(token: string, value: FieldValue): Promise<ActionResult>;
  toggle(token: string, checked?: boolean): Promise<ActionResult>;
  selectOption(token: string, option: string): Promise<ActionResult>;
  focus(token: string): Promise<ActionResult>;
  scrollIntoView(token: string): Promise<ActionResult>;
  click(
    target: PointerTarget,
    opts?: { button?: "left" | "right" | "middle"; count?: number },
  ): Promise<ActionResult>;
  move(target: PointerTarget): Promise<ActionResult>;
  drag(from: PointerTarget, to: PointerTarget): Promise<ActionResult>;
  scroll(dx: number, dy: number, target?: PointerTarget): Promise<ActionResult>;
  typeText(text: FieldValue): Promise<ActionResult>;
  key(keys: string[]): Promise<ActionResult>;
  verify(predicates: Predicate[]): Promise<PredicateResult[]>;
  waitIdle(opts?: { capMs?: number }): Promise<{ waitedMs: number; reason: string }>;
  startRecording(dir: string): Promise<Result<void, ComputerError>>;
  stopRecording(): Promise<Result<{ files: string[] }, ComputerError>>;
  close(): Promise<void>;
}

export interface DecisionAskOptions {
  signal?: AbortSignal;
}

export interface DecisionProvider {
  readonly id: string;
  readonly capabilities: DecisionCapabilities;
  ask(
    state: Entry,
    questions: Questions,
    opts?: DecisionAskOptions,
  ): Promise<Result<DecisionResponse, DecisionError>>;
}

export interface ConsultantAskOptions<T> {
  prompt: string;
  images?: string[];
  /** JSON Schema for the structured answer. */
  schema: Record<string, unknown>;
  parse: (value: unknown) => T;
  effort?: "low" | "medium" | "high";
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ConsultantSession {
  ask<T>(opts: ConsultantAskOptions<T>): Promise<Result<T, ConsultantError>>;
  rateLimits(): Promise<Result<RateLimits, ConsultantError>>;
  interrupt(): Promise<void>;
  close(): Promise<void>;
}

export interface AgentConsultant {
  readonly id: string;
  probe(): Promise<ConsultantProbe>;
  open(opts: { system: string; model?: string }): Promise<Result<ConsultantSession, ConsultantError>>;
}
