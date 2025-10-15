import { createFileRoute } from "@tanstack/react-router";
import { Sheet } from "@/pages/Sheet";

export const Route = createFileRoute("/")({
  component: () => {
    const search = Route.useSearch() as { url?: string };
    return <Sheet initialUrl={search.url} />;
  },
  validateSearch: (search: Record<string, unknown>) => {
    return {
      url: (search.url as string) || undefined,
    };
  },
});
