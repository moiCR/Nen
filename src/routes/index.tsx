import { createFileRoute } from "@tanstack/react-router";
import { ExplorerView } from "./explorer/explorer";

export const Route = createFileRoute("/")({
  component: ExplorerView,
});
