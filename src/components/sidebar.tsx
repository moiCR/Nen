import type { MouseEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, Download, FileText, Film, Folder, FolderOpen, HardDrive, Home, Image, Monitor, Plus } from "lucide-react";
import { formatBytes, getDrives, getSystemPlaces, normalizeComparePath } from "../lib/ipc";
import { useContextMenu } from "./context-menu";
import { useTabs } from "../hooks/tabs-context";

function renderPlaceIcon(iconName: string) {
  const iconClass = "w-4 h-4 shrink-0";
  switch (iconName) {
    case "home":
      return <Home className={iconClass} />;
    case "monitor":
      return <Monitor className={iconClass} />;
    case "download":
      return <Download className={iconClass} />;
    case "file-text":
      return <FileText className={iconClass} />;
    case "image":
      return <Image className={iconClass} />;
    case "film":
      return <Film className={iconClass} />;
    default:
      return <Folder className={iconClass} />;
  }
}

export default function SideBar() {
  const { activeTab, navigateTo, openTab } = useTabs();
  const { showContextMenu } = useContextMenu();

  const { data: places = [] } = useQuery({
    queryKey: ["system-places"],
    queryFn: getSystemPlaces,
    staleTime: Infinity,
  });

  const { data: drives = [] } = useQuery({
    queryKey: ["drives"],
    queryFn: () => getDrives(false),
    staleTime: 15_000,
  });

  const activeNormalized = normalizeComparePath(activeTab.path);

  const handleItemClick = (e: MouseEvent, path: string) => {
    if (e.ctrlKey || e.metaKey) {
      openTab(path);
      return;
    }
    navigateTo(path);
  };

  const handleItemAuxClick = (e: MouseEvent, path: string) => {
    if (e.button === 1) {
      e.preventDefault();
      openTab(path);
    }
  };

  const handleItemContextMenu = (e: MouseEvent, path: string) => {
    showContextMenu(e, [
      {
        id: "open-place",
        label: "Open",
        icon: <FolderOpen className="w-3.5 h-3.5" />,
        onSelect: () => navigateTo(path),
      },
      {
        id: "open-place-tab",
        label: "Open in New Tab",
        icon: <Plus className="w-3.5 h-3.5" />,
        onSelect: () => openTab(path),
      },
      {
        type: "separator",
        id: "sep-place",
      },
      {
        id: "copy-place-path",
        label: "Copy Path",
        icon: <Copy className="w-3.5 h-3.5" />,
        onSelect: () => {
          void navigator.clipboard.writeText(path);
        },
      },
    ]);
  };

  return (
    <aside
      id="app-sidebar"
      className="flex flex-col justify-between w-full h-full bg-background px-2 py-3 select-none shrink-0 overflow-y-auto"
    >
      <div className="space-y-5">
        <section>
          <h2 className="px-2.5 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            Places
          </h2>
          <div className="space-y-0.5">
            {places.map((place) => {
              const isSelected =
                normalizeComparePath(place.path) === activeNormalized;
              return (
                <button
                  key={place.id}
                  type="button"
                  title={place.path}
                  onClick={(e) => handleItemClick(e, place.path)}
                  onAuxClick={(e) => handleItemAuxClick(e, place.path)}
                  onContextMenu={(e) => handleItemContextMenu(e, place.path)}
                  className={`flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer text-left ${
                    isSelected
                      ? "bg-surface text-text-primary"
                      : "text-text-secondary hover:bg-ghost-hover hover:text-text-primary"
                  }`}
                >
                  <span
                    className={
                      isSelected ? "text-text-primary" : "text-text-muted"
                    }
                  >
                    {renderPlaceIcon(place.icon)}
                  </span>
                  <span className="truncate">{place.name}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <h2 className="px-2.5 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            Drives
          </h2>
          <div className="space-y-1">
            {drives.map((drive) => {
              const isSelected =
                normalizeComparePath(drive.mountPoint) === activeNormalized;
              const usedSpace = Math.max(
                0,
                drive.totalSpace - drive.availableSpace
              );
              const usedPercent =
                drive.totalSpace > 0
                  ? Math.min(100, Math.round((usedSpace / drive.totalSpace) * 100))
                  : 0;

              return (
                <button
                  key={drive.mountPoint}
                  type="button"
                  title={`${drive.name} (${drive.mountPoint})`}
                  onClick={(e) => handleItemClick(e, drive.mountPoint)}
                  onAuxClick={(e) => handleItemAuxClick(e, drive.mountPoint)}
                  onContextMenu={(e) =>
                    handleItemContextMenu(e, drive.mountPoint)
                  }
                  className={`flex flex-col gap-1.5 w-full px-2.5 py-2 rounded-md text-xs transition-colors cursor-pointer text-left ${
                    isSelected
                      ? "bg-selection text-text-primary"
                      : "text-text-secondary hover:bg-ghost-hover hover:text-text-primary"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 w-full">
                    <div className="flex items-center gap-2 min-w-0">
                      <HardDrive
                        className={`w-4 h-4 shrink-0 ${
                          isSelected ? "text-accent-hover" : "text-text-muted"
                        }`}
                      />
                      <span className="font-medium truncate">
                        {drive.name} ({drive.mountPoint.replace(/\\$/, "")})
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-text-muted shrink-0">
                      {formatBytes(drive.availableSpace)} free
                    </span>
                  </div>

                  <div className="w-full h-1 bg-surface rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        usedPercent > 90 ? "bg-danger" : "bg-accent"
                      }`}
                      style={{ width: `${usedPercent}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </aside>
  );
}
