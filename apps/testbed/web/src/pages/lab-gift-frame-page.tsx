// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Same-origin iframe content for the checkout page: a bare gift-message form (no app shell).
import { GIFT_NOTE_MAX } from "@ghosthand/testbed-kit/lab";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "../components/ui/button.tsx";
import { Textarea } from "../components/ui/input.tsx";
import { Label } from "../components/ui/label.tsx";
import { labApi } from "../lib/lab-api.ts";
import { tid } from "../lib/tid.ts";

export function LabGiftFramePage() {
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | undefined>(undefined);

  useEffect(() => {
    void labApi.checkout().then((res) => {
      if (res.ok) setMessage(res.value.giftMessage);
    });
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const res = await labApi.saveGiftNote(message);
    setStatus(res.ok ? { ok: true, text: res.value.message } : { ok: false, text: res.message });
  }

  return (
    <form className="space-y-2 bg-panel p-3" onSubmit={(e) => void onSubmit(e)} {...tid("gift.form")}>
      <div className="space-y-1">
        <Label htmlFor="gift-message">Gift message</Label>
        <Textarea
          id="gift-message"
          maxLength={GIFT_NOTE_MAX}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          {...tid("gift.message")}
        />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" {...tid("gift.save")}>
          Save message
        </Button>
        {status ? (
          <p
            role={status.ok ? "status" : "alert"}
            className={status.ok ? "text-sm text-good" : "text-sm text-bad"}
          >
            {status.text}
          </p>
        ) : null}
      </div>
    </form>
  );
}
