import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

export const Route = createFileRoute("/")({
  component: IndexComponent,
});

function IndexComponent() {
  const { data, isLoading } = useQuery({
    queryKey: ["greet", "moiCR"],
    queryFn: () => invoke<string>("greet", { name: "moiCR" }),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Tauri + TanStack + Tailwind</h1>
      <div className="p-4 rounded-lg bg-neutral-900 border border-neutral-800">
        <p className="text-sm text-neutral-400">Response from Rust backend:</p>
        <p className="text-lg font-mono text-emerald-400 mt-1">
          {isLoading ? "Loading from Rust..." : data}
        </p>
      </div>
    </div>
  );
}
