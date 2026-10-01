<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->
---
url: http://127.0.0.1:4400/profile
testbed:
  seed: 42
login: alice@testbed.local
budget:
  steps: 12
  seconds: 90
  usd: 0.1
runs: 1
planted_bugs:
  profile-title: Update display name and job title
---

# Suite: Profile (L1)

The profile form: client and server validation, a success message, and a confirmation email.
Run with `--variant bug=profile-title` to plant a bug that silently drops the job title on save.

## Case: Update display name and job title

1. **perform** Change the Display name to "Alice Moreau" and the Job title to "Staff Engineer", then save the profile.
   **expect** text "Profile saved." is visible
   **expect** field "Display name" has value "Alice Moreau"
   **expect** field "Job title" has value "Staff Engineer"
   > Saving is a commit the spec allows (front-matter effects default to advance and commit).

**expect** oracle l1-update-profile passes
**expect** no server errors

## Case: Reject a website without https

1. **perform** Change the Website to "alice.dev" and save the profile.
   **expect** text "Website must be a full https:// URL." is visible
   **expect** text "Profile saved." is not visible
