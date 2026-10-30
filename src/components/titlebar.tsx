import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  PanelLeft,
  Menu,
  Minus,
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";

interface TitleBarProps {
  onToggleSidebar?: () => void;
}

export function TitleBar({ onToggleSidebar }: TitleBarProps) {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    let unlisten: (() => void) | undefined;

    appWindow
      .isMaximized()
      .then(setIsMaximized)
      .catch(() => {});

    appWindow
      .onResized(async () => {
        try {
          const max = await appWindow.isMaximized();
          setIsMaximized(max);
        } catch {}
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});

    return () => {
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
        className="flex flex-row items-center w-27 h-full px-2 gap-1"
      >
        <button
          type="button"
          title="Show Menu"
          onClick={(e) => e.stopPropagation()}
          className="flex items-center justify-center w-7 h-7 rounded-md text-text-secondary hover:text-text-primary hover:bg-ghost-hover active:bg-elevated-surface transition-colors cursor-pointer"
        >
          <Menu className="w-4 h-4" />
        </button>

        <button
          type="button"
          id="sidebar-toggle-btn"
          title="Collapse Sidebar"
          onClick={(e) => e.stopPropagation()}
          className="flex items-center justify-center w-7 h-7 rounded-md text-text-secondary hover:text-text-primary hover:bg-ghost-hover active:bg-elevated-surface transition-colors cursor-pointer"
        >
          <PanelLeft className="w-4 h-4" />
        </button>
      </section>

      <section
        id="titlebar-center"
        data-tauri-drag-region
        className="flex flex-1 h-full items-center justify-center px-4"
      >

      </section>

      <section
        id="titlebar-right"
        className="flex flex-row items-center justify-end w-27 h-full"
      >
        <button
          type="button"
          id="window-minimize-btn"
          title="Minimize"
          onClick={handleMinimize}
          className="flex items-center justify-center w-9 h-full text-text-secondary hover:text-text-primary hover:bg-ghost-hover active:bg-selection transition-colors cursor-pointer"
        >
          <Minus className="w-4 h-4" />
        </button>

        <button
          type="button"
          id="window-maximize-btn"
          title={isMaximized ? "Restore" : "Maximize"}
          onClick={handleToggleMaximize}
          className="flex items-center justify-center w-9 h-full text-text-secondary hover:text-text-primary hover:bg-ghost-hover active:bg-selection transition-colors cursor-pointer"
        >
          {isMaximized ? (
            <Minimize2 className="w-3.5 h-3.5" />
          ) : (
            <Maximize2 className="w-3.5 h-3.5" />
          )}
        </button>

        <button
          type="button"
          id="window-close-btn"
          title="Close"
          onClick={handleClose}
          className="flex items-center justify-center w-9 h-full text-text-secondary hover:text-white hover:bg-danger active:bg-danger/80 transition-colors cursor-pointer"
      