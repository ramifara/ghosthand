// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import type {
  DecisionCapabilities,
  DecisionError,
  DecisionErrorKind,
  DecisionProvider,
  DecisionResponse,
  Result,
} from "@ghosthand/protocol";
import { err, ok } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { FallbackDecisionProvider, intersectCapabilities } from "./fallback-provider.ts";

const caps = (contextTokens: number, extra: Partial<DecisionCapabilities> = {}): DecisionCapabilities => ({
  maxOptions: 255,
  maxLevels: 10,
  contextTokens,
  zdr: true,
  ...extra,
});

function fake(id: string, outcome: DecisionErrorKind | "ok", c = caps(64_000)) {
  let calls = 0;
  const provider: DecisionProvider = {
    id,
    capabilities: c,
    ask: async (): Promise<Result<DecisionResponse, DecisionError>> => {
      calls += 1;
      if (outcome !== "ok") return err({ kind: outcome, provider: id, message: `${id} ${outcome}` });
      return ok({
        answers: { q: { type: "noul", p: 0.5 } },
        model: "jev",
        provider: id,
        usage: { inputTokens: 1, outputTokens: 1 },
        costUsd: 0,
        latencyMs: 1,
        calibration: "native",
      });
    },
  };
  return { provider, calls: () => calls };
}

const q = { q: { type: "noul" as const } };

describe("FallbackDecisionProvider", () => {
  it.each(["rate_limit", "overloaded", "server", "network", "timeout"] as const)(
    "fails over on %s",
    async (kind) => {
      const a = fake("typesafe", kind);
      const b = fake("openrouter", "ok");
      const r = await new FallbackDecisionProvider(a.provider, b.provider).ask("s", q);
      expect(r.ok && r.value.provider).toBe("openrouter");
      expect(b.calls()).toBe(1);
    },
  );

  it.each(["auth", "invalid", "too_large", "budget", "aborted", "unknown"] as const)(
    "does not fail over on %s",
    async (kind) => {
      const a = fake("typesafe", kind);
      const b = fake("openrouter", "ok");
      const r = await new FallbackDecisionProvider(a.provider, b.provider).ask("s", q);
      expect(r.ok ? undefined : r.error.kind).toBe(kind);
      expect(b.calls()).toBe(0);
    },
  );

  it("uses the primary when it answers and reports both failures otherwise", async () => {
    const a = fake("typesafe", "ok");
    const b = fake("openrouter", "ok");
    const fb = new FallbackDecisionProvider(a.provider, b.provider);
    expect((await fb.ask("s", q)).ok).toBe(true);
    expect(b.calls()).toBe(0);
    expect(fb.id).toBe("fallback(typesafe,openrouter)");

    const both = new FallbackDecisionProvider(fake("a", "server").provider, fake("b", "rate_limit").provider);
    const r = await both.ask("s", q);
    expect(r.ok ? undefined : r.error).toMatchObject({ kind: "rate_limit", provider: "b" });
    expect(r.ok ? "" : r.error.message).toContain("after a: server");
  });

  it("does not fail over once the caller aborted", async () => {
    const controller = new AbortController();
    const a: DecisionProvider = {
      ...fake("a", "ok").provider,
      ask: async () => {
        controller.abort();
        return err({ kind: "timeout", provider: "a", message: "t" });
      },
    };
    const b = fake("b", "ok");
    const r = await new FallbackDecisionProvider(a, b.provider).ask("s", q, { signal: controller.signal });
    expect(r.ok).toBe(false);
    expect(b.calls()).toBe(0);
  });

  it("advertises limits both providers accept", () => {
    expect(
      intersectCapabilities(
        caps(64_000, { perQuestionContextTokens: 32_000 }),
        caps(32_000, { zdr: false, maxOptions: 20 }),
      ),
    ).toEqual({
      maxOptions: 20,
      maxLevels: 10,
      contextTokens: 32_000,
      perQuestionContextTokens: 32_000,
      zdr: false,
    });
  });
});

describe("images and box capabilities", () => {
  const imageReq = {
    ref: "<image:screen>" as const,
    mimeType: "image/png" as const,
    width: 300,
    height: 300,
    data: new Uint8Array([1]),
  };

  it("intersects image and box flags (absent means false)", () => {
    expect(
      intersectCapabilities(caps(64_000, { images: true, box: true }), caps(64_000)).images,
    ).toBeUndefined();
    expect(
      intersectCapabilities(caps(64_000, { images: true, box: true }), caps(64_000, { images: true })).box,
    ).toBeUndefined();
    expect(
      intersectCapabilities(
        caps(64_000, { images: true, box: true }),
        caps(64_000, { images: true, box: true }),
      ),
    ).toMatchObject({ images: true, box: true });
  });

  it("does not fail an image request over to a provider without images", async () => {
    const a = fake("typesafe", "server", caps(64_000, { images: true, box: true }));
    const b = fake("openrouter", "ok");
    const r = await new FallbackDecisionProvider(a.provider, b.provider).ask("s <image:screen>", q, {
      images: [imageReq],
    });
    expect(r.ok ? undefined : r.error).toMatchObject({ kind: "server", provider: "typesafe" });
    expect(b.calls()).toBe(0);
  });

  it("fails an image request over when the secondary also takes images", async () => {
    const a = fake("typesafe", "server", caps(64_000, { images: true, box: true }));
    const b = fake("mirror", "ok", caps(64_000, { images: true, box: true }));
    const r = await new FallbackDecisionProvider(a.provider, b.provider).ask("s <image:screen>", q, {
      images: [imageReq],
    });
    expect(r.ok && r.value.provider).toBe("mirror");
  });
});
