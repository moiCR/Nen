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
import { Button } from "./button";

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
          tooltip="Collapse Sidebar"
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
        className="flex flex-1 h-full items-center justify-center px-4"
      >

      </section>

      <section
        id="titlebar-right"
        className="flex flex-row items-center justify-end w-27 h-full"
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