// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Client for the L4 lab routes under /api/lab (same origin, cookie session).
import {
  BoardColumn,
  CardRow,
  ChecklistRow,
  ContactRow,
  type PrefsInput,
  PrefsInput as PrefsSchema,
  ProjectRow,
  ShippingRow,
  Workspace,
} from "@ghosthand/testbed-kit/lab";
import { z } from "zod";

export type LabResult<T> = { ok: true; value: T } | { ok: false; message: string };

const ErrorBody = z.object({ error: z.string() });

async function request<S extends z.ZodType>(
  schema: S,
  path: string,
  init?: { method: string; body?: unknown },
): Promise<LabResult<z.infer<S>>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init?.method ?? "GET",
      credentials: "same-origin",
      ...(init?.body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) }),
    });
  } catch {
    return { ok: false, message: "The server could not be reached. Try again." };
  }
  const json: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const parsed = ErrorBody.safeParse(json);
    return { ok: false, message: parsed.success ? parsed.data.error : `Request failed (${res.status}).` };
  }
  const parsed = schema.safeParse(json);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, message: "Unexpected server response." };
}

const Message = z.object({ message: z.string() });
const Checklist = z.object({ items: z.array(ChecklistRow) });
const Board = z.object({
  columns: z.array(z.object({ id: BoardColumn, name: z.string() })),
  cards: z.array(CardRow),
});
const Contacts = z.object({ contacts: z.array(ContactRow) });
export const LabFeedEvent = z.object({
  id: z.string(),
  title: z.string(),
  at: z.string(),
  flagged: z.boolean(),
});
export type LabFeedEvent = z.infer<typeof LabFeedEvent>;
const FeedPage = z.object({ events: z.array(LabFeedEvent), next: z.number().nullable(), total: z.number() });
export const LabSku = z.object({
  id: z.string(),
  name: z.string(),
  stock: z.number(),
  discontinued: z.boolean(),
});
export type LabSku = z.infer<typeof LabSku>;
const Projects = z.object({ workspace: Workspace, projects: z.array(ProjectRow) });
export type LabProjects = z.infer<typeof Projects>;

export const labApi = {
  checkout: () =>
    request(z.object({ shipping: ShippingRow.nullable(), giftMessage: z.string() }), "/api/lab/checkout"),
  saveGiftNote: (message: string) =>
    request(Message, "/api/lab/gift-note", { method: "PUT", body: { message } }),
  prefs: () => request(z.object({ prefs: PrefsSchema }), "/api/lab/prefs"),
  savePrefs: (prefs: PrefsInput) =>
    request(Message.extend({ prefs: PrefsSchema }), "/api/lab/prefs", { method: "PUT", body: prefs }),
  promo: () => request(z.object({ codes: z.array(z.string()) }), "/api/lab/promo"),
  applyPromo: (code: string) =>
    request(Message.extend({ code: z.string() }), "/api/lab/promo", { method: "POST", body: { code } }),
  signups: () =>
    request(z.object({ days: z.array(z.string()), counts: z.array(z.number()) }), "/api/lab/signups"),
  checklist: () => request(Checklist, "/api/lab/checklist"),
  saveChecklist: (order: string[]) =>
    request(Checklist.extend(Message.shape), "/api/lab/checklist", { method: "PUT", body: { order } }),
  board: () => request(Board, "/api/lab/board"),
  moveCard: (id: string, column: BoardColumn, position: number) =>
    request(z.object({ cards: z.array(CardRow), message: z.string() }), `/api/lab/board/cards/${id}`, {
      method: "PATCH",
      body: { column, position },
    }),
  contacts: () => request(Contacts, "/api/lab/contacts"),
  importContacts: (filename: string, csv: string) =>
    request(Contacts.extend(Message.shape), "/api/lab/contacts/import", {
      method: "POST",
      body: { filename, csv },
    }),
  activity: (cursor: number) => request(FeedPage, `/api/lab/activity?cursor=${cursor}`),
  flagEvent: (id: string) =>
    request(Message.extend({ id: z.string() }), `/api/lab/activity/${id}/flag`, { method: "POST", body: {} }),
  inventory: () => request(z.object({ skus: z.array(LabSku) }), "/api/lab/inventory"),
  discontinue: (id: string) =>
    request(Message.extend({ id: z.string() }), `/api/lab/inventory/${id}/discontinue`, {
      method: "POST",
      body: {},
    }),
  projects: () => request(Projects, "/api/lab/projects"),
  switchWorkspace: (workspace: Workspace) =>
    request(Projects.extend(Message.shape), "/api/lab/workspace", { method: "POST", body: { workspace } }),
  archiveProject: (id: string, via: string) =>
    request(Projects.extend(Message.shape), `/api/lab/projects/${id}/archive`, {
      method: "POST",
      body: { via },
    }),
};
