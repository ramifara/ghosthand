// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L4 "hard DOM" lab: fixture data, wire shapes and the lab part of the oracle snapshot. Browser-safe.
// Every generated list comes from the seeded PRNG, so the same seed always gives the same rows.
import { z } from "zod";
import { createRng } from "./prng.ts";

// ---- shipping widget (cross-origin iframe) and gift message (same-origin iframe) -------------------

export const SHIPPING_COUNTRIES = ["Denmark", "Finland", "Iceland", "Norway", "Sweden"] as const;
export const ShippingCountry = z.enum(SHIPPING_COUNTRIES);

export const ShippingInput = z.object({
  fullName: z.string().trim().min(1, "Enter the recipient's name.").max(80),
  street: z.string().trim().min(1, "Enter a street address.").max(120),
  city: z.string().trim().min(1, "Enter a city.").max(60),
  postalCode: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z -]{3,10}$/, "Enter a valid postal code."),
  country: ShippingCountry,
});
export type ShippingInput = z.infer<typeof ShippingInput>;

export const ShippingRow = ShippingInput.extend({ userId: z.number().int() });
export type ShippingRow = z.infer<typeof ShippingRow>;

export const GIFT_NOTE_MAX = 200;
export const GiftNoteRow = z.object({ userId: z.number().int(), message: z.string() });
export type GiftNoteRow = z.infer<typeof GiftNoteRow>;

export const LAB_MESSAGES = {
  shippingSaved: "Shipping address saved.",
  giftSaved: "Gift message saved.",
  prefsSaved: "Preferences saved.",
  promoApplied: (code: string) => `Promo code ${code} applied.`,
  promoUnknown: "That promo code is not valid.",
  checklistSaved: "Checklist order saved.",
  cardMoved: (title: string, column: string) => `Moved "${title}" to ${column}.`,
  imported: (n: number) => `Imported ${n} contact${n === 1 ? "" : "s"}.`,
  flagged: (title: string) => `Flagged "${title}".`,
  discontinued: (id: string) => `${id} marked as discontinued.`,
  workspace: (name: string) => `Switched to workspace ${name}.`,
  archived: (name: string) => `Project ${name} archived.`,
  canvasHit: (shape: string) => `Selected the ${shape}.`,
  canvasMiss: "Nothing there. Click one of the shapes.",
  paneOpened: (title: string) => `${title} pane opened.`,
} as const;

/** Shapes painted on the canvas-target page (ADR 0020): names the agent is given, never DOM nodes. */
export const CANVAS_TARGET_SHAPES = ["red circle", "blue square", "green triangle"] as const;
export type CanvasTargetShape = (typeof CANVAS_TARGET_SHAPES)[number];

/** Panes behind the icon-only toolbar on the toolbar page; under `a11y: "poor"` the icons have no names. */
export const TOOLBAR_PANES = {
  search: "Search",
  filters: "Filters",
  export: "Export",
  settings: "Settings",
} as const;
export type ToolbarPane = keyof typeof TOOLBAR_PANES;

// ---- notification preferences (open shadow root) --------------------------------------------------

export const DIGEST_TIMES = ["Off", "08:00", "12:00", "18:00"] as const;
export const DigestTime = z.enum(DIGEST_TIMES);
export type DigestTime = z.infer<typeof DigestTime>;
export const PrefsInput = z.object({ digestAt: DigestTime, weeklySummary: z.boolean() });
export type PrefsInput = z.infer<typeof PrefsInput>;
export const PrefsRow = PrefsInput.extend({ userId: z.number().int() });
export type PrefsRow = z.infer<typeof PrefsRow>;
export const DEFAULT_PREFS: PrefsInput = { digestAt: "08:00", weeklySummary: false };

// ---- promo code (closed shadow root) ----------------------------------------------------------------

export const PROMO_CODES = ["SPRING-26", "WELCOME-10"] as const;
export const PromoRow = z.object({ userId: z.number().int(), code: z.string() });
export type PromoRow = z.infer<typeof PromoRow>;

// ---- sign-ups chart (canvas) ------------------------------------------------------------------------

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Seven distinct daily sign-up counts (Mon..Sun) for a seed. Only ever drawn on a canvas. */
export function labSignups(seed: number): number[] {
  const rng = createRng((seed ^ 0x5161) >>> 0);
  const out: number[] = [];
  while (out.length < WEEKDAYS.length) {
    const n = rng.int(12, 96);
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

// ---- release checklist (HTML5 drag and drop) --------------------------------------------------------

export const ChecklistRow = z.object({ id: z.string(), title: z.string(), position: z.number().int() });
export type ChecklistRow = z.infer<typeof ChecklistRow>;

export const CHECKLIST_ITEMS = [
  { id: "chk_freeze", title: "Freeze the branch" },
  { id: "chk_tests", title: "Run the full test suite" },
  { id: "chk_upgrade", title: "Write upgrade notes" },
  { id: "chk_changelog", title: "Update the changelog" },
  { id: "chk_tag", title: "Tag the release" },
  { id: "chk_support", title: "Notify the support team" },
] as const;

export const ChecklistOrderInput = z.object({ order: z.array(z.string()).min(1) });

// ---- board (pointer-events kanban) -------------------------------------------------------------------

export const BOARD_COLUMNS = [
  { id: "todo", name: "To do" },
  { id: "doing", name: "In progress" },
  { id: "done", name: "Done" },
] as const;
export const BoardColumn = z.enum(["todo", "doing", "done"]);
export type BoardColumn = z.infer<typeof BoardColumn>;

export const CardRow = z.object({
  id: z.string(),
  title: z.string(),
  column: BoardColumn,
  position: z.number().int(),
});
export type CardRow = z.infer<typeof CardRow>;

export const BOARD_CARDS: readonly Omit<CardRow, "position">[] = [
  { id: "card_onboarding", title: "Write onboarding guide", column: "todo" },
  { id: "card_contrast", title: "Audit color contrast", column: "todo" },
  { id: "card_login", title: "Fix login timeout", column: "doing" },
  { id: "card_billing", title: "Migrate billing jobs", column: "doing" },
  { id: "card_tracking", title: "Set up error tracking", column: "done" },
];

export const CardMoveInput = z.object({ column: BoardColumn, position: z.number().int().nonnegative() });

// ---- contacts (file upload + CSV download) ----------------------------------------------------------

export const ContactSource = z.enum(["seed", "import"]);
export const ContactRow = z.object({
  id: z.number().int(),
  name: z.string(),
  email: z.string(),
  company: z.string(),
  source: ContactSource,
});
export type ContactRow = z.infer<typeof ContactRow>;

export type ContactInput = Pick<ContactRow, "name" | "email" | "company">;

export const SEED_CONTACTS: readonly ContactInput[] = [
  { name: "Priya Raman", email: "priya@northwind.example", company: "Northwind" },
  { name: "Tomás Ortega", email: "tomas@contoso.example", company: "Contoso" },
  { name: "Mei Lin", email: "mei@fabrikam.example", company: "Fabrikam" },
];

/** The file the upload task hands over (apps/testbed/fixtures/uploads/contacts.csv); a server test keeps them in sync. */
export const UPLOAD_FILE_NAME = "contacts.csv";
export const UPLOAD_CONTACTS: readonly ContactInput[] = [
  { name: "Jonas Berg", email: "jonas@lumen.example", company: "Lumen Labs" },
  { name: "Aisha Bello", email: "aisha@kitebox.example", company: "Kitebox" },
  { name: "Ravi Shah", email: "ravi@orbitly.example", company: "Orbitly" },
  { name: "Elena Petrova", email: "elena@quartz.example", company: "Quartz, Inc." },
];

export const ContactsImportInput = z.object({
  filename: z.string().min(1).max(200),
  csv: z.string().max(100_000),
});

export const CONTACT_CSV_HEADER = ["name", "email", "company"] as const;

/** Splits one CSV line (RFC 4180 quoting, no embedded newlines). */
function csvFields(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((f) => f.trim());
}

export type ParsedContacts = { ok: true; rows: ContactInput[] } | { ok: false; error: string };

/** Parses a contacts CSV with the header `name,email,company`. Blank lines and `#` comment lines are skipped. */
export function parseContactsCsv(csv: string): ParsedContacts {
  const lines = csv
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0 && !l.startsWith("#"));
  const header = lines.shift();
  if (header === undefined) return { ok: false, error: "The file is empty." };
  const cols = csvFields(header).map((h) => h.toLowerCase());
  if (cols.join(",") !== CONTACT_CSV_HEADER.join(","))
    return { ok: false, error: "The first line must be: name,email,company" };
  const rows: ContactInput[] = [];
  for (const [i, line] of lines.entries()) {
    const [name = "", email = "", company = ""] = csvFields(line);
    if (!name || !/^[^@\s]+@[^@\s]+$/.test(email))
      return { ok: false, error: `Row ${i + 1} needs a name and a valid email.` };
    rows.push({ name, email: email.toLowerCase(), company });
  }
  return { ok: true, rows };
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function contactsToCsv(rows: readonly ContactInput[]): string {
  const lines = [CONTACT_CSV_HEADER.join(",")];
  for (const r of rows) lines.push([r.name, r.email, r.company].map(csvCell).join(","));
  return `${lines.join("\n")}\n`;
}

// ---- activity feed (infinite scroll) ----------------------------------------------------------------

export const FEED_TOTAL = 60;
export const FEED_PAGE_SIZE = 12;
/** The event the infinite-scroll task flags: in the fourth page, never in the first render. */
export const FEED_TARGET = { id: "evt_041", title: "Invoice INV-2041 is overdue" } as const;

export const FeedEvent = z.object({ id: z.string(), title: z.string(), at: z.string() });
export type FeedEvent = z.infer<typeof FeedEvent>;

const SERVICES = ["billing", "search", "auth", "media", "reports", "mailer"];
const PEOPLE = ["Kemi", "Lior", "Nils", "Hana", "Goran", "Farah", "Ivo", "Dana"];

/** The 60 feed events, newest first. Titles are unique; only the target mentions INV-2041. */
export function labFeedEvents(seed: number): FeedEvent[] {
  const rng = createRng((seed ^ 0xfeed) >>> 0);
  const out: FeedEvent[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < FEED_TOTAL; i++) {
    const id = `evt_${String(i + 1).padStart(3, "0")}`;
    let title: string = FEED_TARGET.title;
    if (id !== FEED_TARGET.id) {
      do {
        const kind = rng.int(0, 3);
        if (kind === 0) title = `Invoice INV-${rng.int(2100, 2999)} is overdue`;
        else if (kind === 1) title = `Deploy of ${rng.pick(SERVICES)} #${rng.int(100, 999)} finished`;
        else if (kind === 2) title = `${rng.pick(PEOPLE)} joined the ${rng.pick(SERVICES)} team`;
        else title = `Backup ${rng.int(1000, 9999)} completed`;
      } while (seen.has(title));
    }
    seen.add(title);
    const minutes = i * 37;
    const at = new Date(Date.UTC(2026, 2, 2, 9, 0) - minutes * 60_000).toISOString();
    out.push({ id, title, at });
  }
  return out;
}

// ---- inventory (virtualized list) -------------------------------------------------------------------

export const SKU_TOTAL = 200;
export const SKU_FIRST = 1000;
/** The SKU the virtualized-list task discontinues: far below the first rendered window. */
export const SKU_TARGET = "SKU-1075";

export const SkuItem = z.object({ id: z.string(), name: z.string(), stock: z.number().int() });
export type SkuItem = z.infer<typeof SkuItem>;

const SKU_ADJ = ["Walnut", "Oak", "Birch", "Slate", "Copper", "Linen", "Ash", "Cedar", "Brass", "Wool"];
const SKU_NOUN = ["shelf", "stool", "lamp", "tray", "crate", "bench", "hook", "rack", "bowl", "mirror"];

export function labSkus(seed: number): SkuItem[] {
  const rng = createRng((seed ^ 0x5c0) >>> 0);
  return Array.from({ length: SKU_TOTAL }, (_, i) => ({
    id: `SKU-${SKU_FIRST + i}`,
    name: `${rng.pick(SKU_ADJ)} ${rng.pick(SKU_NOUN)}`,
    stock: rng.int(0, 240),
  }));
}

// ---- projects (hover menu + context menu) -----------------------------------------------------------

export const WORKSPACES = ["Atlas", "Vega", "Lyra"] as const;
export const Workspace = z.enum(WORKSPACES);
export type Workspace = z.infer<typeof Workspace>;
export const DEFAULT_WORKSPACE: Workspace = "Atlas";

export const ProjectRow = z.object({
  id: z.string(),
  name: z.string(),
  workspace: Workspace,
  archived: z.boolean(),
});
export type ProjectRow = z.infer<typeof ProjectRow>;

export const LAB_PROJECTS: readonly Omit<ProjectRow, "archived">[] = [
  { id: "prj_apollo", name: "Apollo", workspace: "Atlas" },
  { id: "prj_borealis", name: "Borealis", workspace: "Atlas" },
  { id: "prj_cygnus", name: "Cygnus", workspace: "Atlas" },
  { id: "prj_nimbus", name: "Nimbus", workspace: "Vega" },
  { id: "prj_orion", name: "Orion", workspace: "Vega" },
  { id: "prj_pulsar", name: "Pulsar", workspace: "Vega" },
  { id: "prj_quasar", name: "Quasar", workspace: "Lyra" },
];

export const WorkspaceRow = z.object({ userId: z.number().int(), workspace: Workspace });
export type WorkspaceRow = z.infer<typeof WorkspaceRow>;

// ---- the lab part of the oracle snapshot ------------------------------------------------------------

export const LabState = z.object({
  shipping: z.array(ShippingRow),
  giftNotes: z.array(GiftNoteRow),
  prefs: z.array(PrefsRow),
  promos: z.array(PromoRow),
  checklist: z.array(ChecklistRow),
  cards: z.array(CardRow),
  contacts: z.array(ContactRow),
  flaggedEvents: z.array(z.string()),
  discontinuedSkus: z.array(z.string()),
  projects: z.array(ProjectRow),
  workspaces: z.array(WorkspaceRow),
});
export type LabState = z.infer<typeof LabState>;

export const EMPTY_LAB: LabState = {
  shipping: [],
  giftNotes: [],
  prefs: [],
  promos: [],
  checklist: [],
  cards: [],
  contacts: [],
  flaggedEvents: [],
  discontinuedSkus: [],
  projects: [],
  workspaces: [],
};
