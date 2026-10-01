// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// A deliberately small rich-text editor: a contenteditable region (role="textbox", aria-multiline)
// with a toolbar of toggle buttons (aria-pressed). Formatting uses the browser's editing commands
// (Ctrl/Cmd+B and Ctrl/Cmd+I work too); the server sanitizes whatever HTML comes back.
import { Bold, Italic } from "lucide-react";
import { type Ref, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { cn } from "../lib/cn.ts";
import { tid } from "../lib/tid.ts";

export interface RichTextEditorHandle {
  html(): string;
}

type Format = "bold" | "italic";

const FORMATS: Array<{ format: Format; label: string; Icon: typeof Bold }> = [
  { format: "bold", label: "Bold", Icon: Bold },
  { format: "italic", label: "Italic", Icon: Italic },
];

function queryState(format: Format): boolean {
  try {
    return document.queryCommandState(format);
  } catch {
    return false;
  }
}

export interface RichTextEditorProps {
  labelId: string;
  initialHtml: string;
  onInput?: () => void;
  ref?: Ref<RichTextEditorHandle>;
}

export function RichTextEditor({ labelId, initialHtml, onInput, ref }: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<Record<Format, boolean>>({ bold: false, italic: false });

  useImperativeHandle(ref, () => ({ html: () => editorRef.current?.innerHTML ?? "" }), []);

  // Set the content once; React must not re-render inside a contenteditable.
  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = initialHtml;
  }, [initialHtml]);

  const refresh = useCallback(() => {
    const editor = editorRef.current;
    const selection = document.getSelection();
    if (!editor || !selection || !editor.contains(selection.anchorNode)) return;
    setActive({ bold: queryState("bold"), italic: queryState("italic") });
  }, []);

  useEffect(() => {
    document.addEventListener("selectionchange", refresh);
    return () => document.removeEventListener("selectionchange", refresh);
  }, [refresh]);

  function apply(format: Format) {
    editorRef.current?.focus();
    document.execCommand("styleWithCSS", false, "false");
    document.execCommand(format);
    refresh();
    onInput?.();
  }

  return (
    <div className="rounded-md border border-border bg-panel focus-within:outline-2 focus-within:outline-accent">
      <div
        role="toolbar"
        aria-label="Formatting"
        aria-controls={`${labelId}-editor`}
        className="flex gap-1 border-b border-border p-1"
        {...tid("bio.toolbar")}
      >
        {FORMATS.map(({ format, label, Icon }) => (
          <button
            key={format}
            type="button"
            aria-label={label}
            aria-pressed={active[format]}
            // Keep the text selection: don't let the button take focus on mousedown.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => apply(format)}
            className={cn(
              "rounded p-1.5 hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent",
              active[format] ? "bg-accent-soft text-accent" : "text-foreground",
            )}
            {...tid(`bio.toolbar.${format}`)}
          >
            <Icon aria-hidden="true" className="size-4" />
          </button>
        ))}
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: a contenteditable rich-text field has no native element */}
      <div
        ref={editorRef}
        id={`${labelId}-editor`}
        role="textbox"
        aria-multiline="true"
        aria-labelledby={labelId}
        contentEditable
        suppressContentEditableWarning
        tabIndex={0}
        onInput={onInput}
        className="min-h-24 px-3 py-2 text-sm focus:outline-none [&_p]:my-1"
        {...tid("bio.editor")}
      />
    </div>
  );
}
