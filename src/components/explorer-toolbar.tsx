import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowLeft, ArrowRight, ArrowUp, ChevronRight, Eye, EyeOff, FolderPlus, FolderTree, Loader2, MoreHorizontal, RefreshCw, Search, X } from "lucide-react";
import { Button } from "./button";
import { Tooltip } from "./tooltip";
import { useTabs } from "../hooks/tabs-context";
import { useKeybinds } from "../hooks/use-keybinds";

interface ExplorerToolbarProps {
  filterQuery: string;
  isRecursiveSearch: boolean;
  isSearching: boolean;
  onFilterChange: (value: string) => void;
  onToggleRecursiveSearch: () => void;
  onRefresh: () => void;
  onCreateFolder: () => void;
}

interface BreadcrumbSegment {
  label: string;
  path: string;
  isCollapsed?: boolean;
}

function parseBreadcrumbs(rawPath: string): BreadcrumbSegment[] {
  const normalized = rawPath.replace(/\//g, "\\").replace(/\\+$/, "");
  if (!normalized) {
    return [];
  }

  const parts = normalized.split("\\");
  const segments: BreadcrumbSegment[] = [];
  let accumulated = "";

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) {
      continue;
    }
    if (i === 0 && part.endsWith(":")) {
      accumulated = `${part}\\`;
      segments.push({ label: part, path: accumulated });
      continue;
    }
    accumulated = accumulated.endsWith("\\")
      ? `${accumulated}${part}`
      : `${accumulated}\\${part}`;
    segments.push({ label: part, path: accumulated });
  }

  return segments;
}

function compactBreadcrumbs(
  segments: BreadcrumbSegment[]
): BreadcrumbSegment[] {
  if (segments.length <= 4) {
    return segments;
  }
  const first = segments[0];
  const collapsedTarget = segments[segments.length - 4];
  const tail = segments.slice(-3);
  return [
    first,
    { label: "...", path: collapsedTarget.path, isCollapsed: true },
    ...tail,
  ];
}

export function ExplorerToolbar({
  filterQuery,
  isRecursiveSearch,
  isSearching,
  onFilterChange,
  onToggleRecursiveSearch,
  onRefresh,
  onCreateFolder,
}: ExplorerToolbarProps) {
  const {
    activeTab,
    canGoBack,
    canGoForward,
    showHidden,
    setShowHidden,
    navigateTo,
    goBack,
    goForward,
    goUp,
  } = useTabs();

  const [isEditingPath, setIsEditingPath] = useState(false);
  const [pathInput, setPathInput] = useState(activeTab.path);
  const pathInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPathInput(activeTab.path);
    setIsEditingPath(false);
  }, [activeTab.path]);

  useEffect(() => {
    if (isEditingPath && pathInputRef.current) {
      pathInputRef.current.focus();
      pathInputRef.current.select();
    }
  }, [isEditingPath]);

  useKeybinds([
    {
      key: "l",
      ctrl: true,
      handler: () => {
        setPathInput(activeTab.path);
        setIsEditingPath(true);
      },
    },
    {
      key: "f",
      ctrl: true,
      handler: () => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      },
    },
    {
      key: "r",
      ctrl: true,
      handler: () => onRefresh(),
    },
  ]);

  const allSegments = useMemo(
    () => parseBreadcrumbs(activeTab.path),
    [activeTab.path]
  );

  const visibleSegments = useMemo(
    () => compactBreadcrumbs(allSegments),
    [allSegments]
  );

  const handlePathSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (pathInput.trim()) {
      navigateTo(pathInput.trim());
    }
    setIsEditingPath(false);
  };

  const handlePathKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      setPathInput(activeTab.path);
      setIsEditingPath(false);
    }
  };

  return (
    <div className="flex items-center gap-2 px-3 h-11 bg-surface  shrink-0">
      <div className="flex items-center gap-0.5 shrink-0">
        <Button
          variant="ghost"
          size="icon-sm"
          tooltip="Back"
          command="Alt+Left"
          disabled={!canGoBack}
          onClick={goBack}
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          tooltip="Forward"
          command="Alt+Right"
          disabled={!canGoForward}
          onClick={goForward}
        >
          <ArrowRight className="w-4 h-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          tooltip="Up One Level"
          command="Alt+Up"
          disabled={allSegments.length <= 1}
          onClick={goUp}
        >
          <ArrowUp className="w-4 h-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          tooltip="Refresh"
          command="Ctrl+R"
          onClick={onRefresh}
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
      </div>

      <div className="flex-1 min-w-0">
        {isEditingPath ? (
          <form onSubmit={handlePathSubmit} className="w-full">
            <input
              ref={pathInputRef}
              type="text"
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              onBlur={() => setIsEditingPath(false)}
              onKeyDown={handlePathKeyDown}
              className="w-full h-7 px-2.5 bg-background/70 text-xs font-mono text-text-primary rounded-md outline-none"
            />
          </form>
        ) : (
          <div
            role="button"
            tabIndex={0}
            title={activeTab.path}
            onClick={() => {
              setPathInput(activeTab.path);
              setIsEditingPath(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setPathInput(activeTab.path);
                setIsEditingPath(true);
              }
            }}
            className="flex items-center gap-0.5 h-7 px-2 hover:bg-background/70  rounded-md overflow-hidden cursor-text transition-colors"
          >
            {visibleSegments.map((seg, idx) => {
              const isLast = idx === visibleSegments.length - 1;
              return (
                <div
                  key={`${seg.path}-${idx}`}
                  className={`flex items-center ${
                    isLast ? "min-w-0 shrink" : "shrink-0"
                  }`}
                >
                  <button
                    type="button"
                    title={seg.path}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigateTo(seg.path);
                    }}
                    className={`px-1.5 py-0.5 rounded-sm text-xs transition-colors cursor-pointer truncate max-w-44 ${
                      isLast
                        ? "font-medium text-text-primary hover:bg-elevated-surface"
                        : "text-text-secondary hover:text-text-primary hover:bg-elevated-surface"
                    }`}
                  >
                    {seg.isCollapsed ? (
                      <MoreHorizontal className="w-3.5 h-3.5" />
                    ) : (
                      seg.label
                    )}
                  </button>
                  {!isLast && (
                    <ChevronRight className="w-3.5 h-3.5 text-text-muted shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="relative flex items-center w-64 shrink-0">
        {isSearching ? (
          <Loader2 className="w-3.5 h-3.5 text-accent animate-spin absolute left-2.5 pointer-events-none" />
        ) : (
          <Search className="w-3.5 h-3.5 text-text-muted absolute left-2.5 pointer-events-none" />
        )}
        <input
          ref={searchInputRef}
          type="text"
          value={filterQuery}
          onChange={(e) => onFilterChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              onFilterChange("");
              e.currentTarget.blur();
            }
          }}
          placeholder={
            isRecursiveSearch
              ? "Search subfolders... (Ctrl+F)"
              : "Filter folder... (Ctrl+F)"
          }
          className="w-full h-7 pl-8 pr-13 text-xs hover:bg-background/70 focus:bg-background/80 text-text-primary placeholder:text-text-muted rounded-md outline-none transition-colors"
        />
        <div className="absolute right-1.5 flex items-center gap-0.5">
          {filterQuery && (
            <button
              type="button"
              onClick={() => onFilterChange("")}
              className="p-0.5 text-text-muted hover:text-text-primary cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          )}
          <Tooltip
            content={
              isRecursiveSearch
                ? "Recursive search (jwalk) enabled"
                : "Current folder filter only"
            }
          >
            <button
              type="button"
              onClick={onToggleRecursiveSearch}
              className={`p-1 rounded-sm transition-colors cursor-pointer ${
                isRecursiveSearch
                  ? "bg-selection text-accent-hover"
                  : "text-text-muted hover:text-text-primary hover:bg-ghost-hover"
              }`}
            >
              <FolderTree className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="flex items-center gap-0.5 shrink-0">
        <Button
          variant="ghost"
          size="icon-sm"
          tooltip="New Folder"
          command="Ctrl+Shift+N"
          onClick={onCreateFolder}
        >
          <FolderPlus className="w-4 h-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          tooltip={showHidden ? "Hide Hidden Files" : "Show Hidden Files"}
          command="Ctrl+H"
          onClick={() => setShowHidden((prev) => !prev)}
        >
          {showHidden ? (
            <Eye className="w-4 h-4 text-accent" />
          ) : (
            <EyeOff className="w-4 h-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
