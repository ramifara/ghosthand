// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Browser tests for "hard DOM" pages (testbed L4): drag and drop (HTML5 and pointer events), context and
// hover menus, file upload and download, cross-origin frames, shadow roots, feeds and virtualized lists.
// Skipped without a browser, and in CI unless GHOSTHAND_BROWSER_TESTS=1.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActionResult, Element as ProtocolElement, Snapshot } from "@ghosthand/protocol";
import { ActionResult as ActionResultSchema, Snapshot as SnapshotSchema } from "@ghosthand/protocol";
import type { Browser, BrowserContext } from "playwright-core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { registerGhosthandEngine } from "./engine-client.ts";
import type { BrowserLaunch, FixtureServer } from "./test-support.ts";
import { findTestBrowser, launchTestBrowser, startFixtureServer } from "./test-support.ts";
import type { WebComputer, WebComputerOptions } from "./web-computer.ts";
import { createWebComputer } from "./web-computer.ts";

const how: BrowserLaunch | undefined = await findTestBrowser();
const skip =
  how === undefined || (process.env.CI !== undefined && process.env.GHOSTHAND_BROWSER_TESTS !== "1");

describe.skipIf(skip)("WebComputer on hard DOM pages", { timeout: 30_000 }, () => {
  let browser: Browser;
  let server: FixtureServer;
  let context: BrowserContext | undefined;
  let computer: WebComputer | undefined;
  let scratch: string;

  beforeAll(async () => {
    await registerGhosthandEngine();
    if (!how) throw new Error("no browser");
    browser = await launchTestBrowser(how);
    server = await startFixtureServer();
    scratch = mkdtempSync(join(tmpdir(), "gh-hard-dom-"));
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
    rmSync(scratch, { recursive: true, force: true });
  });

  async function open(path: string, opts: Partial<WebComputerOptions> = {}): Promise<WebComputer> {
    context = await browser.newContext({ viewport: { width: 1280, height: 720 }, acceptDownloads: true });
    const created = await createWebComputer({
      context,
      allowOrigins: [server.origin, server.otherOrigin],
      ...opts,
    });
    if (!created.ok) throw new Error(created.error.message);
    computer = created.value;
    const opened = await computer.open(`${server.origin}/${path}`);
    if (!opened.ok) throw new Error(opened.error.message);
    return computer;
  }

  async function observe(c: WebComputer): Promise<Snapshot> {
    const s = await c.observe();
    if (!s.ok) throw new Error(s.error.message);
    return SnapshotSchema.parse(s.value);
  }

  function find(s: Snapshot, name: string | RegExp, role?: string): ProtocolElement {
    const el = s.elements.find(
      (e) => (typeof name === "string" ? e.name === name : name.test(e.name)) && (!role || e.role === role),
    );
    if (!el)
      throw new Error(`no ${role ?? "element"} "${name}" in ${s.elements.map((e) => e.name).join(" | ")}`);
    return el;
  }

  function expectConfirmed(r: ActionResult): void {
    ActionResultSchema.parse(r);
    expect(r.error, JSON.stringify(r)).toBeUndefined();
    expect(r.effect, JSON.stringify(r)).toBe("confirmed");
  }

  // ---- observation ---------------------------------------------------------------------------------

  it("offers drag, drop and context_menu from markup, and honest frame and shadow coverage", async () => {
    const c = await open("hard-dom.html");
    const s = await observe(c);
    const alpha = find(s, "Alpha step", "listitem");
    expect(alpha.actions).toEqual(expect.arrayContaining(["drag", "drop"]));
    const todo = find(s, "Todo", "list");
    expect(todo.actions).toEqual(["drop", "scroll_into_view"]);
    expect(todo.roleClass).toBe("container");
    expect(find(s, "Done", "list").actions[0]).toBe("drop");
    expect(find(s, "Write tests", "listitem").actions).toContain("drag");
    const row = find(s, /^Nimbus/, "row");
    expect(row.actions).toContain("context_menu");
    const trigger = find(s, "Workspace", "button");
    expect(trigger.actions).toContain("press");
    expect(trigger.actions).not.toContain("context_menu");
    const upload = find(s, "Upload file");
    expect(upload.nativeRole).toBe("input[type=file]");
    expect(upload.actions[0]).toBe("set_value");
    expect(upload.value).toBe("<empty>");
    // Open shadow roots and cross-origin frames are in the table; a closed shadow root is not.
    expect(find(s, "Shadow save", "button").frame).toBe("main");
    expect(find(s, "Card holder", "textbox").frame).toBe("main > Remote form");
    expect(s.elements.some((e) => e.name === "Hidden save")).toBe(false);
    expect(s.canScroll).toBe(false);
  });

  // ---- drag and drop -------------------------------------------------------------------------------

  it("drags with HTML5 drag and drop and with pointer events", async () => {
    const c = await open("hard-dom.html");
    let s = await observe(c);
    const r1 = await c.drag({ token: find(s, "Gamma step").token }, { token: find(s, "Alpha step").token });
    expectConfirmed(r1);
    s = await observe(c);
    expect(s.text).toContain("c,a,b");
    const r2 = await c.drag(
      { token: find(s, "Write tests").token },
      { token: find(s, "Done", "list").token },
    );
    expectConfirmed(r2);
    s = await observe(c);
    expect(s.text).toContain("moved to done");
  });

  // ---- menus ---------------------------------------------------------------------------------------

  it("opens a row context menu with a right-click on its token, and a hover menu by pressing", async () => {
    const c = await open("hard-dom.html");
    let s = await observe(c);
    expectConfirmed(await c.click({ token: find(s, /^Nimbus/, "row").token }, { button: "right" }));
    s = await observe(c);
    expectConfirmed(await c.press(find(s, "Archive", "menuitem").token));
    s = await observe(c);
    expect(s.text).toContain("archived Nimbus");

    expectConfirmed(await c.press(find(s, "Workspace", "button").token));
    s = await observe(c);
    expect(find(s, "Workspace", "button").states).toContain("expanded");
    // A menuitemradio closes its menu when chosen: toggling it is confirmed by the menu going away.
    expectConfirmed(await c.toggle(find(s, "Vega", "menuitemradio").token, true));
    s = await observe(c);
    expect(s.text).toContain("workspace Vega");
  });

  // ---- upload and download -------------------------------------------------------------------------

  it("uploads a file from the upload directory and refuses anything else", async () => {
    const uploads = join(scratch, "uploads");
    mkdirSync(uploads, { recursive: true });
    writeFileSync(join(uploads, "contacts.csv"), "name,email\n");
    writeFileSync(join(scratch, "secret.txt"), "outside");
    symlinkSync(join(scratch, "secret.txt"), join(uploads, "link.txt"));
    const c = await open("hard-dom.html", { uploadDir: uploads });
    let s = await observe(c);
    const refused = async (name: string, kind: string) => {
      const r = await c.setValue(find(s, "Upload file").token, name);
      expect(r.effect, name).toBe("refused");
      expect(r.error?.kind, name).toBe(kind);
    };
    await refused("../secret.txt", "unsupported");
    await refused("/etc/passwd", "unsupported");
    await refused("link.txt", "unsupported");
    await refused("missing.csv", "not_found");
    const r = await c.setValue(find(s, "Upload file").token, "contacts.csv");
    expectConfirmed(r);
    expect(r.evidence[0]?.after).toBe("contacts.csv");
    s = await observe(c);
    expect(s.text).toContain("contacts.csv");
    expect(find(s, "Upload file").value).toBe("contacts.csv");
  });

  it("refuses uploads when no upload directory is set", async () => {
    const c = await open("hard-dom.html");
    const s = await observe(c);
    const r = await c.setValue(find(s, "Upload file").token, "contacts.csv");
    expect(r.effect).toBe("refused");
    expect(r.error?.kind).toBe("unsupported");
  });

  it("saves a download and reports it as evidence", async () => {
    const downloads = join(scratch, "downloads");
    const c = await open("hard-dom.html", { downloadDir: downloads });
    const s = await observe(c);
    const r = await c.press(find(s, "Download CSV", "link").token);
    expectConfirmed(r);
    expect(r.evidence[0]?.kind).toBe("network");
    expect(r.evidence[0]?.detail).toContain("downloaded report.csv");
    expect(c.downloads).toHaveLength(1);
    const saved = c.downloads[0];
    expect(saved && existsSync(saved.path)).toBe(true);
    expect(readFileSync(saved?.path ?? "", "utf8")).toContain("alpha,1");
  });

  // ---- frames and shadow roots ---------------------------------------------------------------------

  it("acts inside a cross-origin iframe and an open shadow root", async () => {
    const c = await open("hard-dom.html");
    let s = await observe(c);
    expectConfirmed(await c.setValue(find(s, "Card holder", "textbox").token, "Ada"));
    s = await observe(c);
    expectConfirmed(await c.press(find(s, "Pay now").token));
    s = await observe(c);
    expect(s.text).toContain("Payment sent");
    expectConfirmed(await c.press(find(s, "Shadow save").token));
  });

  // ---- scrolling -----------------------------------------------------------------------------------

  it("flags more content, loads a feed by scrolling the page, and scrolls a virtualized list", async () => {
    const c = await open("scrolling.html");
    let s = await observe(c);
    expect(s.canScroll).toBe(true);
    expect(s.elements.some((e) => e.name === "Open event 9")).toBe(false);
    for (let i = 0; i < 6 && !s.elements.some((e) => e.name === "Open event 9"); i++) {
      const r = await c.scroll(0, 600);
      expect(r.effect, JSON.stringify(r)).toBe("confirmed");
      s = await observe(c);
    }
    expect(s.elements.some((e) => e.name === "Open event 9")).toBe(true);

    expect(s.elements.some((e) => e.name === "Pick row 40")).toBe(false);
    for (let i = 0; i < 10 && !s.elements.some((e) => e.name === "Pick row 40"); i++) {
      const inList = s.elements.find((e) => /^Pick row \d+$/.test(e.name));
      if (!inList) throw new Error("no rendered row");
      const r = await c.scroll(0, 300, { token: inList.token });
      expect(r.effect, JSON.stringify(r)).toBe("confirmed");
      s = await observe(c);
    }
    expectConfirmed(await c.press(find(s, "Pick row 40").token));
    s = await observe(c);
    expect(s.text).toContain("picked 40");
  });
});
