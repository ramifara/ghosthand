// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// A virtual app with nested JSX routes, a layout, an index route, a splat and an object router.
import type { SourceFile } from "../build-source-map.ts";

export const routesApp: SourceFile[] = [
  {
    path: "app.tsx",
    content: `import { Route, Routes } from "react-router";
import { Shell } from "./shell.tsx";
import { HomePage } from "./pages/home.tsx";
import { SettingsLayout } from "./pages/settings/layout.tsx";
import { ProfileSettings } from "./pages/settings/profile.tsx";
import { BillingSettings } from "./pages/settings/billing.tsx";
import { OrderPage } from "./pages/order.tsx";
import { Missing } from "./pages/missing.tsx";
import { RequireAuth } from "./require-auth.tsx";
import { ReportsRoutes } from "./reports/reports-routes.tsx";

export function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<HomePage />} />
        <Route path="settings" element={<SettingsLayout />}>
          <Route index element={<ProfileSettings />} />
          <Route path="billing" element={<RequireAuth><BillingSettings /></RequireAuth>} />
        </Route>
        <Route path="orders/:id" element={<OrderPage />} />
        <Route path="reports/*" element={<ReportsRoutes />} />
        <Route path="*" element={<Missing />} />
      </Route>
    </Routes>
  );
}
`,
  },
  {
    path: "shell.tsx",
    content: `import { Outlet, NavLink } from "react-router";
export function Shell() {
  return (<div><nav aria-label="Main"><NavLink to="/settings" data-testid="nav.settings">Settings</NavLink></nav><Outlet /></div>);
}
`,
  },
  { path: "require-auth.tsx", content: `export function RequireAuth({ children }) { return children; }\n` },
  { path: "pages/home.tsx", content: `export function HomePage() { return <h1>Welcome</h1>; }\n` },
  {
    path: "pages/settings/layout.tsx",
    content: `import { Outlet } from "react-router";
export function SettingsLayout() { return (<section><h1>Settings</h1><Outlet /></section>); }
`,
  },
  {
    path: "pages/settings/profile.tsx",
    content: `import { SaveButton } from "../../components/save-button.tsx";
export function ProfileSettings() { return <SaveButton label="profile" />; }
`,
  },
  {
    path: "pages/settings/billing.tsx",
    content: `export function BillingSettings() { return <button data-testid="billing.pay" onClick={payInvoice}>Pay now</button>; }
function payInvoice() {}
`,
  },
  {
    path: "components/save-button.tsx",
    content: `export function SaveButton({ label }) { return <button data-testid="settings.save">Save</button>; }\n`,
  },
  { path: "pages/order.tsx", content: `export function OrderPage() { return <h2>Order</h2>; }\n` },
  {
    // Descendant routes: relative to the "reports/*" route that renders this component.
    path: "reports/reports-routes.tsx",
    content: `import { Route, Routes } from "react-router";
import { Daily } from "./daily.tsx";
export function ReportsRoutes() {
  return (<Routes><Route path="daily" element={<Daily />} /></Routes>);
}
`,
  },
  { path: "reports/daily.tsx", content: `export function Daily() { return <h1>Daily report</h1>; }\n` },
  { path: "pages/missing.tsx", content: `export function Missing() { return <h1>Not found</h1>; }\n` },
  {
    path: "object-router.tsx",
    content: `import { createBrowserRouter } from "react-router";
import { Admin } from "./admin/admin.tsx";
import { Users } from "./admin/users.tsx";

const routes = [
  {
    path: "/admin",
    element: <Admin />,
    children: [{ index: true, element: <h2>Overview</h2> }, { path: "users", Component: Users }],
  },
];

export const router = createBrowserRouter(routes);
`,
  },
  { path: "admin/admin.tsx", content: `export function Admin() { return <main />; }\n` },
  {
    path: "admin/users.tsx",
    content: `export function Users() { return <button aria-label="Remove user" onClick={() => removeUser(1)} />; }\n`,
  },
];
