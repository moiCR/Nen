import { useEffect, useState } from "react";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { TitleBar } from "../components/titlebar";
import SideBar from "../components/sidebar";
import { ContextMenuProvider } from "../components/context-menu";
import { useKeybinds } from "../hooks/use-keybinds";
import { TabsProvider } from "../hooks/tabs-context";

interface MyRouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  component: RootComponent,
});

function RootComponent() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  useEffect(() => {
    const handleGlobalContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    window.addEventListener("contextmenu", handleGlobalContextMenu);
    return () => {
      window.removeEventListener("contextmenu", handleGlobalContextMenu);
    };
  }, []);

  useKeybinds([
    {
      key: "b",
      ctrl: true,
      handler: () => setIsSidebarOpen((prev) => !prev),
    },
  ]);

  return (
    <TabsProvider>
      <ContextMenuProvider>
        <div className="h-screen w-screen bg-background text-text-primary flex flex-col overflow-hidden select-none">
          <TitleBar
            isSidebarOpen={isSidebarOpen}
            onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
          />

          <div className="flex-1 flex flex-row overflow-hidden bg-background">
            <AnimatePresence initial={false}>
              {isSidebarOpen && (
                <motion.div
                  key="sidebar-panel"
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: 240, opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: [0.25, 1, 0.5, 1] }}
                  className="overflow-hidden shrink-0 h-full bg-background"
                >
                  <div className="w-60 h-full">
                    <SideBar />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <main
              className={`flex-1 flex flex-col overflow-hidden bg-surface border-border/50 ${
                isSidebarOpen ? "rounded-tl-xl border-l" : ""
              }`}
            >
              <Outlet />
            </main>
          </div>
        </div>
      </ContextMenuProvider>
    </TabsProvider>
  );
}
