// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { afterEach, describe, expect, it } from "vitest";
import { tid } from "./tid.ts";
import { type KeyValueStore, resolveVariant, setActiveVariant, VARIANT_STORAGE_KEY } from "./variant.ts";

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const server = { variant: { testids: "off", a11y: "good" } as const, resetId: 3 };

afterEach(() => setActiveVariant({ testids: "off", a11y: "good" }));

describe("tid", () => {
  it("adds data-testid only when testids is on", () => {
    expect(tid("login.submit")).toEqual({});
    setActiveVariant({ testids: "on", a11y: "good" });
    expect(tid("login.submit")).toEqual({ "data-testid": "login.submit" });
  });
});

describe("resolveVariant", () => {
  it("uses the server variant without overrides", () => {
    expect(resolveVariant(server, "", memoryStore())).toEqual({ testids: "off", a11y: "good" });
  });

  it("lets the query string override and remembers it until the next reset", () => {
    const store = memoryStore();
    expect(resolveVariant(server, "?testids=on", store).testids).toBe("on");
    expect(resolveVariant(server, "", store).testids).toBe("on");
    expect(resolveVariant({ ...server, resetId: 4 }, "", store).testids).toBe("off");
    expect(store.data.has(VARIANT_STORAGE_KEY)).toBe(false);
  });

  it("ignores invalid query values", () => {
    expect(resolveVariant(server, "?testids=maybe", memoryStore()).testids).toBe("off");
  });

  it("passes L6 flags through from the server and the query, and omits unset ones", () => {
    const l6 = { ...server, variant: { ...server.variant, popups: "on" as const } };
    expect(resolveVariant(l6, "?locale=ar&zoom=150&theme=sepia", memoryStore())).toEqual({
      testids: "off",
      a11y: "good",
      popups: "on",
      locale: "ar",
      zoom: "150",
    });
  });
});
