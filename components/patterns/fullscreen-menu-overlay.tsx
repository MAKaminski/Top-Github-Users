"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { NAV_LINKS } from "@/components/nav-links";
import { SearchBox } from "@/components/search-box";
import { useReducedMotion } from "./use-reduced-motion";

/**
 * fullscreen-menu-overlay — the menu takes the whole viewport, with oversized
 * links revealed in sequence.
 *
 * Corpus obligations honoured here:
 * - Native <dialog> + showModal(). It gives the focus trap, the inert
 *   background and Escape-to-close for free; hand-rolled versions get at least
 *   one of those wrong.
 * - Focus returns to the trigger on close and aria-expanded stays in sync.
 * - Background scroll is locked while open and the exact position restored.
 * - The dialog stays mounted, so the first open pays no render cost.
 * - Links are reachable in DOM order; nothing is visually reordered.
 * - opacity/transform animate on the links, never `display` on the dialog.
 */
export function FullscreenMenuOverlay() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const scrollY = useRef(0);
  const [open, setOpen] = useState(false);
  const reduced = useReducedMotion();

  const close = () => {
    dialogRef.current?.close();
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const onClose = () => {
      setOpen(false);
      document.body.style.removeProperty("position");
      document.body.style.removeProperty("top");
      document.body.style.removeProperty("width");
      window.scrollTo(0, scrollY.current);
      triggerRef.current?.focus();
    };

    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, []);

  const openMenu = () => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    scrollY.current = window.scrollY;
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY.current}px`;
    document.body.style.width = "100%";
    dialog.showModal();
    setOpen(true);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openMenu}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="mono flex min-h-11 min-w-11 items-center justify-center gap-2 text-caption uppercase tracking-[var(--tracking-caption)] lg:hidden"
      >
        Menu
        <span aria-hidden="true" className="flex flex-col gap-[3px]">
          <span className="block h-px w-4 bg-current" />
          <span className="block h-px w-4 bg-current" />
        </span>
      </button>

      <dialog
        ref={dialogRef}
        className="m-0 h-full max-h-none w-full max-w-none bg-paper p-0 text-ink backdrop:bg-[var(--veil)]"
      >
        <div className="shell flex h-full flex-col">
          <div className="flex h-[var(--nav-h)] items-center justify-between">
            <span className="mono text-caption uppercase tracking-[var(--tracking-caption)]">
              Commitgraph
            </span>
            <button
              type="button"
              onClick={close}
              className="mono min-h-11 min-w-11 text-caption uppercase tracking-[var(--tracking-caption)]"
            >
              Close
            </button>
          </div>

          {/* The narrow-viewport home for search: the nav bar has no room for
              it below xl, and this dialog is the only navigation surface there. */}
          <div className="mt-[var(--space-sm)]">
            <SearchBox />
          </div>

          <ul className="flex flex-1 flex-col justify-center gap-[var(--space-xs)]">
            {NAV_LINKS.map((link, index) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={close}
                  className="block py-2 text-h1 leading-[1.05] tracking-[var(--tracking-display)]"
                  style={{
                    opacity: open || reduced ? 1 : 0,
                    transform: open || reduced ? "none" : "translate3d(0, 1rem, 0)",
                    transition: reduced
                      ? "none"
                      : `opacity var(--dur-base) var(--ease-out-expo) ${0.05 + index * 0.05}s,` +
                        `transform var(--dur-base) var(--ease-out-expo) ${0.05 + index * 0.05}s`,
                  }}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </dialog>
    </>
  );
}
