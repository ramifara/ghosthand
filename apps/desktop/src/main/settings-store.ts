// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// App settings as validated JSON in userData. A corrupt or outdated file falls back to defaults field by
// field rather than failing the app start.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Settings, type SettingsPatch } from "@ghosthand/protocol";

export class SettingsStore {
  readonly #file: string;
  #value: Settings;

  constructor(file: string) {
    this.#file = file;
    this.#value = SettingsStore.read(file);
  }

  static read(file: string): Settings {
    if (!existsSync(file)) return Settings.parse({});
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return Settings.parse({});
    }
    const whole = Settings.safeParse(raw);
    if (whole.success) return whole.data;
    // Keep every field that still validates.
    const out: Record<string, unknown> = {};
    if (raw && typeof raw === "object") {
      const shape = Settings.shape;
      for (const [key, value] of Object.entries(raw)) {
        if (!Object.hasOwn(shape, key)) continue;
        const field = shape[key as keyof typeof shape].safeParse(value);
        if (field.success) out[key] = field.data;
      }
    }
    return Settings.parse(out);
  }

  get(): Settings {
    return this.#value;
  }

  patch(patch: SettingsPatch): Settings {
    const next = Settings.parse({ ...this.#value, ...patch });
    this.#value = next;
    mkdirSync(dirname(this.#file), { recursive: true });
    const tmp = `${this.#file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.#file);
    return next;
  }
}
