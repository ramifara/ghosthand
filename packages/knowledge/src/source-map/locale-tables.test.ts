// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { i18nApp } from "./__fixtures__/i18n-app.ts";
import { buildSourceMap } from "./build-source-map.ts";
import { createTranslator, localeFromPath, tableFromJson } from "./locale-tables.ts";

describe("i18n strings", () => {
  const map = buildSourceMap(i18nApp, { root: "/virtual", generatedAt: "2026-10-01T00:00:00.000Z" });

  it("resolves t() keys to English text in element names", () => {
    expect(map.elements.find((e) => e.testid === "billing.export")).toMatchObject({
      role: "button",
      name: "Export PDF",
    });
    expect(map.elements.find((e) => e.role === "heading")?.text).toBe("Billing");
    expect(map.elements.find((e) => e.role === "link")?.ariaLabel).toBe("Home");
  });

  it("lists table entries with locale, file, line and usages", () => {
    const en = map.strings.find((s) => s.key === "billing.export" && s.locale === "en");
    expect(en).toMatchObject({
      text: "Export PDF",
      file: "locales/en.json",
      line: 3,
      usedAt: ["billing.tsx:7"],
    });
    const fr = map.strings.find((s) => s.key === "billing.export" && s.locale === "fr");
    expect(fr?.text).toBe("Exporter en PDF");
    expect(map.strings.find((s) => s.key === "nav.help")).toMatchObject({
      text: "Help",
      file: "i18n/messages.ts",
    });
  });

  it("keeps unresolved keys without text", () => {
    expect(map.strings.find((s) => s.key === "billing.missing")).toEqual({
      key: "billing.missing",
      usedAt: ["billing.tsx:9"],
    });
  });

  it("parses JSON tables and prefers English", () => {
    const fr = tableFromJson("locales/fr.json", `{"a":"Bonjour"}`);
    const en = tableFromJson("locales/en-US.json", `{"a":"Hello"}`);
    expect(tableFromJson("locales/x.json", "not json")).toBeUndefined();
    const t = createTranslator([fr, en].filter((x) => x !== undefined));
    expect(t("a")?.text).toBe("Hello");
    expect(localeFromPath("lang/de/common.json")).toBe("de");
  });
});
