import { useState } from "react";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { TitleBar } from "../components/titlebar";
import SideBar from "../components/sidebar";

interface MyRouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  component: RootComponent,
});

function RootComponent() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  return (
    <div className="h-screen w-screen bg-background text-text-primary flex flex-col overflow-hidden select-none">
      <TitleBar onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)} />

      <div className="flex-1 flex flex-row overflow-hidden">
        <AnimatePresence initial={false}>
          {isSidebarOpen && (
            <motion.div
              key="sidebar-panel"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: "auto", opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.25, 1, 0.5, 1] }}
              className="overflow-hidden shrink-0 border-r border-border/40 h-full"
            >
              <div className="w-60 h-full">
                <SideBar />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <main className="flex-1 overflow-auto bg-surface">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
