// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Browser tests on local fixture pages. They launch headless Chrome (or Playwright's Chromium) and are
// skipped when neither exists, and in CI unless GHOSTHAND_BROWSER_TESTS=1.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildState, estimateTokens, SecretsRegistry } from "@ghosthand/core";
import type {
  ActionResult,
  Element as ProtocolElement,
  Snapshot as ProtocolSnapshot,
} from "@ghosthand/protocol";
import { ActionResult as ActionResultSchema, Element, Snapshot } from "@ghosthand/protocol";
import type { Browser, BrowserContext } from "playwright-core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { registerGhosthandEngine } from "./engine-client.ts";
import { readZipEntries, redactZip } from "./redact-zip.ts";
import type { BrowserLaunch, FixtureServer } from "./test-support.ts";
import {
  CATALOG_CATEGORIES,
  CATALOG_PER_CATEGORY,
  CATALOG_STORES,
  findTestBrowser,
  launchTestBrowser,
  percentile,
  startFixtureServer,
} from "./test-support.ts";
import { generateTotp } from "./totp.ts";
import type { WebComputer, WebComputerOptions } from "./web-computer.ts";
import { createWebComputer } from "./web-computer.ts";

const PASSWORD = "Sup3r-Secret-Pw!";
const TOTP_SECRET = "JBSWY3DPEHPK3PXP";
const how: BrowserLaunch | undefined = await findTestBrowser();
const skip =
  how === undefined || (process.env.CI !== undefined && process.env.GHOSTHAND_BROWSER_TESTS !== "1");

const timings = { observe: [] as number[], action: [] as number[] };

describe.skipIf(skip)("WebComputer on fixture pages", () => {
  let browser: Browser;
  let server: FixtureServer;
  let context: BrowserContext | undefined;
  let computer: WebComputer | undefined;

  beforeAll(async () => {
    await registerGhosthandEngine();
    if (!how) throw new Error("no browser");
    browser = await launchTestBrowser(how);
    server = await startFixtureServer();
  });

  afterEach(async () => {
    await computer?.close();
    await context?.close();
    computer = undefined;
    context = undefined;
  });

  afterAll(async () => {
    await browser?.close();
    await server?.close();
    if (timings.observe.length > 0)
      console.log(
        `observe p50 ${percentile(timings.observe, 50)} ms (n=${timings.observe.length}), action p50 ${percentile(timings.action, 50)} ms (n=${timings.action.length}), action p95 ${percentile(timings.action, 95)} ms`,
      );
  });

  async function open(path: string, opts: Partial<WebComputerOptions> = {}): Promise<WebComputer> {
    context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const secrets = new SecretsRegistry([
      ["PASSWORD", PASSWORD],
      ["TOTP", TOTP_SECRET],
    ]);
    const created = await createWebComputer({ context, secrets, allowOrigins: [server.origin], ...opts });
    if (!created.ok) throw new Error(created.error.message);
    computer = created.value;
    const opened = await computer.open(`${server.origin}/${path}`);
    if (!opened.ok) throw new Error(opened.error.message);
    return computer;
  }

  async function observe(c: WebComputer): Promise<ProtocolSnapshot> {
    const t = Date.now();
    const s = await c.observe();
    timings.observe.push(Date.now() - t);
    if (!s.ok) throw new Error(s.error.message);
    return s.value;
  }

  function find(s: ProtocolSnapshot, name: string, role?: string): ProtocolElement {
    const el = s.elements.find((e) => e.name === name && (role === undefined || e.role === role));
    if (!el)
      throw new Error(`no element ${role ?? ""} "${name}" in ${s.elements.map((e) => e.name).join(", ")}`);
    return el;
  }

  async function act(run: Promise<ActionResult>): Promise<ActionResult> {
    const t = Date.now();
    const r = await run;
    timings.action.push(Date.now() - t);
    ActionResultSchema.parse(r);
    return r;
  }

  function expectConfirmed(r: ActionResult): void {
    expect(r.error, JSON.stringify(r)).toBeUndefined();
    expect(r.effect, JSON.stringify(r)).toBe("confirmed");
    expect(r.evidence.length).toBeGreaterThan(0);
    expect(r.evidence.some((e) => e.kind === "none")).toBe(false);
  }

  // ---- observation -------------------------------------------------------------------------------

  it("builds a schema-valid element table for the login page", async () => {
    const c = await open("login.html");
    const s = await observe(c);
    expect(() => Snapshot.parse(s)).not.toThrow();
    for (const el of s.elements) expect(() => Element.parse(el)).not.toThrow();
    const email = find(s, "Email", "textbox");
    expect(email.automationId).toBe("login-email");
    expect(email.region).toBe("form");
    expect(email.value).toBe("<empty>");
    expect(email.states).toContain("required");
    expect(find(s, "Sign in", "button").risk).toBe("submits");
    expect(find(s, "Contact support").risk).toBe("external");
    expect(find(s, "Help").region).toBe("nav");
    expect(find(s, "Privacy").region).toBe("footer");
    expect(s.elements.some((e) => e.name === "Hidden helper" || e.name === "Invisible button")).toBe(false);
    expect(s.quality.score).toBe(1);
    expect(s.narrowed).toBe(false);
    expect(s.tokenEstimate).toBeGreaterThan(0);
  });

  it("never exposes a password, typed directly or through a secret ref", async () => {
    const c = await open("login.html");
    // Typed straight into the page (like a user would) and revealed as page text by the fixture.
    await c.page.fill("input[name=password]", PASSWORD);
    await c.page.check("#reveal");
    await c.page.fill("input[name=account]", `team-${PASSWORD}`);
    let s = await observe(c);
    const json = JSON.stringify(s);
    expect(json).not.toContain(PASSWORD);
    expect(find(s, "Password", "textbox").value).toBe("[input:PASSWORD]");
    expect(find(s, "Account name", "textbox").value).toBe("team-[input:PASSWORD]");
    expect(s.text).toContain("Your password: [input:PASSWORD]");

    // An unregistered value in a password field shows as <filled>, never as text.
    await c.page.fill("input[name=password]", "another-unregistered-pw");
    s = await observe(c);
    expect(find(s, "Password", "textbox").value).toBe("<filled>");
    expect(JSON.stringify(s)).not.toContain("another-unregistered-pw");

    const r = await act(c.setValue(find(s, "Password", "textbox").token, { secretRef: "PASSWORD" }));
    expectConfirmed(r);
    expect(JSON.stringify(r)).not.toContain(PASSWORD);
    expect(r.evidence[0]?.after).toBe("[input:PASSWORD]");
    s = await observe(c);
    expect(JSON.stringify(s)).not.toContain(PASSWORD);
  });

  it("disambiguates duplicate row buttons by row context", async () => {
    const c = await open("table.html");
    const s = await observe(c);
    const edits = s.elements.filter((e) => e.name === "Edit");
    expect(edits).toHaveLength(3);
    expect(edits.map((e) => e.context?.split(" · ")[0])).toEqual(["Alice Martin", "Bob Stone", "Carol Diaz"]);
    expect(new Set(edits.map((e) => e.stableId)).size).toBe(3);
    expect(s.elements.filter((e) => e.name === "Delete").every((e) => e.risk === "destructive")).toBe(true);
    // Stable ids survive a re-render (the table is rebuilt on reload).
    await c.page.reload();
    const again = await observe(c);
    expect(again.elements.filter((e) => e.name === "Edit").map((e) => e.stableId)).toEqual(
      edits.map((e) => e.stableId),
    );
  });

  it("puts dialog elements in region dialog and hides what the modal makes inert", async () => {
    const c = await open("table.html");
    let s = await observe(c);
    const bobEdit = s.elements.filter((e) => e.name === "Edit")[1];
    if (!bobEdit) throw new Error("no edit button");
    expectConfirmed(await act(c.press(bobEdit.token)));
    s = await observe(c);
    const save = find(s, "Save", "button");
    expect(save.region).toBe("dialog");
    expect(find(s, "Name", "textbox").value).toBe("Bob Stone");
    expect(find(s, "Name", "textbox").region).toBe("dialog");
    expect(s.elements.some((e) => e.name === "Delete")).toBe(false);
    expect(s.elements.filter((e) => e.roleClass !== "heading").every((e) => e.region === "dialog")).toBe(
      true,
    );
  });

  it("includes iframe and shadow DOM elements with their frame path", async () => {
    const c = await open("iframe.html");
    const s = await observe(c);
    const holder = find(s, "Card holder", "textbox");
    expect(holder.frame).toBe("main > Payment form");
    expect(holder.context).toBe("Card details");
    expect(holder.bounds?.x).toBeGreaterThan(30);
    expect(find(s, "Apply coupon", "button").frame).toBe("main");
    expect(find(s, "Back to cart").frame).toBe("main");
    expectConfirmed(await act(c.setValue(holder.token, "Ada Lovelace")));
    const s2 = await observe(c);
    expectConfirmed(await act(c.press(find(s2, "Pay now").token)));
    const s3 = await observe(c);
    expect(s3.text).toContain("Payment sent");
    expectConfirmed(await act(c.press(find(s3, "Apply coupon").token)));
  });

  it("reports select options, checkbox state and offscreen elements", async () => {
    const c = await open("controls.html");
    const s = await observe(c);
    const theme = find(s, "Theme", "combobox");
    expect(theme.options).toEqual(["System", "Light", "Dark"]);
    expect(theme.optionCount).toBe(3);
    expect(theme.value).toBe("System");
    expect(theme.actions).toContain("select_option");
    expect(find(s, "Subscribe to newsletter").states).toContain("unchecked");
    expect(find(s, "Far away button").states).toContain("offscreen");
    expect(find(s, "Clickable card without role").actions).toContain("press");
  });

  it("caps the table and flags oversized snapshots", async () => {
    const c = await open("controls.html", { maxElements: 5 });
    const s = await observe(c);
    expect(s.elements.length).toBeLessThanOrEqual(5);
    await c.close();
    await context?.close();
    const small = await open("controls.html", { maxTokens: 120 });
    const t = await observe(small);
    expect(t.narrowed).toBe(true);
    expect(small.lastObserveStats?.oversized).toBe(true);
  });

  it("lists regions of an oversized page and narrows the act state under 20k tokens (P1-06)", async () => {
    const c = await open("catalog.html");
    const full = await observe(c);
    expect(full.scope).toBeUndefined();
    const ids = (full.regions ?? []).map((r) => r.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "nav-main",
        "form-pickup-store",
        ...CATALOG_CATEGORIES.map((cat) => `section-${cat.toLowerCase()}`),
      ]),
    );
    const lighting = full.regions?.find((r) => r.id === "section-lighting");
    expect(lighting).toMatchObject({
      kind: "section",
      label: "Lighting",
      elementCount: 2 * CATALOG_PER_CATEGORY + 1,
    });
    // The whole page is far over the guard, and the capped table cannot show every product.
    expect(full.pageTokenEstimate ?? 0).toBeGreaterThan(20_000);
    expect(full.elements.length).toBeLessThanOrEqual(200);
    const fullState = buildState({
      instruction: "Add the Walnut Desk Lamp to the cart",
      goal: "Add the Walnut Desk Lamp to the cart",
      step: 1,
      phase: "act",
      snapshot: full,
      history: [],
      inputs: [],
    });

    const scoped = await c.observe({ region: "section-lighting" });
    if (!scoped.ok) throw new Error(scoped.error.message);
    const s = scoped.value;
    expect(s).toMatchObject({ scope: "section-lighting", narrowed: true });
    expect(s.elements.filter((e) => e.name === "Add to cart")).toHaveLength(CATALOG_PER_CATEGORY);
    expect(s.elements.some((e) => e.context?.startsWith("Walnut Desk Lamp"))).toBe(true);
    expect(s.text).toContain("Walnut Desk Lamp");
    expect(s.text).not.toContain("Kitchen item");
    const state = buildState({
      instruction: "Add the Walnut Desk Lamp to the cart",
      goal: "Add the Walnut Desk Lamp to the cart",
      step: 1,
      phase: "act",
      snapshot: s,
      history: [],
      inputs: [],
    });
    expect(estimateTokens(state)).toBeLessThan(20_000);
    console.log(
      `catalog: page ${full.pageTokenEstimate} tokens (${full.regions?.reduce((n, r) => n + r.elementCount, 0)} elements), capped act state ${estimateTokens(fullState)} tokens, narrowed act state ${estimateTokens(state)} tokens (${s.elements.length} elements)`,
    );
    // Tokens of the scoped snapshot act; the product is pressed in its own card.
    const lamp = s.elements.find((e) => e.context?.startsWith("Walnut Desk Lamp"));
    if (!lamp) throw new Error("no lamp");
    expect((await act(c.press(lamp.token))).error).toBeUndefined();

    const form = await c.observe({ region: "form-pickup-store" });
    if (!form.ok) throw new Error(form.error.message);
    const select = find(form.value, "Pickup store", "combobox");
    expect(select.options).toHaveLength(CATALOG_STORES);
    expect(select.optionCount).toBe(CATALOG_STORES);
    expect(select.options?.at(-1)).toBe("Store 300");
    expectConfirmed(await act(c.selectOption(select.token, "Store 271")));
  }, 60_000);

  // ---- actions -----------------------------------------------------------------------------------

  it("confirms semantic actions with evidence", async () => {
    const c = await open("controls.html");
    let s = await observe(c);
    expectConfirmed(await act(c.toggle(find(s, "Subscribe to newsletter").token)));
    s = await observe(c);
    expect(find(s, "Subscribe to newsletter").states).toContain("checked");
    expectConfirmed(await act(c.toggle(find(s, "Compact mode").token, true)));
    s = await observe(c);
    expectConfirmed(await act(c.selectOption(find(s, "Theme").token, "dark")));
    s = await observe(c);
    expect(find(s, "Theme").value).toBe("Dark");
    expectConfirmed(await act(c.setValue(find(s, "Notes").token, "Remember the milk")));
    s = await observe(c);
    expect(find(s, "Notes").value).toBe("Remember the milk");
    expectConfirmed(await act(c.focus(find(s, "Notes").token)));
    expectConfirmed(await act(c.scrollIntoView(find(s, "Far away button").token)));
    s = await observe(c);
    expect(find(s, "Far away button").states).not.toContain("offscreen");
  });

  it("confirms pointer actions on tokens and coordinates", async () => {
    const c = await open("controls.html");
    let s = await observe(c);
    expectConfirmed(await act(c.press(find(s, "Clicked 0 times").token)));
    s = await observe(c);
    expectConfirmed(await act(c.click({ token: find(s, "Clicked 1 times").token })));

    // Capture coordinates (image pixels) and screen coordinates.
    s = await observe(c);
    const shot = await c.screenshot();
    if (!shot.ok) throw new Error(shot.error.message);
    expect(shot.value.data.byteLength).toBeGreaterThan(1000);
    const counter = find(s, "Clicked 2 times");
    const b = counter.visibleBounds;
    if (!b) throw new Error("no bounds");
    const scale = shot.value.capture.scale;
    expectConfirmed(
      await act(
        c.click({
          captureId: shot.value.capture.id,
          x: (b.x + b.width / 2) * scale,
          y: (b.y + b.height / 2) * scale,
        }),
      ),
    );
    expectConfirmed(await act(c.click({ screenX: b.x + b.width / 2, screenY: b.y + b.height / 2 })));
    s = await observe(c);
    expect(find(s, "Clicked 4 times").name).toBe("Clicked 4 times");

    expectConfirmed(await act(c.move({ token: find(s, "Hover me").token })));
    const hover = find(s, "Hover me").visibleBounds;
    if (!hover) throw new Error("no bounds");
    expectConfirmed(await act(c.move({ screenX: hover.x + 5, screenY: hover.y + 5 })));

    s = await observe(c);
    expectConfirmed(await act(c.press(find(s, "Clickable card without role").token)));

    s = await observe(c);
    const drag = await act(
      c.drag({ token: find(s, "Drag card").token }, { token: find(s, "Drop here").token }),
    );
    expectConfirmed(drag);
    s = await observe(c);
    expect(s.elements.some((e) => e.name === "Dropped Card A")).toBe(true);

    expectConfirmed(await act(c.scroll(0, 600)));
  });

  it("confirms keyboard actions", async () => {
    const c = await open("login.html");
    let s = await observe(c);
    expectConfirmed(await act(c.focus(find(s, "Email").token)));
    expectConfirmed(await act(c.typeText("ada@example.com")));
    s = await observe(c);
    expect(find(s, "Email").value).toBe("ada@example.com");
    expectConfirmed(await act(c.key(["Tab"])));
    const typed = await act(c.typeText({ secretRef: "PASSWORD" }));
    expectConfirmed(typed);
    expect(JSON.stringify(typed)).not.toContain(PASSWORD);
    expect(await c.page.inputValue("input[name=password]")).toBe(PASSWORD);
    const r = await act(c.key(["Control", "a"]));
    expect(r.effect).not.toBe("refused");
    const controls = await open("controls.html");
    expectConfirmed(await act(controls.key(["F2"])));
  });

  it("submits a form, navigates and goes back", async () => {
    const c = await open("login.html");
    let s = await observe(c);
    expectConfirmed(await act(c.setValue(find(s, "Email").token, "ada@example.com")));
    s = await observe(c);
    expectConfirmed(await act(c.fillCredential(find(s, "Password").token, "PASSWORD")));
    s = await observe(c);
    const submit = await act(c.press(find(s, "Sign in", "button").token));
    expectConfirmed(submit);
    expect(submit.evidence.find((e) => e.kind === "url")?.after).toContain("/dashboard");
    expect(submit.invalidatedSnapshots).toEqual([s.id]);
    expectConfirmed(await act(c.navigate(`${server.origin}/table.html`)));
    expectConfirmed(await act(c.back()));
    expect(c.page.url()).toContain("/dashboard");
  });

  it("fills a TOTP code from a registered secret", async () => {
    const c = await open("login.html");
    const s = await observe(c);
    const r = await act(c.fillTotp(find(s, "One-time code").token, "TOTP"));
    expectConfirmed(r);
    const code = await c.page.inputValue("input[name=otp]");
    expect(code).toMatch(/^\d{6}$/);
    const expected = generateTotp(TOTP_SECRET);
    expect(expected.ok && [code].includes(expected.value)).toBe(true);
    expect(JSON.stringify(r)).not.toContain(code);
    const after = await observe(c);
    expect(find(after, "One-time code").value).toBe("[input:TOTP.totp]");
    expect(JSON.stringify(after)).not.toContain(code);
    const missing = await act(c.fillTotp(find(after, "One-time code").token, "NOPE"));
    expect(missing.effect).toBe("refused");
  });

  // ---- guards ------------------------------------------------------------------------------------

  it("refuses stale tokens and never re-resolves them", async () => {
    const c = await open("controls.html");
    const first = await observe(c);
    const token = find(first, "Clicked 0 times").token;
    await observe(c);
    const stale = await act(c.press(token));
    expect(stale.effect).toBe("refused");
    expect(stale.error?.kind).toBe("stale_token");
    expect(await c.page.textContent("#counter")).toBe("Clicked 0 times");

    const s = await observe(c);
    expectConfirmed(await act(c.press(find(s, "Clicked 0 times").token)));
    const again = await act(c.toggle(find(s, "Subscribe to newsletter").token));
    expect(again.effect).toBe("refused");
    expect(again.error?.kind).toBe("stale_token");

    const unknown = await act(c.press("e9999s99"));
    expect(unknown.error?.kind).toBe("stale_token");
    const notInSnapshot = await act(c.press(`e9999${(await observe(c)).id}`));
    expect(notInSnapshot.error?.kind).toBe("stale_token");
  });

  it("refuses a pointer action on a covered element", async () => {
    const c = await open("controls.html");
    const s = await observe(c);
    const r = await act(c.press(find(s, "Covered button").token));
    expect(r.effect).toBe("refused");
    expect(r.error?.kind).toBe("hit_test_failed");
    expect(await c.page.evaluate(() => document.body.dataset.covered)).toBeUndefined();
  });

  it("blocks navigation off the allowlist and to the testbed control API", async () => {
    const c = await open("controls.html", { allowOrigins: [server.origin, "http://127.0.0.1:4401"] });
    let s = await observe(c);
    const away = await act(c.press(find(s, "Other site").token));
    expect(away.effect).toBe("refused");
    expect(away.error?.kind).toBe("origin_blocked");
    expect(c.page.url().startsWith(server.origin)).toBe(true);

    s = await observe(c);
    const redirected = await act(c.press(find(s, "Redirecting link").token));
    expect(redirected.effect).toBe("refused");
    expect(redirected.error?.kind).toBe("origin_blocked");
    expect(c.page.url().startsWith(server.origin)).toBe(true);

    const direct = await act(c.navigate(`${server.otherOrigin}/elsewhere`));
    expect(direct.error?.kind).toBe("origin_blocked");
    const control = await act(c.navigate("http://127.0.0.1:4401/reset"));
    expect(control.error?.kind).toBe("origin_blocked");
    s = await observe(c);
    const controlLink = await act(c.press(find(s, "Control API").token));
    expect(controlLink.error?.kind).toBe("origin_blocked");
    const fetched = await c.page.evaluate(() =>
      fetch("http://localhost:4401/oracle/x").then(
        () => "reached",
        () => "blocked",
      ),
    );
    expect(fetched).toBe("blocked");

    // A popup on an allowed origin is followed.
    s = await observe(c);
    const popup = await act(c.press(find(s, "Open users in a new tab").token));
    expectConfirmed(popup);
    expect(c.page.url()).toContain("/table.html");
  });

  it("refuses credentials without an allowlist", async () => {
    context = await browser.newContext();
    const created = await createWebComputer({
      context,
      secrets: new SecretsRegistry([["PASSWORD", PASSWORD]]),
    });
    if (!created.ok) throw new Error(created.error.message);
    computer = created.value;
    await computer.page.goto(`${server.origin}/login.html`);
    const s = await observe(computer);
    const r = await act(computer.fillCredential(find(s, "Password").token, "PASSWORD"));
    expect(r.effect).toBe("refused");
    expect(r.error?.kind).toBe("origin_blocked");
  });

  // ---- settle, verify, recording -----------------------------------------------------------------

  it("waits for a slow page to settle", async () => {
    context = await browser.newContext();
    const created = await createWebComputer({ context, allowOrigins: [server.origin] });
    if (!created.ok) throw new Error(created.error.message);
    computer = created.value;
    await computer.page.goto(`${server.origin}/slow.html`, { waitUntil: "commit" });
    const settled = await computer.waitIdle();
    expect(settled.reason).toBe("idle");
    expect(settled.waitedMs).toBeGreaterThanOrEqual(1000);
    expect(settled.waitedMs).toBeLessThan(5000);
    const s = await observe(computer);
    expect(s.text).toContain("Data loaded");
    expect(s.elements.some((e) => e.name === "Continue")).toBe(true);
    const capped = await computer.waitIdle({ capMs: 0 });
    expect(capped.reason).toBe("idle");
  });

  it("verifies deterministic predicates against the live page", async () => {
    const c = await open("table.html");
    const s = await observe(c);
    const results = await c.verify([
      { kind: "url", matches: "/table.html" },
      { kind: "visible", name: "Users", role: "heading" },
      { kind: "text", text: "bob@example.com" },
      { kind: "visible", name: "Nonexistent" },
      { kind: "oracle", taskId: "l1-login" },
    ]);
    expect(results.map((r) => r.state)).toEqual([
      "satisfied",
      "satisfied",
      "satisfied",
      "unsatisfied",
      "unknown",
    ]);
    // verify() does not replace the latest snapshot.
    expectConfirmed(await act(c.press(find(s, "Delete").token)));
  });

  it("records a redacted Playwright trace", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ghosthand-trace-"));
    try {
      const c = await open("login.html");
      expect((await c.startRecording(dir)).ok).toBe(true);
      const s = await observe(c);
      expectConfirmed(await act(c.setValue(find(s, "Password").token, { secretRef: "PASSWORD" })));
      const stopped = await c.stopRecording();
      if (!stopped.ok) throw new Error(stopped.error.message);
      const trace = join(dir, "trace.zip");
      expect(stopped.value.files).toEqual([trace]);
      expect(existsSync(trace)).toBe(true);
      // The fill was recorded, with the placeholder instead of the value; a second pass finds nothing.
      const entries = readZipEntries(readFileSync(trace));
      if (!entries.ok) throw new Error(entries.error);
      const all = Buffer.concat(entries.value.map((e) => e.data)).toString("latin1");
      expect(all).toContain("[input:PASSWORD]");
      expect(all).not.toContain(PASSWORD);
      const again = redactZip(trace, [["PASSWORD", PASSWORD]]);
      expect(again.ok && again.value).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports doctor checks", async () => {
    const c = await open("login.html");
    const checks = await c.doctor();
    expect(checks.every((ch) => ch.ok)).toBe(true);
    expect(c.capabilities().surface).toBe("web");
  });
});
