"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";

/**
 * Developer search, as a combobox in the nav.
 *
 * Three obligations shape this component:
 *
 * 1. **It works with JavaScript off.** The markup is a plain
 *    `<form action="/search">` with a named input, so submitting it navigates to
 *    the server-rendered results page. The suggestion list is an enhancement
 *    layered on top, never the only way through.
 * 2. **It is a real combobox**, not a div with a keydown handler: the input owns
 *    `role="combobox"`, `aria-expanded` and `aria-activedescendant`, and the
 *    options carry `role="option"`. Arrow keys move the active option without
 *    moving DOM focus, which is what lets Enter mean "open the highlighted
 *    result" while the input keeps receiving text.
 * 3. **It does not stampede the API.** Keystrokes are debounced and every
 *    in-flight request is aborted when the next one starts, so typing eight
 *    characters costs one response rather than eight.
 */

interface Suggestion {
  login: string;
  name: string | null;
  avatarUrl: string;
  total: number;
  hasProfile: boolean;
}

const DEBOUNCE_MS = 160;
const SUGGESTIONS = 8;

export function SearchBox({ className = "" }: { className?: string }) {
  const router = useRouter();
  const id = useId();
  const listId = `${id}-listbox`;

  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);

  const box = useRef<HTMLDivElement>(null);

  const term = query.trim();
  // Below two characters there is nothing to suggest, so the effect does not run
  // and the panel is gated on the same condition rather than on cleared state —
  // clearing it from inside the effect would cascade an extra render on every
  // keystroke that deletes back down to one character.
  const searchable = term.length >= 2;

  useEffect(() => {
    if (!searchable) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/v1/developers?q=${encodeURIComponent(term)}&limit=${SUGGESTIONS}`,
          { signal: controller.signal },
        );
        if (!response.ok) return;
        const body = (await response.json()) as { items?: Suggestion[] };
        setItems(body.items ?? []);
        setActive(-1);
        setOpen(true);
      } catch {
        // An aborted request is the normal case here, not a failure: the user
        // typed another character. Anything else leaves the last good list up
        // rather than blanking the panel under the cursor.
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchable, term]);

  // Clicking away closes the panel. Focus-out alone is not enough: a pointer
  // press on an option fires blur before click, which would close the list out
  // from under the tap.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const go = (item: Suggestion) => {
    setOpen(false);
    if (item.hasProfile) router.push(`/u/${item.login}`);
    else window.open(`https://github.com/${item.login}`, "_blank", "noreferrer");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open || items.length === 0) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      // States run -1 (nothing highlighted) through items.length - 1, so the
      // wrap is over items.length + 1 slots with the index shifted by one.
      const slots = items.length + 1;
      setActive((current) => ((current + 1 + step + slots) % slots) - 1);
      return;
    }
    if (event.key === "Enter" && active >= 0 && active < items.length) {
      // Only intercept Enter when an option is highlighted; otherwise the form
      // submits and the user lands on the full results page, which is right.
      event.preventDefault();
      go(items[active]);
    }
  };

  const expanded = open && searchable && items.length > 0;

  return (
    <div ref={box} className={`relative ${className}`}>
      <form action="/search" role="search" className="flex items-center">
        <label htmlFor={id} className="sr-only">
          Search developers
        </label>
        <input
          id={id}
          name="q"
          type="search"
          autoComplete="off"
          placeholder="Search developers"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${id}-option-${active}` : undefined}
          className="mono min-h-11 w-full border border-rule bg-transparent px-[var(--space-2xs)] py-1 text-caption text-ink placeholder:text-muted focus-visible:border-accent"
        />
        {/* Present for keyboard and no-JS submission; the visible affordance is
            the input itself, which already fills the available width. */}
        <button type="submit" className="sr-only">
          Search
        </button>
      </form>

      {expanded ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Developer suggestions"
          className="absolute left-0 right-0 top-[calc(100%+2px)] z-[var(--z-nav)] max-h-[60vh] overflow-y-auto border border-rule bg-paper"
        >
          {items.map((item, index) => (
            <li
              key={item.login}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={index === active}
              onPointerDown={(event) => {
                event.preventDefault();
                go(item);
              }}
              onMouseEnter={() => setActive(index)}
              className="flex cursor-pointer items-center gap-[var(--space-2xs)] border-b border-rule px-[var(--space-2xs)] py-2 last:border-b-0 aria-selected:bg-surface"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.avatarUrl} alt="" width={20} height={20} className="size-5 shrink-0" />
              <span className="mono min-w-0 flex-1 truncate text-caption">
                {item.name ? `${item.name} ` : ""}
                <span className="text-muted">@{item.login}</span>
              </span>
              <span className="mono shrink-0 text-caption tabular-nums text-muted">
                {item.total.toLocaleString("en-US")}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
