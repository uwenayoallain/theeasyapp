import { createFileRoute } from "@tanstack/react-router";
import { Sheet } from "@/pages/Sheet";

function MainRouteComponent() {
  const search = Route.useSearch() as {
    url?: string;
    sort?: string;
    q?: string;
  };
  const navigate = Route.useNavigate();

  return (
    <Sheet
      initialUrl={search.url}
      initialSortParam={search.sort}
      initialQueryParam={search.q}
      autoLoadDefault={!search.url} // Auto-load sample if no URL specified
      onSearchChange={(partial) => {
        navigate({
          search: (prev) => ({
            ...prev,
            sort: partial.sort ?? undefined,
            q: partial.q ?? undefined,
          }),
          replace: true,
        });
      }}
    />
  );
}

export const Route = createFileRoute("/")({
  component: MainRouteComponent,
  validateSearch: (search: Record<string, unknown>) => {
    const safe = (v: unknown): string | undefined =>
      typeof v === "string" && v.length > 0 ? v : undefined;
    return {
      url: safe(search.url),
      sort: safe(search.sort),
      q: safe(search.q),
    };
  },
});
