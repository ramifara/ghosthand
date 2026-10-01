// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { elementsApp } from "./__fixtures__/elements-app.ts";
import { buildSourceMap } from "./build-source-map.ts";
import { SourceMap } from "./source-map-schema.ts";

const map = buildSourceMap(elementsApp, { root: "/virtual", generatedAt: "2026-10-01T00:00:00.000Z" });
const byTestid = (id: string) => map.elements.find((e) => e.testid === id);

describe("element extraction", () => {
  it("produces a schema-valid map", () => {
    expect(SourceMap.safeParse(map).success).toBe(true);
    expect(map.skipped).toEqual([]);
  });

  it("expands .map over const data, resolving template-literal testids and text per item", () => {
    const all = byTestid("inbox.tab.all");
    const starred = byTestid("inbox.tab.starred");
    expect(all).toMatchObject({ role: "tab", name: "All mail", file: "inbox.tsx", routes: ["/inbox"] });
    expect(starred?.name).toBe("Starred");
  });

  it("records dynamic template testids as patterns", () => {
    const msg = map.elements.find((e) => e.testidPattern === "inbox.message.*");
    expect(msg).toMatchObject({ role: "listitem", file: "inbox.tsx" });
    expect(msg?.testid).toBeUndefined();
  });

  it("reads aria-label, role inference and data-testid attributes", () => {
    expect(byTestid("inbox.list")).toMatchObject({ role: "list", ariaLabel: "Messages", name: "Messages" });
    expect(byTestid("inbox.archive")).toMatchObject({ role: "button", name: "Archive" });
    const help = map.elements.find((e) => e.tag === "a");
    expect(help).toMatchObject({ role: "link", name: "?" });
    expect(map.elements.find((e) => e.role === "heading")?.text).toBe("Inbox");
  });

  it("keeps the idle branch of a conditional label and all alternatives", () => {
    const reply = byTestid("inbox.reply");
    expect(reply?.text).toBe("Send reply");
    expect(reply?.texts).toEqual(["Sending…", "Send reply"]);
  });

  it("pre-tags risk from variants, handler names and labels", () => {
    expect(byTestid("inbox.delete-all")?.risk).toBe("destructive");
    expect(byTestid("inbox.reply")?.risk).toBe("external");
    expect(byTestid("inbox.archive")?.risk).toBe("none");
    expect(byTestid("inbox.reply")?.handlers).toContain("sendReply");
  });

  it("resolves htmlFor labels through spreads of local objects inside .map", () => {
    const email = byTestid("signup.email");
    expect(email).toMatchObject({
      tag: "input",
      role: "textbox",
      domId: "signup-email",
      fieldName: "email",
      label: "Email address",
      name: "Email address",
    });
    // The static `multiline` flag picks one branch per item.
    expect(map.elements.filter((e) => e.testid === "signup.email").map((e) => e.tag)).toEqual(["input"]);
    expect(byTestid("signup.bio")?.tag).toBe("textarea");
  });

  it("extracts forms with fields, labels, types, required and submit text", () => {
    const form = map.forms.find((f) => f.testid === "signup.form");
    expect(form).toMatchObject({ name: "Sign up", submitText: "Create account", routes: ["/signup"] });
    const fields = form?.fields ?? [];
    expect(fields.find((f) => f.fieldName === "email")).toMatchObject({
      label: "Email address",
      type: "email",
      required: true,
      testid: "signup.email",
    });
    expect(fields.find((f) => f.fieldName === "bio")).toMatchObject({ tag: "textarea", required: false });
    expect(fields.find((f) => f.fieldName === "terms")).toMatchObject({
      role: "checkbox",
      label: "Accept terms",
    });
    expect(fields.find((f) => f.fieldName === "plan")).toMatchObject({ role: "combobox" });
    expect(fields.find((f) => f.placeholder === "Find a team")).toMatchObject({
      role: "searchbox",
      type: "search",
    });
  });
});
