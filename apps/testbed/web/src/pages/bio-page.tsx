// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L3: a public bio edited in a small contenteditable rich-text editor.
import { Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { RequireSession } from "../components/require-session.tsx";
import { RichTextEditor, type RichTextEditorHandle } from "../components/rich-text-editor.tsx";
import { Alert } from "../components/ui/alert.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { api } from "../lib/api.ts";
import { tid } from "../lib/tid.ts";

export function BioPage() {
  return <RequireSession what="edit your bio">{() => <BioEditor />}</RequireSession>;
}

function BioEditor() {
  const editor = useRef<RichTextEditorHandle>(null);
  const [initial, setInitial] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | undefined>(undefined);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void api
      .bio()
      .then((res) => (res.ok ? setInitial(res.value.html) : setMessage({ ok: false, text: res.message })));
  }, []);

  async function save() {
    setPending(true);
    const res = await api.saveBio(editor.current?.html() ?? "");
    setPending(false);
    setMessage(res.ok ? { ok: true, text: res.value.message } : { ok: false, text: res.message });
  }

  return (
    <Card className="max-w-xl" aria-labelledby="bio-title">
      <CardHeader>
        <CardTitle as="h1" id="bio-title" className="text-base">
          Public bio
        </CardTitle>
        <CardDescription>
          Shown on your public page. Bold and italic are the only formatting kept.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {message ? (
          <Alert variant={message.ok ? "success" : "destructive"} {...tid("bio.message")}>
            {message.text}
          </Alert>
        ) : null}
        {initial === undefined ? (
          <p className="text-muted">Loading…</p>
        ) : (
          <div className="space-y-1">
            <p id="bio-label" className="text-xs font-medium">
              Bio
            </p>
            <RichTextEditor
              ref={editor}
              labelId="bio-label"
              initialHtml={initial}
              onInput={() => setMessage(undefined)}
            />
          </div>
        )}
        <Button onClick={() => void save()} disabled={pending || initial === undefined} {...tid("bio.save")}>
          <Save aria-hidden="true" className="size-3.5" />
          {pending ? "Saving…" : "Save bio"}
        </Button>
      </CardContent>
    </Card>
  );
}
