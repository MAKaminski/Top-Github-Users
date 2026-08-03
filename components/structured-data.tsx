/**
 * Renders a schema.org graph into the document.
 *
 * `<script type="application/ld+json">` is inert — browsers never execute it,
 * so `dangerouslySetInnerHTML` here is not the hazard the name implies. The
 * real hazard is a `<` inside a string value closing the tag early, which is
 * what the escaping below prevents. Every value originates in our own snapshot,
 * but a developer's GitHub bio is user-controlled text that reaches this file,
 * so the escaping is load-bearing rather than ceremonial.
 */
export function StructuredData({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");

  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />
  );
}
