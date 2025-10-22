import { createFileRoute } from "@tanstack/react-router";
import { Sheet } from "@/pages/Sheet";

function SheetRouteComponent() {
  const search = Route.useSearch() as {
    url?: string;
    sort?: string;
    filters?: string;
    q?: string;
  };
  const navigate = Route.useNavigate();
  return (
    <Sheet
      initialUrl={search.url}
      initialSortParam={search.sort}
      initialFiltersParam={search.filters}
      initialQueryParam={search.q}
      onSearchChange={(partial) => {
        navigate({
          search: (prev) => ({
            ...prev,
            sort: partial.sort ?? undefined,
            filters: partial.filters ?? undefined,
            q: partial.q ?? undefined,
          }),
          replace: true,
        });
      }}
    />
  );
}

export const Route = createFileRoute("/")({
  component: SheetRouteComponent,
  validateSearch: (search: Record<string, unknown>) => {
    const safe = (v: unknown): string | undefined =>
      typeof v === "string" && v.length > 0 ? v : undefined;
    return {
      url: safe(search.url),
      sort: safe(search.sort),
      filters: safe(search.filters),
      q: safe(search.q),
    };
  },
});
