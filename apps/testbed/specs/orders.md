<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->
---
url: http://127.0.0.1:4400/orders
testbed:
  seed: 42
login: alice@testbed.local
budget:
  steps: 20
  seconds: 150
  usd: 0.15
runs: 1
---

# Suite: Orders (L2)

A paginated orders table with row actions (Edit, Notes, Delete), dialogs and toasts.
These cases need real Jev: the rule-based heuristic only fills fields and presses Save.

## Case: Cancel a refunded order

1. **perform** Open the Edit dialog of order ord_1012 (Farah Rossi, placed 2026-01-21).
   **expect** dialog "Edit order ord_1012" is visible
2. **perform** Set the Status to "Cancelled" and press Save changes.
   **expect** text "Order ord_1012 updated." is visible
   **expect** dialog "Edit order ord_1012" is not visible

**expect** oracle l2-orders-edit-status passes

## Case: Undo a deletion from the toast

1. **perform** Delete Lior Weber's order from 2026-01-20 and confirm the deletion.
   **expect** text "Order ord_1042 deleted." is visible
2. **perform** Press Undo in the notification before it disappears.
   **expect** text "Order ord_1042 restored." is visible
   > The toast stays for a few seconds; a slow step fails this case, which is the point.

**expect** oracle l2-toast-undo passes
**expect** no server errors
