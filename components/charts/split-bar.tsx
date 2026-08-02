import { abbreviate, percent } from "@/lib/format";

/**
 * Public vs private contribution split.
 *
 * This is the one breakdown the bootstrap dataset genuinely carries for every
 * user, and it is the most interesting: the ratio says whether someone works in
 * the open or behind a company firewall.
 */
export function SplitBar({
  publicCount,
  privateCount,
  height = 10,
}: {
  publicCount: number;
  privateCount: number;
  height?: number;
}) {
  const total = publicCount + privateCount;
  const publicShare = total > 0 ? publicCount / total : 0;

  return (
    <figure className="m-0 flex flex-col gap-[var(--space-2xs)]">
      <div
        aria-hidden="true"
        className="flex w-full overflow-hidden"
        style={{ height }}
      >
        <span
          className="block h-full"
          style={{ width: `${publicShare * 100}%`, background: "var(--level-4)" }}
        />
        <span
          className="block h-full flex-1"
          style={{ background: "var(--accent)" }}
        />
      </div>
      <figcaption className="flex flex-wrap justify-between gap-x-4 text-caption text-muted">
        <span>
          <span aria-hidden="true" className="mr-1 inline-block size-2 align-middle" style={{ background: "var(--level-4)" }} />
          Public {abbreviate(publicCount)} ({percent(publicShare)})
        </span>
        <span>
          <span aria-hidden="true" className="mr-1 inline-block size-2 align-middle" style={{ background: "var(--accent)" }} />
          Private {abbreviate(privateCount)} ({percent(1 - publicShare)})
        </span>
      </figcaption>
    </figure>
  );
}
