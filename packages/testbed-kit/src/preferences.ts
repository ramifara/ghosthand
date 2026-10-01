// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L6 contact preferences (the page robustness variants are applied to), cookie consent and promo. Browser-safe.
import { z } from "zod";

export const CONTACT_METHODS = ["email", "phone", "sms"] as const;
export const ContactMethod = z.enum(CONTACT_METHODS);
export type ContactMethod = z.infer<typeof ContactMethod>;

export const ContactPrefsRow = z.object({
  userId: z.number().int(),
  phone: z.string(),
  method: ContactMethod,
  news: z.boolean(),
  unsubscribed: z.boolean(),
});
export type ContactPrefsRow = z.infer<typeof ContactPrefsRow>;

/** What every user has until they save (rows are created lazily). */
export const DEFAULT_CONTACT_PREFS: Omit<ContactPrefsRow, "userId"> = {
  phone: "+1 555 0100",
  method: "email",
  news: true,
  unsubscribed: false,
};

export const PHONE_PATTERN = /^\+?[0-9][0-9 ()-]{5,23}$/;

export const ContactPrefsInput = z.object({
  phone: z.string().trim().regex(PHONE_PATTERN),
  method: ContactMethod,
  news: z.boolean(),
});
export type ContactPrefsInput = z.infer<typeof ContactPrefsInput>;

export const PREFERENCES_MESSAGES = {
  saved: "Preferences saved.",
  unsubscribed: "You are unsubscribed from all email.",
  loadFailed: "We couldn't load your preferences.",
  invalidPhone: "Enter a phone number with 6 to 24 digits, spaces or dashes.",
} as const;

/** UI strings of the preferences page per locale (the `locale` variant). Tasks quote these labels. */
export const PREFERENCES_STRINGS = {
  en: {
    title: "Contact preferences",
    description: "How we reach you about your account.",
    phone: "Phone number",
    editPhone: "Edit phone number",
    method: "Preferred contact method",
    methods: { email: "Email", phone: "Phone", sms: "SMS" },
    news: "Send me product news",
    save: "Save preferences",
    saving: "Saving…",
    saved: PREFERENCES_MESSAGES.saved,
    loading: "Loading preferences…",
    loadFailed: PREFERENCES_MESSAGES.loadFailed,
    retry: "Retry",
    shiftNotice: "Getting too many emails?",
    unsubscribe: "Unsubscribe from all email",
    unsubscribed: PREFERENCES_MESSAGES.unsubscribed,
    invalidPhone: PREFERENCES_MESSAGES.invalidPhone,
  },
  ar: {
    title: "تفضيلات الاتصال",
    description: "كيف نتواصل معك بشأن حسابك.",
    phone: "رقم الهاتف",
    editPhone: "تعديل رقم الهاتف",
    method: "طريقة الاتصال المفضلة",
    methods: { email: "البريد الإلكتروني", phone: "مكالمة هاتفية", sms: "رسالة نصية" },
    news: "أرسل لي أخبار المنتجات",
    save: "حفظ التفضيلات",
    saving: "جارٍ الحفظ…",
    saved: "تم حفظ التفضيلات.",
    loading: "جارٍ تحميل التفضيلات…",
    loadFailed: "تعذّر تحميل تفضيلاتك.",
    retry: "إعادة المحاولة",
    shiftNotice: "هل تصلك رسائل كثيرة؟",
    unsubscribe: "إلغاء الاشتراك من جميع الرسائل",
    unsubscribed: "تم إلغاء اشتراكك من جميع الرسائل.",
    invalidPhone: "أدخل رقم هاتف من 6 إلى 24 رقمًا.",
  },
} as const;
export type PreferencesLocale = keyof typeof PREFERENCES_STRINGS;
export type PreferencesStrings = (typeof PREFERENCES_STRINGS)[PreferencesLocale];

export const ConsentChoice = z.enum(["all", "necessary"]);
export type ConsentChoice = z.infer<typeof ConsentChoice>;

export const PromoDecision = z.enum(["dismiss", "accept"]);
export type PromoDecision = z.infer<typeof PromoDecision>;

export const COOKIE_BANNER = {
  title: "We use cookies",
  body: "We use essential cookies to run the testbed and optional cookies for analytics.",
  acceptAll: "Accept all",
  reject: "Reject non-essential",
} as const;

export const PROMO_DISMISS = "No thanks";

/** Seeded promo copy for the `popups` variant. */
export const PROMOS = [
  { headline: "Upgrade to Pro and save 20%", cta: "Upgrade now" },
  { headline: "Try Teams free for 30 days", cta: "Start free trial" },
  { headline: "Get the annual plan at half price", cta: "Claim offer" },
] as const;

export const Chrome = z.object({
  /** The cookie choice made since the last reset, or null when the banner should show. */
  consent: ConsentChoice.nullable(),
  /** The promo to show, or null when there is none (variant off, or already dismissed/accepted). */
  promo: z.object({ headline: z.string(), cta: z.string(), delayMs: z.number().int() }).nullable(),
});
export type Chrome = z.infer<typeof Chrome>;
