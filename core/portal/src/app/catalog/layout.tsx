// MCPForge — W0-J13: the Catalog layout, carrying the `@modal` parallel
// route slot (Next.js App Router intercepting-route pattern) so that
// navigating to a tool FROM the list renders as a drawer over the list
// (`@modal/(.)[toolId]/page.tsx`), while a direct load or refresh of
// `/catalog/[toolId]` renders the full page (`[toolId]/page.tsx`) — exactly
// the `done:` requirement: "rendered as a drawer from a list and a full page
// when opened directly, so it is linkable."
export default function CatalogLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  return (
    <div>
      {children}
      {modal}
    </div>
  );
}
