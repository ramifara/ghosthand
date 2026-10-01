# GhostHand licensing notes

Researched 2026-10-01. This is not legal advice. For anything with money attached (a commercial license deal, a trademark filing), pay a lawyer for an hour.

## Goal (from Rami)
- Fully open source from day one.
- Anyone who resells it or builds a product on it must keep their version open, or talk to Rami about a separate license. Rami pointed to Redis and MongoDB as the model.
- Rami doesn't plan to make money from it.
- Plans: TS + Electron desktop app, an MCP server later, possibly hosted by other people.
- Constraint: OpenAI's "Sign in with ChatGPT" (SIWC) plan usage is offered to "open-source and locally hosted apps".

## 1. OpenAI SIWC eligibility: does the license matter?
- Overview page: "These docs explain ChatGPT plan usage for open-source and locally hosted apps. If you're interested in offering it in a paid or remotely hosted app, complete the interest form." https://developers.openai.com/siwc/token-sharing-open-source
- Quickstart: "ChatGPT plan usage is available to all open-source partners and selected private clients." https://developers.openai.com/siwc/quickstart
- Cookbook: "At launch, ChatGPT plan usage is available to open-source projects, personal projects that run locally, and selected private apps." https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt
- **None of the SIWC pages define "open source".** I checked the overview, quickstart, request-client-id, ui-ux-guidelines, sign-in, self-hosted-vms and preview-limitations pages, plus the cookbook article. None of them mention OSI or a list of accepted licenses.
- Inference: the standard industry meaning is an OSI-approved license. MongoDB itself says SSPL code "is not considered open source by the OSI" (https://www.mongodb.com/legal/licensing/server-side-public-license/faq). Redis and Elastic both added AGPL specifically so they could call themselves "open source" again. A project under SSPL, RSAL, ELv2, BSL or FSL is "source-available", not open source, so it gives OpenAI an easy reason to say no. **Choosing an OSI license (AGPL-3.0) removes that question.**
- Separate issue: the license does not decide whether *hosting* is eligible. "Remotely hosted" or "paid" apps go through the interest form no matter what the license is. So if someone runs GhostHand as a hosted service for others, they need their own OpenAI approval. Self-hosted VMs belonging to the user are documented as a supported case: https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms
- Each user's client_id is registered dynamically for that user. A fork shipping SIWC doesn't inherit any GhostHand "approval", because there isn't one to inherit.

## 2. License options

### AGPL-3.0 (OSI-approved, strong copyleft plus a network clause)
- Text: https://www.gnu.org/licenses/agpl-3.0.html  Rationale: https://www.gnu.org/licenses/why-affero-gpl.html  SPDX: https://spdx.org/licenses/AGPL-3.0-only.html
- Same rules as GPLv3, plus **section 13**: if you *modify* the program and users interact with it remotely over a network, you must offer those users the Corresponding Source of your modified version.
- Electron distribution (installers, AppImage, dmg, exe): this is "conveying object code", so section 6 applies. You must ship or offer the complete corresponding source of the AGPL parts, including build scripts, and include the license text. Recipients get the same rights. You can't add further restrictions, such as a no-resale rule or a ban on code signing workarounds. Electron's own Chromium and Node license notices still have to be bundled (https://www.electronjs.org/docs/latest/tutorial/application-distribution).
- **What it does NOT do:**
  - It does not stop anyone from selling GhostHand, charging for hosting it, or charging for support. The FSF explicitly encourages selling free software: https://www.gnu.org/philosophy/selling.html
  - It does not require running an unmodified copy as a service to publish anything, because section 13 is triggered by modification.
  - It does not reach the reseller's separate programs that only talk to GhostHand at arm's length (separate processes, HTTP, MCP).
  - It does not stop internal use without distribution.
  - What it does do: anyone who distributes the app, or hosts a *modified* version, must give their users the source of their version under AGPL. They cannot close it.
- SaaS effect: large companies often ban AGPL code internally (Google is the well-known case). In practice that is what pushes companies to ask for a commercial license, which is the "talk to us" outcome Rami wants.
- -only vs -or-later: "-or-later" lets the FSF's future versions apply, and section 14's proxy clause also allows a named proxy to approve them. "-only" freezes the terms at v3. Redis 8 uses AGPLv3 and Grafana uses AGPL-3.0-only. Recommendation: **AGPL-3.0-only** for predictability. If Rami holds the copyright through a CLA, he can relicense later anyway.

### GPL-3.0
Copyleft only applies when the software is *distributed*. Hosting a modified version as a web service or a remote MCP server triggers nothing. That is weaker than what Rami wants, because a hosted GhostHand is a likely path.

### MPL-2.0
File-level copyleft. Changes to MPL files must stay open, but they can be combined with proprietary code, and there is no network clause. It's too weak for "keep it open". It is compatible with GPL and AGPL through MPL section 3.3 (https://www.gnu.org/licenses/license-list.html#MPL-2.0).

### SSPL v1 (MongoDB 2018, also offered as an option for Redis and Elastic)
Section 13 requires anyone offering the software "as a service" to release "Service Source Code", meaning the whole stack: management, UI, APIs, monitoring, backup, hosting. FAQ: https://www.mongodb.com/legal/licensing/server-side-public-license/faq. MongoDB withdrew it from OSI review, and OSI's position is that it is not open source (https://opensource.org/blog/the-sspl-is-not-an-open-source-license). Debian and Fedora reject it. It **would likely undercut the SIWC "open source" claim and the "fully open source" goal.** Don't use it.

### RSALv2 / SSPL and Redis's return to AGPL
- March 2024: Redis switched from BSD-3 to dual RSALv2/SSPLv1. The Linux Foundation forked it as Valkey (BSD) within about a week.
- 1 May 2025: Redis 8 added **AGPLv3** as a third option. Antirez's return to Redis influenced the change. https://redis.io/blog/agplv3/ , https://antirez.com/news/151 , https://redis.io/legal/licenses/ , https://www.phoronix.com/news/Redis-8.0-Goes-AGPLv3
- The lesson: the "keep it open or talk to us" goal is achieved with AGPL plus a commercial license. Source-available licenses add ill will and forks without much additional protection.

### Elastic (Aug/Sep 2024)
Elastic added AGPL as an option next to SSPL and ELv2 for Elasticsearch and Kibana source code. Shay Banon: "delighted to reintroduce an OSI-approved open source license". https://www.elastic.co/blog/elasticsearch-is-open-source-again , https://www.businesswire.com/news/home/20240829537786/en/

### BSL 1.1 / FSL (fair source)
- BSL 1.1 (MariaDB, HashiCorp 2023): source-available, with an "Additional Use Grant" set by the licensor. It converts to an open license after up to 4 years. https://mariadb.com/bsl11/
- FSL-1.1 (Sentry, 2023): no "Competing Use" for 2 years, then each release converts to Apache-2.0 or MIT. https://fsl.software/ , https://blog.sentry.io/sentry-is-now-fair-source/ , https://fair.io/ . Armin Ronacher's case for FSL over AGPL: https://lucumr.pocoo.org/2024/9/23/fsl-agpl-open-source-businesses/
- Neither is OSI open source. Both fail Rami's "fully open source from day one" goal and put SIWC eligibility at risk. FSL also doesn't force forks to stay open. It only delays competition.

### AGPL plus a commercial dual license, with a CLA (the model Rami is describing)
- Grafana, Loki and Tempo moved from Apache-2.0 to AGPL-3.0 in April 2021. Grafana uses an Apache-derived CLA that lets Grafana Labs relicense contributions. Plugins and agents stayed Apache. https://grafana.com/blog/2021/04/20/grafana-loki-tempo-relicensing-to-agplv3/
- Mattermost: source is AGPL-3.0 or a commercial license. Official binaries ship under MIT. Admin tools and config are Apache-2.0. https://github.com/mattermost/mattermost/blob/master/LICENSE.txt
- MongoDB was AGPL plus commercial before 2018. Qt and MySQL use GPL plus commercial.
- How the model works: the public gets AGPL. Anyone who wants to ship a closed or proprietary fork, or avoid section 13, needs a separate license, and **only the copyright holder(s) can grant it**. If outside contributions come in under AGPL alone (or under the DCO), Rami does not own them and cannot sell or grant a non-AGPL license covering them. So the commercial option requires a **CLA** that grants a broad license (Apache ICLA style, with relicensing rights) or a copyright assignment.

## 3. Compatibility (dependencies and borrowed code)
Sources: GNU license list https://www.gnu.org/licenses/license-list.html , Apache https://www.apache.org/licenses/GPL-compatibility.html , GPL FAQ https://www.gnu.org/licenses/gpl-faq.html

- MIT (Expat), BSD-2/3, ISC, 0BSD, Zlib, Unlicense, CC0: all compatible, so they can be used in or copied into AGPL code. Keep their copyright and permission notices.
- Apache-2.0: compatible with GPLv3 and AGPLv3 (not with GPLv2-only). If you copy Apache code, keep its LICENSE and copyright notices, mark files you changed (section 4(b)), and carry forward the upstream NOTICE file if it has one (section 4(d)).
- MPL-2.0: OK through section 3.3. MPL files stay dual-licensed.
- LGPL-2.1+/3: OK. GPL-3.0: OK through AGPL section 13 and GPL section 13.
- **Watch for:**
  - GPL-2.0-only code (Linux-kernel-style modules, some old libraries) is incompatible with (A)GPLv3.
  - Licenses with field-of-use or anti-commercial limits: CC-BY-NC, "Commons Clause", SSPL, ELv2, BSL/FSL, JSON license ("shall be used for Good, not Evil"), and any proprietary SDK EULA, including some native screen-capture and OCR SDKs. Model weights often come with RAIL or Llama-style licenses, which are not OSI licenses.
  - EPL-1.0 is incompatible. EPL-2.0 is only compatible with a secondary-license notice. CDDL is incompatible.
  - Old GPL-2.0-only native node addons.
- Electron/Chromium bundle ffmpeg (LGPL), plus BSD and MIT components. That's fine: ship their notices (Electron puts LICENSES.chromium.html in the build).
- Run a license audit in CI: `npx license-checker --production --onlyAllow "MIT;ISC;BSD-2-Clause;BSD-3-Clause;Apache-2.0;0BSD;MPL-2.0;BlueOak-1.0.0;CC0-1.0;Unlicense;LGPL-3.0-or-later;..."`, or use ScanCode or FOSSA.

## 4. Users plugging in Codex CLI, Claude CLI, TypeSafe API, OpenAI API, MCP servers
- **There's no AGPL problem.** GhostHand calling another program as a subprocess (`codex`, `claude`) or calling an HTTP API is arm's-length communication between separate programs (GPL FAQ, "mere aggregation" and "separate programs"). The AGPL doesn't extend to Codex, Claude Code, OpenAI or TypeSafe, and their licenses don't change GhostHand's. The user's API keys, prompts and outputs aren't "source" either.
- Bundling is different. Shipping a CLI binary or SDK *inside* the installer is still mostly aggregation, but its own license must allow redistribution. Importing an SDK library (openai npm is Apache-2.0, @anthropic-ai/sdk is MIT) is fine. Some vendor packages have proprietary terms, so check each one before bundling. Don't redistribute Claude Code itself unless its license permits it. Invoking a user-installed copy is the safe pattern.
- **Terms of service are a separate layer from the license.** Anthropic's Consumer Terms (clarified 19 Feb 2026) don't allow using Claude Free/Pro/Max OAuth tokens in third-party tools. Users should bring API keys or run their own `claude` CLI. https://www.theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access/ . OpenAI SIWC plan usage is the sanctioned path for ChatGPT plans.
- MCP server (later): it's a separate program speaking a protocol, so clients that connect to it are not affected by AGPL. If someone hosts a *modified* GhostHand MCP server for others, section 13 requires them to offer its source.

## 5. Contributor agreements
- DCO (https://developercertificate.org/): contributors add `Signed-off-by` to each commit, certifying the right to submit under the project's license. It's low friction and used by Linux and CNCF projects. Contributions come in under AGPL only, so **it doesn't let Rami relicense or sell commercial licenses** for other people's code. GitHub app: https://github.com/dcoapp/app (maintained).
- CLA: a signed grant of a broad copyright and patent license (Apache ICLA style: https://www.apache.org/licenses/contributor-agreements.html), or a full assignment. It **is required for an AGPL plus commercial dual license.** It adds friction, and some contributors refuse CLAs from companies. To reduce distrust, add a promise to the CLA (or the README) that every contribution will always also stay available under an OSI license. FSFE's Fiduciary License Agreement is an alternative.
- Tooling: CLA Assistant (SAP, hosted) https://cla-assistant.io/ , with source at https://github.com/cla-assistant/cla-assistant (not archived, but last pushed June 2024). The GitHub Action version, contributor-assistant/github-action, was **archived in March 2026**, so avoid it or fork it. EasyCLA (Linux Foundation) is another option. Harmony agreements (https://www.harmonyagreements.org/) offer template CLAs.
- Rami's own code: as sole author he owns it already. Write the copyright holder exactly as he wants it, either "Rami <surname>" or a future entity. If an employer or contract could claim his code, check that first.

## 6. Trademark
- A license covers copyright, not the name. AGPL section 7(e) explicitly allows declining to grant trademark rights. Without a trademark policy, a fork could be called "GhostHand Pro".
- Write a TRADEMARKS.md. Unmodified redistribution may use the name. Modified forks must rename and must not imply endorsement. Factual references are fine ("based on GhostHand", "compatible with GhostHand"). Hosted services can't be called "GhostHand Cloud" without permission. Logo use only as specified. Templates: https://modeltrademarkguidelines.org/ , https://github.com/commonhaus/foundation/blob/main/policies/trademark-policy.md
- Unregistered (TM) rights are weak. Check that "GhostHand" isn't already taken in software (USPTO search, class 9/42) before investing. Registration costs roughly $350 per class at the USPTO and can be done later. Use "GhostHand™" in the README.

## 7. Recommended setup (plain terms)
1. **LICENSE**: the unmodified AGPL-3.0 text from gnu.org. In package.json: `"license": "AGPL-3.0-only"`.
2. **SPDX header** on each source file:
   `// SPDX-License-Identifier: AGPL-3.0-only`
   `// Copyright (C) 2026 <Rami full name> and GhostHand contributors`
   Optionally follow REUSE (https://reuse.software/) and run `reuse lint` in CI.
3. **README "License" section**: "GhostHand is AGPL-3.0. You may use, modify, sell, and host it. If you distribute it, or offer a modified version over a network, you must share your source under AGPL-3.0. Want to ship it under other terms? Contact <email> for a commercial license." That gives resellers the "talk to us" route.
4. **CLA** (Apache-ICLA-style grant, not assignment) through cla-assistant.io, *if* Rami wants to keep the option of granting commercial licenses. If he never will, use the **DCO** instead, which is friendlier. A middle path is DCO now and CLA later, but any code already merged under the DCO can't be relicensed without each contributor's consent. **Decide before the first outside PR.**
5. **TRADEMARKS.md** based on the Model Trademark Guidelines (section 6 above).
6. **NOTICE / THIRD_PARTY_NOTICES.md**:
   - List every borrowed file or snippet with its source URL, license, and original copyright line.
   - Keep the original headers in copied files, and add "Modified by GhostHand contributors" for Apache-2.0 code.
   - Copy in the upstream NOTICE text for any Apache code.
   - Generate notices for npm dependencies, and include Electron's LICENSES.chromium.html.
7. **Releases**: every Electron release links to the exact git tag as Corresponding Source. The in-app About screen shows the license and a source link. This also covers section 13 for anyone running it hosted.
8. **Keep separable pieces permissive if you want adoption**: protocol schemas, MCP client SDKs, plugin APIs (MIT or Apache-2.0), the way Grafana and Elastic keep clients Apache. That lets others build integrations without AGPL worries.
9. **CI**: a license-allowlist check on dependencies, which blocks GPL-2.0-only, SSPL, BSL, NC and Commons Clause licenses.

Caveat: these are research notes, not legal advice. Laws differ by country, and enforcement of AGPL section 13 and CLAs is rarely litigated. Get a lawyer to look over the CLA and any commercial license deal before signing one.
