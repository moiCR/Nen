import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent,} from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { listen } from "@tauri-apps/api/event";

import { AlertCircle, Copy, Eye, EyeOff, File, FileArchive, FileCode, FileImage, FilePlus, FileSpreadsheet, FileText, Film, Folder, FolderPlus, Music, Plus, RefreshCw } from "lucide-react";
import { useContextMenu, type ContextMenuEntry } from "../../components/context-menu";
import { ExplorerToolbar } from "../../components/explorer-toolbar";
import { useTabs } from "../../hooks/tabs-context";
import { useKeybinds } from "../../hooks/use-keybinds";
import { cancelSearch, createDir, createEmptyFile, deleteToTrash, expandShellSubmenu, formatBytes, formatModifiedDate, formatRelativeParent, getIconsBatch, getShellContextMenu, invokeShellContextItem, listDirectory, normalizeComparePath, openItem, renameEntry, startSearch, unwatchDirectory, watchDirectory } from "../../lib/ipc";
import type { FileEntry, FsChangedPayload, IconRequest, SearchProgressPayload, ShellMenuItem } from "../../types/explorer";

export const Route = createFileRoute("/explorer/explorer")({
  component: ExplorerView,
});

const ROW_HEIGHT = 32;

function renderFallbackFileIcon(entry: FileEntry) {
  if (entry.isDir) {
    return <Folder className="w-4 h-4 shrink-0 text-accent fill-accent/20" />;
  }

  const ext = entry.extension.toLowerCase();
  const iconClass = "w-4 h-4 shrink-0 text-text-secondary";

  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp"].includes(ext)) {
    return <FileImage className="w-4 h-4 shrink-0 text-info" />;
  }
  if (["mp4", "mkv", "mov", "avi", "webm"].includes(ext)) {
    return <Film className="w-4 h-4 shrink-0 text-warning" />;
  }
  if (["mp3", "wav", "flac", "ogg", "m4a"].includes(ext)) {
    return <Music className="w-4 h-4 shrink-0 text-success" />;
  }
  if (["zip", "rar", "7z", "tar", "gz", "bz2"].includes(ext)) {
    return <FileArchive className="w-4 h-4 shrink-0 text-warning" />;
  }
  if (["rs", "ts", "tsx", "js", "jsx", "json", "toml", "py", "go", "c", "cpp", "cs", "html", "css"].includes(ext)) {
    return <FileCode className="w-4 h-4 shrink-0 text-accent-hover" />;
  }
  
  if (["csv", "xls", "xlsx"].includes(ext)) {
    return <FileSpreadsheet className="w-4 h-4 shrink-0 text-success" />;
  }
  if (["md", "txt", "pdf", "doc", "docx", "log"].includes(ext)) {
    return <FileText className={iconClass} />;
  }

  return <File className={iconClass} />;
}

function isEditableElementFocused(): boolean {
  const active = document.activeElement;
  if (!active) {
    return false;
  }
  const tag = active.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    (active as HTMLElement).isContentEditable
  );
}

export function ExplorerView() {
  const queryClient = useQueryClient();
  const { activeTab, showHidden, setShowHidden, navigateTo, openTab, goUp } =
    useTabs();
  const { showContextMenu } = useContextMenu();

  const [filterQuery, setFilterQuery] = useState("");
  const [isRecursiveSearch, setIsRecursiveSearch] = useState(true);
  const [searchResults, setSearchResults] = useState<FileEntry[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [iconMap, setIconMap] = useState<Record<string, string>>({});

  const parentRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const activeSearchIdRef = useRef<number>(0);
  const seenSearchPathsRef = useRef<Set<string>>(new Set());
  const requestedIconPathsRef = useRef<Set<string>>(new Set());

  const {
    data: snapshot,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["directory", activeTab.path, showHidden],
    queryFn: () => listDirectory(activeTab.path, showHidden),
    staleTime: 10_000,
  });

  useEffect(() => {
    setFilterQuery("");
    setSearchResults([]);
    setIsSearching(false);
    setSelectedIndex(0);
    setRenamingPath(null);
    setActionError(null);
    activeSearchIdRef.current = 0;
    seenSearchPathsRef.current.clear();
    cancelSearch().catch(() => {});
  }, [activeTab.path]);

  useEffect(() => {
    const currentPath = activeTab.path;
    watchDirectory(currentPath).catch(() => {});

    return () => {
      unwatchDirectory(currentPath).catch(() => {});
    };
  }, [activeTab.path]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    listen<FsChangedPayload>("fs-changed", (event) => {
      if (cancelled) {
        return;
      }
      const changedNorm = normalizeComparePath(event.payload.directory);
      const currentNorm = normalizeComparePath(activeTab.path);
      if (changedNorm === currentNorm) {
        queryClient.invalidateQueries({
          queryKey: ["directory", activeTab.path],
        });
      }
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
  }, [activeTab.path, queryClient]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    listen<SearchProgressPayload>("search-progress", (event) => {
      if (cancelled) {
        return;
      }
      const payload = event.payload;
      if (
        activeSearchIdRef.current === 0 ||
        payload.searchId < activeSearchIdRef.current
      ) {
        return;
      }
      if (payload.searchId > activeSearchIdRef.current) {
        activeSearchIdRef.current = payload.searchId;
      }

      if (payload.entries.length > 0) {
        const uniqueIncoming: FileEntry[] = [];
        for (const item of payload.entries) {
          const normKey = item.path.toLowerCase();
          if (seenSearchPathsRef.current.has(normKey)) {
            continue;
          }
          seenSearchPathsRef.current.add(normKey);
          uniqueIncoming.push(item);
        }

        if (uniqueIncoming.length > 0) {
          setSearchResults((prev) => [...prev, ...uniqueIncoming]);
        }
      }

      if (payload.done) {
        setIsSearching(false);
      }
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

  useEffect(() => {
    const trimmed = filterQuery.trim();
    if (!isRecursiveSearch || !trimmed) {
      activeSearchIdRef.current = 0;
      seenSearchPathsRef.current.clear();
      setIsSearching(false);
      setSearchResults([]);
      cancelSearch().catch(() => {});
      return;
    }

    const timer = setTimeout(() => {
      seenSearchPathsRef.current.clear();
      setSearchResults([]);
      setIsSearching(true);
      activeSearchIdRef.current = -1;
      startSearch(activeTab.path, trimmed, showHidden, 1000)
        .then((searchId) => {
          activeSearchIdRef.current = searchId;
        })
        .catch(() => {
          activeSearchIdRef.current = 0;
          setIsSearching(false);
        });
    }, 150);

    return () => {
      clearTimeout(timer);
    };
  }, [activeTab.path, filterQuery, isRecursiveSearch, showHidden]);

  useEffect(() => {
    if (!renamingPath || !renameInputRef.current) {
      return;
    }
    const input = renameInputRef.current;
    input.focus();
    const currentVal = input.value;
    const dotIndex = currentVal.lastIndexOf(".");
    if (dotIndex > 0) {
      input.setSelectionRange(0, dotIndex);
      return;
    }
    input.select();
  }, [renamingPath]);

  const activeRecursiveMode =
    isRecursiveSearch && filterQuery.trim().length > 0;

  const displayedEntries = useMemo(() => {
    if (activeRecursiveMode) {
      return searchResults;
    }
    const entries = snapshot?.entries ?? [];
    const trimmed = filterQuery.trim().toLowerCase();
    if (!trimmed) {
      return entries;
    }
    return entries.filter((entry) =>
      entry.name.toLowerCase().includes(trimmed)
    );
  }, [activeRecursiveMode, filterQuery, searchResults, snapshot?.entries]);

  useEffect(() => {
    const missing: IconRequest[] = [];
    for (const entry of displayedEntries) {
      if (
        !entry.icon &&
        !iconMap[entry.path] &&
        !requestedIconPathsRef.current.has(entry.path)
      ) {
        requestedIconPathsRef.current.add(entry.path);
        missing.push({
          path: entry.path,
          extension: entry.extension,
          isDir: entry.isDir,
        });
        if (missing.length >= 120) {
          break;
        }
      }
    }

    if (missing.length === 0) {
      return;
    }

    getIconsBatch(missing)
      .then((resolved) => {
        if (Object.keys(resolved).length > 0) {
          setIconMap((prev) => ({ ...prev, ...resolved }));
        }
      })
      .catch(() => {});
  }, [displayedEntries, iconMap]);

  useEffect(() => {
    if (
      selectedIndex >= displayedEntries.length &&
      displayedEntries.length > 0
    ) {
      setSelectedIndex(displayedEntries.length - 1);
    }
  }, [displayedEntries.length, selectedIndex]);

  const rowVirtualizer = useVirtualizer({
    count: displayedEntries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 15,
  });

  const scrollToIndex = useCallback(
    (index: number) => {
      rowVirtualizer.scrollToIndex(index, { align: "auto" });
    },
    [rowVirtualizer]
  );

  const handleOpenEntry = useCallback(
    async (entry: FileEntry) => {
      setActionError(null);
      if (entry.isDir) {
        navigateTo(entry.path);
        return;
      }
      try {
        await openItem(entry.path);
      } catch (err) {
        setActionError(String(err));
      }
    },
    [navigateTo]
  );

  const handleCreateFolder = useCallback(async () => {
    setActionError(null);
    const base = activeTab.path.replace(/[\\/]+$/, "");
    const existingNames = new Set(
      (snapshot?.entries ?? []).map((e) => e.name.toLowerCase())
    );
    let candidate = "New folder";
    let counter = 2;
    while (existingNames.has(candidate.toLowerCase())) {
      candidate = `New folder (${counter})`;
      counter += 1;
    }

    const fullPath = `${base}\\${candidate}`;
    try {
      const createdPath = await createDir(fullPath);
      await refetch();
      setRenamingPath(createdPath);
      setRenameValue(candidate);
    } catch (err) {
      setActionError(String(err));
    }
  }, [activeTab.path, refetch, snapshot?.entries]);

  const handleCreateFile = useCallback(async () => {
    setActionError(null);
    const base = activeTab.path.replace(/[\\/]+$/, "");
    const existingNames = new Set(
      (snapshot?.entries ?? []).map((e) => e.name.toLowerCase())
    );
    let candidate = "New file.txt";
    let counter = 2;
    while (existingNames.has(candidate.toLowerCase())) {
      candidate = `New file (${counter}).txt`;
      counter += 1;
    }

    const fullPath = `${base}\\${candidate}`;
    try {
      const createdPath = await createEmptyFile(fullPath);
      await refetch();
      setRenamingPath(createdPath);
      setRenameValue(candidate);
    } catch (err) {
      setActionError(String(err));
    }
  }, [activeTab.path, refetch, snapshot?.entries]);

  const handleDeleteEntry = useCallback(
    async (targetPath: string) => {
      setActionError(null);
      try {
        await deleteToTrash([targetPath]);
        await refetch();
      } catch (err) {
        setActionError(String(err));
      }
    },
    [refetch]
  );

  const handleDeleteSelected = useCallback(async () => {
    const selected = displayedEntries[selectedIndex];
    if (!selected) {
      return;
    }
    await handleDeleteEntry(selected.path);
  }, [displayedEntries, handleDeleteEntry, selectedIndex]);

  const handleStartRename = useCallback(() => {
    const selected = displayedEntries[selectedIndex];
    if (!selected) {
      return;
    }
    setRenamingPath(selected.path);
    setRenameValue(selected.name);
  }, [displayedEntries, selectedIndex]);

  const handleCommitRename = async (e: FormEvent, entry: FileEntry) => {
    e.preventDefault();
    const nextName = renameValue.trim();
    setRenamingPath(null);
    if (!nextName || nextName === entry.name) {
      return;
    }
    const parent = entry.path.replace(/[\\/][^\\/]+$/, "");
    const destination = `${parent}\\${nextName}`;
    try {
      await renameEntry(entry.path, destination);
      await refetch();
    } catch (err) {
      setActionError(String(err));
    }
  };

  const mapShellItemsToEntries = useCallback(
    (
      targetPath: string,
      shellItems: ShellMenuItem[],
      parentMenuPath: number[] = [],
      entry?: FileEntry
    ): ContextMenuEntry[] => {
      return shellItems.map((item): ContextMenuEntry => {
        if (item.isSeparator) {
          return { type: "separator", id: item.id };
        }

        const lowerLabel = item.label.toLowerCase();
        const isDelete = lowerLabel === "delete" || lowerLabel === "eliminar";
        const isRename = lowerLabel === "rename" || lowerLabel === "cambiar nombre";
        const isOpen = lowerLabel === "open" || lowerLabel === "abrir";

        const currentMenuPath = [...parentMenuPath, item.menuIndex];
        const subEntries =
          item.children.length > 0
            ? mapShellItemsToEntries(targetPath, item.children, currentMenuPath, entry)
            : undefined;

        const lazyLoader =
          item.hasSubmenu && item.children.length === 0
            ? async () => {
                const subShellItems = await expandShellSubmenu(currentMenuPath);
                return mapShellItemsToEntries(targetPath, subShellItems, currentMenuPath, entry);
              }
            : undefined;

        return {
          id: item.id,
          label: item.label,
          iconUrl: item.icon,
          disabled: item.disabled,
          variant: isDelete ? "danger" : "default",
          children: subEntries,
          loadChildren: lazyLoader,
          onSelect: () => {
            if (entry && isOpen && entry.isDir && item.cmdId !== null) {
              navigateTo(entry.path);
              return;
            }
            if (entry && isRename) {
              setRenamingPath(entry.path);
              setRenameValue(entry.name);
              return;
            }
            void invokeShellContextItem(targetPath, item.cmdId, item.customAction).then(() => {
              void refetch();
            });
          },
        };
      });
    },
    [navigateTo, refetch]
  );

  const handleEntryContextMenu = useCallback(
    (e: ReactMouseEvent, entry: FileEntry, index: number) => {
      e.preventDefault();
      e.stopPropagation();
      setSelectedIndex(index);

      const clientX = e.clientX;
      const clientY = e.clientY;
      const syntheticEvent = {
        clientX,
        clientY,
        preventDefault: () => {},
        stopPropagation: () => {},
      } as unknown as MouseEvent;

      void getShellContextMenu(entry.path, false).then((shellItems) => {
        const dynamicEntries = mapShellItemsToEntries(entry.path, shellItems, [], entry);
        const topItems: ContextMenuEntry[] = [];

        if (entry.isDir) {
          topItems.push(
            {
              id: "nen-open-new-tab",
              label: "Open in New Tab",
              icon: <Plus className="w-3.5 h-3.5" />,
              onSelect: () => openTab(entry.path),
            },
            {
              type: "separator",
              id: "sep-nen-top",
            }
          );
        }

        showContextMenu(syntheticEvent, [...topItems, ...dynamicEntries]);
      });
    },
    [mapShellItemsToEntries, openTab, showContextMenu]
  );

  const handleBackgroundContextMenu = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const clientX = e.clientX;
      const clientY = e.clientY;
      const syntheticEvent = {
        clientX,
        clientY,
        preventDefault: () => {},
        stopPropagation: () => {},
      } as unknown as MouseEvent;

      void getShellContextMenu(activeTab.path, true).then((shellItems) => {
        const dynamicBgEntries = mapShellItemsToEntries(activeTab.path, shellItems);
        const items: ContextMenuEntry[] = [
          ...dynamicBgEntries,
          ...(dynamicBgEntries.length > 0
            ? [{ type: "separator" as const, id: "sep-bg-shell" }]
            : []),
          {
            id: "bg-new-folder",
            label: "New Folder",
            icon: <FolderPlus className="w-3.5 h-3.5" />,
            shortcut: "Ctrl+Shift+N",
            onSelect: () => {
              void handleCreateFolder();
            },
          },
          {
            id: "bg-new-file",
            label: "New Text File",
            icon: <FilePlus className="w-3.5 h-3.5" />,
            onSelect: () => {
              void handleCreateFile();
            },
          },
          {
            type: "separator",
            id: "sep-bg-1",
          },
          {
            id: "bg-refresh",
            label: "Refresh",
            icon: <RefreshCw className="w-3.5 h-3.5" />,
            shortcut: "Ctrl+R",
            onSelect: () => {
              void refetch();
            },
          },
          {
            id: "bg-toggle-hidden",
            label: showHidden ? "Hide Hidden Files" : "Show Hidden Files",
            icon: showHidden ? (
              <EyeOff className="w-3.5 h-3.5" />
            ) : (
              <Eye className="w-3.5 h-3.5" />
            ),
            shortcut: "Ctrl+H",
            onSelect: () => setShowHidden((prev) => !prev),
          },
          {
            type: "separator",
            id: "sep-bg-2",
          },
          {
            id: "bg-copy-folder-path",
            label: "Copy Folder Path",
            icon: <Copy className="w-3.5 h-3.5" />,
            onSelect: () => {
              void navigator.clipboard.writeText(activeTab.path);
            },
          },
        ];

        showContextMenu(syntheticEvent, items);
      });
    },
    [
      activeTab.path,
      handleCreateFile,
      handleCreateFolder,
      mapShellItemsToEntries,
      refetch,
      setShowHidden,
      showContextMenu,
      showHidden,
    ]
  );

  useKeybinds([
    {
      key: "arrowdown",
      preventDefault: false,
      handler: (e) => {
        if (isEditableElementFocused() || displayedEntries.length === 0) {
          return;
        }
        e.preventDefault();
        const next = Math.min(displayedEntries.length - 1, selectedIndex + 1);
        setSelectedIndex(next);
        scrollToIndex(next);
      },
    },
    {
      key: "arrowup",
      preventDefault: false,
      handler: (e) => {
        if (isEditableElementFocused() || displayedEntries.length === 0) {
          return;
        }
        e.preventDefault();
        const prev = Math.max(0, selectedIndex - 1);
        setSelectedIndex(prev);
        scrollToIndex(prev);
      },
    },
    {
      key: "home",
      preventDefault: false,
      handler: (e) => {
        if (isEditableElementFocused() || displayedEntries.length === 0) {
          return;
        }
        e.preventDefault();
        setSelectedIndex(0);
        scrollToIndex(0);
      },
    },
    {
      key: "end",
      preventDefault: false,
      handler: (e) => {
        if (isEditableElementFocused() || displayedEntries.length === 0) {
          return;
        }
        e.preventDefault();
        const last = displayedEntries.length - 1;
        setSelectedIndex(last);
        scrollToIndex(last);
      },
    },
    {
      key: "enter",
      preventDefault: false,
      handler: (e) => {
        if (isEditableElementFocused()) {
          return;
        }
        const selected = displayedEntries[selectedIndex];
        if (selected) {
          e.preventDefault();
          void handleOpenEntry(selected);
        }
      },
    },
    {
      key: "backspace",
      preventDefault: false,
      handler: (e) => {
        if (isEditableElementFocused()) {
          return;
        }
        e.preventDefault();
        goUp();
      },
    },
    {
      key: "delete",
      preventDefault: false,
      handler: (e) => {
        if (isEditableElementFocused()) {
          return;
        }
        e.preventDefault();
        void handleDeleteSelected();
      },
    },
    {
      key: "f2",
      preventDefault: false,
      handler: (e) => {
        if (isEditableElementFocused()) {
          return;
        }
        e.preventDefault();
        handleStartRename();
      },
    },
    {
      key: "n",
      ctrl: true,
      shift: true,
      handler: () => {
        void handleCreateFolder();
      },
    },
  ]);

  const selectedEntry = displayedEntries[selectedIndex] ?? null;

  const folderCount = useMemo(
    () => displayedEntries.filter((e) => e.isDir).length,
    [displayedEntries]
  );
  const fileCount = displayedEntries.length - folderCount;

  const listKey = activeRecursiveMode
    ? `search-${activeTab.path}-${filterQuery.trim()}`
    : `dir-${activeTab.path}`;

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-surface">
      <ExplorerToolbar
        filterQuery={filterQuery}
        isRecursiveSearch={isRecursiveSearch}
        isSearching={isSearching}
        onFilterChange={(val) => {
          setFilterQuery(val);
          setSelectedIndex(0);
        }}
        onToggleRecursiveSearch={() => setIsRecursiveSearch((prev) => !prev)}
        onRefresh={() => {
          void refetch();
        }}
        onCreateFolder={() => {
          void handleCreateFolder();
        }}
      />

      {actionError && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-danger/15 border-b border-danger/30 text-danger text-xs">
          <div className="flex items-center gap-2 truncate">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{actionError}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-xs underline ml-2 shrink-0 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="grid grid-cols-[1fr_150px_90px_100px] items-center px-3 h-7 bg-surface border-b border-border/40 text-[11px] font-medium text-text-muted shrink-0">
        <span>Name</span>
        <span>Date Modified</span>
        <span>Type</span>
        <span className="text-right pr-1">Size</span>
      </div>

      <div
        ref={parentRef}
        onContextMenu={handleBackgroundContextMenu}
        className="flex-1 overflow-y-auto overflow-x-hidden outline-none bg-surface"
      >
        {isLoading && !activeRecursiveMode ? (
          <div className="flex items-center justify-center h-full text-xs text-text-muted">
            Scanning directory...
          </div>
        ) : error && !activeRecursiveMode ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 px-4 text-center">
            <AlertCircle className="w-6 h-6 text-danger" />
            <p className="text-xs text-text-secondary max-w-md">
              {String(error)}
            </p>
          </div>
        ) : displayedEntries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-text-muted">
            {isSearching
              ? "Searching subfolders with jwalk..."
              : filterQuery
                ? "No matching items"
                : "This folder is empty"}
          </div>
        ) : (
          <div
            key={listKey}
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const entry = displayedEntries[virtualRow.index];
              if (!entry) {
                return null;
              }
              const isSelected = virtualRow.index === selectedIndex;
              const isRenaming = renamingPath === entry.path;
              const resolvedIcon = entry.icon ?? iconMap[entry.path] ?? null;

              return (
                <div
                  key={entry.path}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  onClick={() => setSelectedIndex(virtualRow.index)}
                  onContextMenu={(e) =>
                    handleEntryContextMenu(e, entry, virtualRow.index)
                  }
                  onDoubleClick={() => {
                    void handleOpenEntry(entry);
                  }}
                  onAuxClick={(e) => {
                    if (e.button === 1 && entry.isDir) {
                      e.preventDefault();
                      openTab(entry.path);
                    }
                  }}
                  className={`grid grid-cols-[1fr_150px_90px_100px] items-center px-3 text-xs transition-colors cursor-default ${
                    isSelected
                      ? "bg-selection text-text-primary"
                      : "hover:bg-ghost-hover text-text-primary"
                  } ${entry.isHidden ? "opacity-60" : ""}`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 pr-3">
                    {resolvedIcon ? (
                      <img
                        src={resolvedIcon}
                        alt=""
                        className="w-4 h-4 shrink-0 object-contain pointer-events-none"
                      />
                    ) : (
                      renderFallbackFileIcon(entry)
                    )}

                    {isRenaming ? (
                      <form
                        onSubmit={(e) => {
                          void handleCommitRename(e, entry);
                        }}
                        className="flex-1 min-w-0"
                      >
                        <input
                          ref={renameInputRef}
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={(e) => {
                            void handleCommitRename(e, entry);
                          }}
                          onKeyDown={(
                            e: KeyboardEvent<HTMLInputElement>
                          ) => {
                            if (e.key === "Escape") {
                              e.stopPropagation();
                              setRenamingPath(null);
                            }
                          }}
                          className="w-full h-6 px-1.5 text-xs bg-background text-text-primary border border-border-focused rounded-sm outline-none"
                        />
                      </form>
                    ) : (
                      <div className="flex items-baseline gap-2 min-w-0 truncate">
                        <span className="truncate font-normal">
                          {entry.name}
                        </span>
                        {activeRecursiveMode && (
                          <span className="text-[10px] font-mono text-text-muted truncate">
                            {formatRelativeParent(entry.path, activeTab.path)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <span className="text-[11px] text-text-secondary truncate">
                    {formatModifiedDate(entry.modified)}
                  </span>

                  <span className="text-[11px] text-text-muted uppercase truncate">
                    {entry.isDir
                      ? "Folder"
                      : entry.extension
                        ? `${entry.extension}`
                        : "File"}
                  </span>

                  <span className="text-[11px] font-mono text-text-secondary text-right pr-1 truncate">
                    {entry.isDir ? "—" : formatBytes(entry.size)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <footer className="flex items-center justify-between px-3 h-6 bg-surface border-t border-border/40 text-[11px] text-text-muted shrink-0">
        <div className="flex items-center gap-3">
          {activeRecursiveMode ? (
            <span className="text-accent-hover font-medium">
              {isSearching
                ? `Searching... ${displayedEntries.length} matches found`
                : `Search complete: ${displayedEntries.length} matches (${folderCount} folders, ${fileCount} files)`}
            </span>
          ) : (
            <span>
              {displayedEntries.length} items ({folderCount} folders,{" "}
              {fileCount} files)
            </span>
          )}
          {showHidden && (
            <span className="text-accent font-medium">Hidden visible</span>
          )}
        </div>

        <div className="truncate max-w-md font-mono text-[10px]">
          {selectedEntry
            ? `${
                activeRecursiveMode ? selectedEntry.path : selectedEntry.name
              }${
                selectedEntry.isDir
                  ? ""
                  : ` • ${formatBytes(selectedEntry.size)}`
              }`
            : activeTab.path}
        </div>
      </footer>
    </div>
  );
}
