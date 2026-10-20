// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Routes of the L4 lab under /lab/* (rendered inside the app shell).
import { Route, Routes } from "react-router";
import { LabActivityPage } from "./lab-activity-page.tsx";
import { LabBoardPage } from "./lab-board-page.tsx";
import { LabCanvasTargetPage } from "./lab-canvas-target-page.tsx";
import { LabChecklistPage } from "./lab-checklist-page.tsx";
import { LabCheckoutPage } from "./lab-checkout-page.tsx";
import { LabContactsPage } from "./lab-contacts-page.tsx";
import { LabIndexPage } from "./lab-index-page.tsx";
import { LabInventoryPage } from "./lab-inventory-page.tsx";
import { LabProjectsPage } from "./lab-projects-page.tsx";
import { LabPreferencesPage, LabPromoPage } from "./lab-shadow-pages.tsx";
import { LabSignupsPage } from "./lab-signups-page.tsx";
import { LabToolbarPage } from "./lab-toolbar-page.tsx";
import { NotFoundPage } from "./not-found-page.tsx";

export function LabRoutes() {
  return (
    <Routes>
      <Route index element={<LabIndexPage />} />
      <Route path="checkout" element={<LabCheckoutPage />} />
      <Route path="preferences" element={<LabPreferencesPage />} />
      <Route path="promo" element={<LabPromoPage />} />
      <Route path="signups" element={<LabSignupsPage />} />
      <Route path="canvas-target" element={<LabCanvasTargetPage />} />
      <Route path="toolbar" element={<LabToolbarPage />} />
      <Route path="checklist" element={<LabChecklistPage />} />
      <Route path="board" element={<LabBoardPage />} />
      <Route path="contacts" element={<LabContactsPage />} />
      <Route path="activity" element={<LabActivityPage />} />
      <Route path="inventory" element={<LabInventoryPage />} />
      <Route path="projects" element={<LabProjectsPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
