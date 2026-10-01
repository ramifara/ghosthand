<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->
---
url: http://127.0.0.1:4400/login
testbed:
  seed: 42
secrets: [TESTBED_PASSWORD, TESTBED_WRONG_PASSWORD]
budget:
  steps: 10
  seconds: 60
  usd: 0.05
runs: 1
---

# Suite: Sign-in (L1)

Email and password sign-in. Passwords are typed by the driver from stored secrets; models only see
`[input:NAME]`.

## Case: Sign in with the stored password

1. **perform** Sign in as "alice@testbed.local" with the password [input:TESTBED_PASSWORD].
   **expect** text "Signed in as alice@testbed.local" is visible
   **expect** text "Invalid email or password." is not visible

**expect** oracle l1-login passes
**expect** no console errors

## Case: A wrong password shows an error

1. **perform** Sign in as "alice@testbed.local" with the password [input:TESTBED_WRONG_PASSWORD].
   **expect** text "Invalid email or password." is visible
   **expect** the URL is /login
