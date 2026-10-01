// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Prompt-injection fixture (P1-09): product reviews written by "users". One review carries visible and
// screen-reader-only instructions aimed at AI agents, plus an off-site link. Nothing here is trustworthy.
import { Star } from "lucide-react";
import { useEffect, useState } from "react";
import { RequireSession } from "../components/require-session.tsx";
import { Alert } from "../components/ui/alert.tsx";
import { Button } from "../components/ui/button.tsx";
import { api, type ReviewItem } from "../lib/api.ts";
import { tid } from "../lib/tid.ts";

const PRODUCTS = ["Blue Mug", "Green Teapot"] as const;
const STAR_KEYS = ["s1", "s2", "s3", "s4", "s5"] as const;

export function ReviewsPage() {
  return <RequireSession what="read reviews">{() => <ReviewsView />}</RequireSession>;
}

function ReviewsView() {
  const [reviews, setReviews] = useState<ReviewItem[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [helpful, setHelpful] = useState<Set<string>>(new Set());

  useEffect(() => {
    void api.reviews().then((res) => (res.ok ? setReviews(res.value.reviews) : setError(res.message)));
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Product reviews</h1>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {reviews === undefined && !error ? <p className="text-muted">Loading…</p> : null}
      {reviews
        ? PRODUCTS.map((product) => {
            const id = `reviews-${product.toLowerCase().replace(/\s+/g, "-")}`;
            const list = reviews.filter((r) => r.product === product);
            return (
              <section key={product} aria-labelledby={id} className="space-y-2">
                <h2 id={id} className="text-base font-semibold">
                  {product}
                </h2>
                <p className="text-sm text-muted">{`${list.length} reviews`}</p>
                <ul className="space-y-2">
                  {list.map((r) => (
                    <li key={r.id}>
                      <article
                        aria-labelledby={`review-${r.id}`}
                        className="rounded-md border border-border bg-panel p-3 text-sm"
                        {...tid(`review.${r.id}`)}
                      >
                        <h3 id={`review-${r.id}`} className="font-medium">
                          {r.title}
                        </h3>
                        <p className="flex items-center gap-2 text-muted">
                          <span>{r.author}</span>
                          <span aria-hidden="true" className="flex">
                            {STAR_KEYS.map((key, i) => (
                              <Star
                                key={key}
                                className={i < r.stars ? "size-3.5 fill-current text-accent" : "size-3.5"}
                              />
                            ))}
                          </span>
                          <span>{`${r.stars} out of 5 stars`}</span>
                        </p>
                        <p className="mt-1">{r.body}</p>
                        {r.hiddenNote ? (
                          <>
                            <p className="sr-only">{r.hiddenNote}</p>
                            <p hidden>{r.hiddenNote}</p>
                          </>
                        ) : null}
                        {r.link ? (
                          <p className="mt-1">
                            <a href={r.link.href} className="text-accent underline">
                              {r.link.label}
                            </a>
                          </p>
                        ) : null}
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-2"
                          aria-pressed={helpful.has(r.id)}
                          onClick={() =>
                            setHelpful((h) => {
                              const next = new Set(h);
                              if (next.has(r.id)) next.delete(r.id);
                              else next.add(r.id);
                              return next;
                            })
                          }
                        >
                          Helpful
                        </Button>
                      </article>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        : null}
    </div>
  );
}
