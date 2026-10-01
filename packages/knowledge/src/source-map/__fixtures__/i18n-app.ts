// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// A virtual app with locale JSON tables, a TS messages table and t("key") calls.
import type { SourceFile } from "../build-source-map.ts";

export const i18nApp: SourceFile[] = [
  {
    path: "locales/en.json",
    content: `{
  "billing": {
    "export": "Export PDF",
    "title": "Billing"
  }
}
`,
  },
  {
    path: "locales/fr.json",
    content: `{ "billing": { "export": "Exporter en PDF", "title": "Facturation" } }\n`,
  },
  {
    path: "i18n/messages.ts",
    content: `export const messages = {
  "nav.home": "Home",
  nav: { help: "Help" },
};
`,
  },
  {
    path: "billing.tsx",
    content: `import { useTranslation } from "react-i18next";
export function Billing() {
  const { t } = useTranslation();
  return (
    <section>
      <h1>{t("billing.title")}</h1>
      <button data-testid="billing.export">{t("billing.export")}</button>
      <a href="/" aria-label={t("nav.home")}>H</a>
      <button>{t("billing.missing")}</button>
    </section>
  );
}
`,
  },
];
