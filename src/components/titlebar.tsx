import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Folder, Maximize2, Menu, Minimize2, Minus, PanelLeft, Plus, X } from "lucide-react";
import { Button } from "./button";
import { useContextMenu } from "./context-menu";
import { useTabs } from "../hooks/tabs-context";
import { getIconsBatch } from "../lib/ipc";
import type { IconRequest } from "../types/explorer";

interface TitleBarProps {
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}

export function TitleBar({
  isSidebarOpen = true,
  onToggleSidebar,
}: TitleBarProps) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [tabIcons, setTabIcons] = useState<Record<string, string>>({});
  const requestedTabPathsRef = useRef<Set<string>>(new Set());

  const { tabs, activeTabId, selectTab, closeTab, openTab } = useTabs();
  const { showContextMenu } = useContextMenu();

  useEffect(() => {
    const missing: IconRequest[] = [];
    for (const tab of tabs) {
      if (!tabIcons[tab.path] && !requestedTabPathsRef.current.has(tab.path)) {
        requestedTabPathsRef.current.add(tab.path);
        missing.push({ path: tab.path, extension: "", isDir: true });
      }
    }

    if (missing.length === 0) {
      return;
    }

    getIconsBatch(missing)
      .then((resolved) => {
        if (Object.keys(resolved).length > 0) {
          setTabIcons((prev) => ({ ...prev, ...resolved }));
        }
      })
      .catch(() => {});
  }, [tabs, tabIcons]);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    appWindow
      .isMaximized()
      .then((max) => {
        if (!cancelled) {
          setIsMaximized(max);
        }
      })
      .catch(() => {});

    appWindow
      .onResized(async () => {
        try {
          const max = await appWindow.isMaximized();
          if (!cancelled) {
            setIsMaximized(max);
          }
        } catch {}
      })
      .then((fn) => {
        if (cancelled) {
          fn();
          return;
        }
        unlisten = fn;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const handleMinimize = async () => {
    try {
      await getCurrentWindow().minimize();
    } catch (err) {
      console.error("Failed to minimize window:", err);
    }
  };

  const handleToggleMaximize = async () => {
    try {
      await getCurrentWindow().toggleMaximize();
      const max = await getCurrentWindow().isMaximized();
      setIsMaximized(max);
    } catch (err) {
      console.error("Failed to toggle maximize:", err);
    }
  };

  const handleClose = async () => {
    try {
      await getCurrentWindow().close();
    } catch (err) {
      console.error("Failed to close window:", err);
    }
  };

  return (
    <header
      id="app-titlebar"
      data-tauri-drag-region
      className="flex flex-row items-center justify-between w-full h-11 bg-background select-none shrink-0"
    >
      <section
        id="titlebar-left"
        data-tauri-drag-region
        className={`flex flex-row items-center h-full px-2.5 gap-1 shrink-0 transition-[width] duration-200 ease-[cubic-bezier(0.25,1,0.5,1)] ${
          isSidebarOpen ? "w-60" : "w-20"
        }`}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          tooltip="Show Menu"
          command="F10"
          onClick={(e) => e.stopPropagation()}
        >
          <Menu className="w-4 h-4" />
        </Button>

        <Button
          id="sidebar-toggle-btn"
          variant="ghost"
          size="icon-sm"
          tooltip="Toggle Sidebar"
          command="Ctrl+B"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSidebar?.();
          }}
        >
          <PanelLeft className="w-4 h-4" />
        </Button>
      </section>

      <section
        id="titlebar-center"
        data-tauri-drag-region
        className="flex flex-1 h-full items-end gap-1 pl-3 pr-2 overflow-hidden min-w-0"
      >
        <div
          data-tauri-drag-region
          className="flex items-end gap-1 flex-1 min-w-0 overflow-hidden h-full pt-2"
        >
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            const systemIcon = tabIcons[tab.path];

            return (
              <div
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                title={tab.path}
                onClick={() => selectTab(tab.id)}
                onContextMenu={(e) => {
                  showContextMenu(e, [
                    {
                      id: "duplicate-tab",
                      label: "Duplicate Tab",
                      icon: <Plus className="w-3.5 h-3.5" />,
                      onSelect: () => openTab(tab.path),
                    },
                    {
                      id: "copy-tab-path",
                      label: "Copy Path",
                      icon: <Copy className="w-3.5 h-3.5" />,
                      onSelect: () => {
                        void navigator.clipboard.writeText(tab.path);
                      },
                    },
                    {
                      type: "separator",
                      id: "sep-tab",
                    },
                    {
                      id: "close-tab",
                      label: "Close Tab",
                      icon: <X className="w-3.5 h-3.5" />,
                      shortcut: "Ctrl+W",
                      variant: "danger",
                      disabled: tabs.length <= 1,
                      onSelect: () => closeTab(tab.id),
                    },
                  ]);
                }}
                onAuxClick={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    closeTab(tab.id);
                  }
                }}
                className={`group flex items-center gap-2 h-8.5 px-3 rounded-t-lg text-xs font-medium transition-colors cursor-pointer flex-1 min-w-12 max-w-48 overflow-hidden ${
                  isActive
                    ? "bg-surface text-text-primary border-t border-x border-border/50"
                    : "bg-transparent text-text-secondary hover:bg-ghost-hover hover:text-text-primary mb-0.5 rounded-md"
                }`}
              >
                {systemIcon ? (
                  <img
                    src={systemIcon}
                    alt=""
                    className="w-4 h-4 shrink-0 object-contain pointer-events-none"
                  />
                ) : (
                  <Folder
                    className={`w-3.5 h-3.5 shrink-0 ${
                      isActive ? "text-accent" : "text-text-muted"
                    }`}
                  />
                )}
                <span className="truncate flex-1 min-w-0">{tab.title}</span>
                {tabs.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Close ${tab.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                    className={`p-0.5 rounded-sm hover:bg-elevated-surface text-text-muted hover:text-text-primary transition-opacity shrink-0 ${
                      isActive
                        ? "opacity-80 hover:opacity-100"
                        : "opacity-0 group-hover:opacity-100 focus:opacity-100"
                    }`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}

          <div className="pb-1 shrink-0">
            <Button
              variant="ghost"
              size="icon-sm"
              tooltip="New Tab"
              command="Ctrl+T"
              onClick={() => openTab()}
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </section>

      <section
        id="titlebar-right"
        className="flex flex-row items-center justify-end h-full shrink-0"
      >
        <Button
          id="window-minimize-btn"
          variant="window-control"
          size="window"
          tooltip="Minimize"
          onClick={handleMinimize}
        >
          <Minus className="w-4 h-4" />
        </Button>

        <Button
          id="window-maximize-btn"
          variant="window-control"
          size="window"
          tooltip={isMaximized ? "Restore" : "Maximize"}
          onClick={handleToggleMaximize}
        >
          {isMaximized ? (
            <Minimize2 className="w-3.5 h-3.5" />
          ) : (
            <Maximize2 className="w-3.5 h-3.5" />
          )}
        </Button>

        <Button
          id="window-close-btn"
          variant="window-close"
          size="window"
          tooltip="Close"
          onClick={handleClose}
        >
          <X className="w-4 h-4" />
        </Button>
      </section>
    </header>
  );
}
