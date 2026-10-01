// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The only URLs the app opens in the system browser. Everything else is dropped.

const ALLOWED_HOSTS: readonly string[] = [
  "chatgpt.com",
  "help.openai.com",
  "openai.com",
  "developers.openai.com",
  "typesafe.ai",
  "github.com",
];

/**
 * "Manage usage" target for the ChatGPT plan. The SIWC UI guidelines ask for the link but the research
 * note does not record ChatGPT's settings deep link, so this points at OpenAI's help article on plan
 * usage in other apps. TODO: switch to the documented settings URL once verified.
 */
export const CHATGPT_MANAGE_USAGE_URL =
  "https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites";

export function isAllowedExternalUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return false;
  return ALLOWED_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
}
