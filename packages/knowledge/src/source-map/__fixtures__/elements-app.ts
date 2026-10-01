// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// A virtual app exercising element extraction: tid() helpers, template-literal testids, `.map` over const
// data, spreads of local objects, labels, roles, risk tags and forms.
import type { SourceFile } from "../build-source-map.ts";

export const elementsApp: SourceFile[] = [
  {
    path: "app.tsx",
    content: `import { Route, Routes } from "react-router";
import { InboxPage } from "./inbox.tsx";
import { SignupPage } from "./signup.tsx";
export function App() {
  return (<Routes><Route path="/inbox" element={<InboxPage />} /><Route path="/signup" element={<SignupPage />} /></Routes>);
}
`,
  },
  {
    path: "lib/tid.ts",
    content: `export function tid(id: string) { return { "data-testid": id }; }\n`,
  },
  {
    path: "inbox.tsx",
    content: `import { tid } from "./lib/tid.ts";

const TABS = [
  { key: "all", label: "All mail" },
  { key: "starred", label: "Starred" },
];

export function InboxPage({ messages, pending }) {
  return (
    <div>
      <h1>Inbox</h1>
      {TABS.map((t) => (
        <button key={t.key} role="tab" {...tid(\`inbox.tab.\${t.key}\`)}>
          {t.label}
        </button>
      ))}
      <ul aria-label="Messages" {...tid("inbox.list")}>
        {messages.map((m) => (
          <li key={m.id} {...tid(\`inbox.message.\${m.id}\`)}>{m.subject}</li>
        ))}
      </ul>
      <button type="button" variant="destructive" onClick={() => deleteAll()} {...tid("inbox.delete-all")}>
        Delete all
      </button>
      <Button onClick={sendReply} data-testid="inbox.reply">{pending ? "Sending…" : "Send reply"}</Button>
      <IconButton aria-label="Archive" {...tid("inbox.archive")}><ArchiveIcon aria-hidden="true" /></IconButton>
      <a href="/help" title="Help center">?</a>
    </div>
  );
}
`,
  },
  {
    path: "signup.tsx",
    content: `import { tid } from "./lib/tid.ts";

const FIELDS = [
  { key: "email", label: "Email address", type: "email" },
  { key: "bio", label: "About you", multiline: true },
];

export function SignupPage() {
  return (
    <form aria-label="Sign up" {...tid("signup.form")}>
      {FIELDS.map((f) => {
        const id = \`signup-\${f.key}\`;
        const common = { id, name: f.key, ...tid(\`signup.\${f.key}\`) };
        return (
          <div key={f.key}>
            <Label htmlFor={id}>{f.label}</Label>
            {f.multiline ? <textarea {...common} /> : <input type={f.type} required {...common} />}
          </div>
        );
      })}
      <label>
        Accept terms
        <input type="checkbox" name="terms" />
      </label>
      <select id="plan" name="plan"><option>Free</option></select>
      <input type="search" placeholder="Find a team" />
      <button type="submit" {...tid("signup.submit")}>Create account</button>
    </form>
  );
}
`,
  },
];
