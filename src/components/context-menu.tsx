import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Loader2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { KbdShortcut } from "./kbd";

export type ContextMenuVariant = "default" | "danger";

export interface ContextMenuActionItem {
  type?: "item";
  id: string;
  label: string;
  icon?: ReactNode;
  iconUrl?: string | null;
  shortcut?: string | string[];
  variant?: ContextMenuVariant;
  disabled?: boolean;
  children?: ContextMenuEntry[];
  loadChildren?: () => Promise<ContextMenuEntry[]>;
  onSelect?: () => void;
}

export interface ContextMenuSeparatorItem {
  type: "separator";
  id: string;
}

export interface ContextMenuLabelItem {
  type: "label";
  id: string;
  label: string;
}

export type ContextMenuEntry =
  | ContextMenuActionItem
  | ContextMenuSeparatorItem
  | ContextMenuLabelItem;

interface ContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
  entries: ContextMenuEntry[];
}

interface ContextMenuContextValue {
  showContextMenu: (event: ReactMouseEvent | MouseEvent, entries: ContextMenuEntry[]) => void;
  hideContextMenu: () => void;
}

const ContextMenuContext = createContext<ContextMenuContextValue | null>(null);

const VIEWPORT_PADDING = 8;

function isActionItem(entry: ContextMenuEntry): entry is ContextMenuActionItem {
  return entry.type === undefined || entry.type === "item";
}

function hasSubmenuCapability(entry: ContextMenuActionItem): boolean {
  return Boolean((entry.children && entry.children.length > 0) || entry.loadChildren);
}

function clampRootPosition(anchorX: number, anchorY: number, menuRect: DOMRect): { top: number; left: number } {
  const maxLeft = Math.max(VIEWPORT_PADDING, window.innerWidth - menuRect.width - VIEWPORT_PADDING);
  const maxTop = Math.max(VIEWPORT_PADDING, window.innerHeight - menuRect.height - VIEWPORT_PADDING);

  return {
    left: Math.min(Math.max(VIEWPORT_PADDING, anchorX), maxLeft),
    top: Math.min(Math.max(VIEWPORT_PADDING, anchorY), maxTop),
  };
}

function computeSubmenuPosition(triggerRect: DOMRect, submenuRect: DOMRect): { top: number; left: number } {
  const spaceRight = window.innerWidth - triggerRect.right - VIEWPORT_PADDING;
  const openRight = spaceRight >= submenuRect.width || triggerRect.left < submenuRect.width;

  const rawLeft = openRight ? triggerRect.right - 2 : triggerRect.left - submenuRect.width + 2;
  const maxLeft = Math.max(VIEWPORT_PADDING, window.innerWidth - submenuRect.width - VIEWPORT_PADDING);
  const maxTop = Math.max(VIEWPORT_PADDING, window.innerHeight - submenuRect.height - VIEWPORT_PADDING);

  return {
    left: Math.min(Math.max(VIEWPORT_PADDING, rawLeft), maxLeft),
    top: Math.min(Math.max(VIEWPORT_PADDING, triggerRect.top - 4), maxTop),
  };
}

interface ContextMenuPanelProps {
  entries: ContextMenuEntry[];
  anchorX?: number;
  anchorY?: number;
  triggerRect?: DOMRect | null;
  depth: number;
  isActiveKeyboardPanel: boolean;
  onCloseAll: () => void;
  onCloseSelf?: () => void;
}

function ContextMenuPanel({
  entries,
  anchorX = 0,
  anchorY = 0,
  triggerRect = null,
  depth,
  isActiveKeyboardPanel,
  onCloseAll,
  onCloseSelf,
}: ContextMenuPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const [coords, setCoords] = useState<{ top: number; left: number }>(() => {
    if (triggerRect) {
      return { top: triggerRect.top, left: triggerRect.right };
    }
    return { top: anchorY, left: anchorX };
  });

  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [openSubmenuIndex, setOpenSubmenuIndex] = useState<number>(-1);
  const [submenuTriggerRect, setSubmenuTriggerRect] = useState<DOMRect | null>(null);
  const [loadedSubmenus, setLoadedSubmenus] = useState<Record<string, ContextMenuEntry[]>>({});
  const [loadingSubmenuIds, setLoadingSubmenuIds] = useState<Record<string, boolean>>({});

  const enabledIndices = useMemo(() => {
    const indices: number[] = [];
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (isActionItem(entry) && !entry.disabled) {
        indices.push(i);
      }
    }
    return indices;
  }, [entries]);

  useLayoutEffect(() => {
    if (!panelRef.current) {
      return;
    }
    const rect = panelRef.current.getBoundingClientRect();
    if (triggerRect) {
      setCoords(computeSubmenuPosition(triggerRect, rect));
      return;
    }
    setCoords(clampRootPosition(anchorX, anchorY, rect));
  }, [anchorX, anchorY, entries, triggerRect]);

  const openSubmenuForIndex = useCallback(
    (index: number) => {
      const entry = entries[index];
      if (!entry || !isActionItem(entry) || entry.disabled || !hasSubmenuCapability(entry)) {
        setOpenSubmenuIndex(-1);
        setSubmenuTriggerRect(null);
        return;
      }

      const rowEl = itemRefs.current.get(index);
      if (rowEl) {
        setSubmenuTriggerRect(rowEl.getBoundingClientRect());
      }
      setOpenSubmenuIndex(index);

      if (entry.children && entry.children.length > 0) {
        return;
      }

      if (!entry.loadChildren || loadedSubmenus[entry.id] || loadingSubmenuIds[entry.id]) {
        return;
      }

      setLoadingSubmenuIds((prev) => ({ ...prev, [entry.id]: true }));
      entry
        .loadChildren()
        .then((loaded) => {
          setLoadedSubmenus((prev) => ({ ...prev, [entry.id]: loaded }));
        })
        .catch(() => {
          setLoadedSubmenus((prev) => ({ ...prev, [entry.id]: [] }));
        })
        .finally(() => {
          setLoadingSubmenuIds((prev) => ({ ...prev, [entry.id]: false }));
        });
    },
    [entries, loadedSubmenus, loadingSubmenuIds]
  );

  useEffect(() => {
    if (!isActiveKeyboardPanel || openSubmenuIndex !== -1) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseAll();
        return;
      }

      if (event.key === "ArrowLeft" && depth > 0 && onCloseSelf) {
        event.preventDefault();
        event.stopPropagation();
        onCloseSelf();
        return;
      }

      if (enabledIndices.length === 0) {
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        const currentPos = enabledIndices.indexOf(activeIndex);
        const nextPos = (currentPos + 1) % enabledIndices.length;
        setActiveIndex(enabledIndices[nextPos]);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        const currentPos = enabledIndices.indexOf(activeIndex);
        const prevPos = currentPos <= 0 ? enabledIndices.length - 1 : currentPos - 1;
        setActiveIndex(enabledIndices[prevPos]);
        return;
      }

      if (event.key === "Home") {
        event.preventDefault();
        event.stopPropagation();
        setActiveIndex(enabledIndices[0]);
        return;
      }

      if (event.key === "End") {
        event.preventDefault();
        event.stopPropagation();
        setActiveIndex(enabledIndices[enabledIndices.length - 1]);
        return;
      }

      if (event.key === "ArrowRight") {
        const currentEntry = entries[activeIndex];
        if (currentEntry && isActionItem(currentEntry) && !currentEntry.disabled && hasSubmenuCapability(currentEntry)) {
          event.preventDefault();
          event.stopPropagation();
          openSubmenuForIndex(activeIndex);
        }
        return;
      }

      if (event.key === "Enter" || event.key === " ") {
        const currentEntry = entries[activeIndex];
        if (!currentEntry || !isActionItem(currentEntry) || currentEntry.disabled) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (hasSubmenuCapability(currentEntry)) {
          openSubmenuForIndex(activeIndex);
          return;
        }
        if (currentEntry.onSelect) {
          onCloseAll();
          currentEntry.onSelect();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [activeIndex, depth, enabledIndices, entries, isActiveKeyboardPanel, onCloseAll, onCloseSelf, openSubmenuForIndex, openSubmenuIndex]);

  const activeSubmenuEntry = openSubmenuIndex >= 0 ? entries[openSubmenuIndex] : null;
  const resolvedSubmenuChildren =
    activeSubmenuEntry && isActionItem(activeSubmenuEntry)
      ? activeSubmenuEntry.children && activeSubmenuEntry.children.length > 0
        ? activeSubmenuEntry.children
        : loadedSubmenus[activeSubmenuEntry.id] ?? null
      : null;

  return (
    <>
      <motion.div
        ref={panelRef}
        role="menu"
        data-context-menu-panel="true"
        initial={{ opacity: 0, scale: 0.97, y: -2 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: -2 }}
        transition={{ duration: 0.08, ease: [0.16, 1, 0.3, 1] }}
        style={{ top: coords.top, left: coords.left, zIndex: 50 + depth }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        className="fixed min-w-52 max-w-72 max-h-[82vh] overflow-y-auto p-1 bg-elevated-surface border border-border rounded-lg shadow-xl select-none outline-none"
      >
        {entries.map((entry, index) => {
          if (entry.type === "separator") {
            return <div key={entry.id} role="separator" className="my-1 h-px bg-border/60 -mx-1" />;
          }

          if (entry.type === "label") {
            return (
              <div key={entry.id} className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted truncate">
                {entry.label}
              </div>
            );
          }

          const isFocused = index === activeIndex || index === openSubmenuIndex;
          const isDanger = entry.variant === "danger";
          const hasSub = hasSubmenuCapability(entry);
          const isLoadingSub = Boolean(loadingSubmenuIds[entry.id]);

          const colorClasses = isDanger
            ? isFocused
              ? "bg-danger/15 text-danger"
              : "text-danger hover:bg-danger/15"
            : isFocused
              ? "bg-ghost-hover text-text-primary"
              : "text-text-primary hover:bg-ghost-hover";

          return (
            <div
              key={entry.id}
              ref={(el) => {
                if (el) {
                  itemRefs.current.set(index, el);
                  return;
                }
                itemRefs.current.delete(index);
              }}
              onMouseEnter={() => {
                if (entry.disabled) {
                  return;
                }
                setActiveIndex(index);
                openSubmenuForIndex(index);
              }}
            >
              <button
                type="button"
                role="menuitem"
                disabled={entry.disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  if (entry.disabled) {
                    return;
                  }
                  if (hasSub) {
                    openSubmenuForIndex(index);
                    return;
                  }
                  if (entry.onSelect) {
                    onCloseAll();
                    entry.onSelect();
                  }
                }}
                className={`flex items-center justify-between gap-4 w-full px-2.5 py-1.5 rounded-md text-xs font-normal transition-colors cursor-pointer text-left disabled:opacity-40 disabled:pointer-events-none ${colorClasses}`}
              >
                <span className="flex items-center gap-2.5 min-w-0 truncate">
                  {entry.iconUrl ? (
                    <img src={entry.iconUrl} alt="" className="w-4 h-4 shrink-0 object-contain pointer-events-none" />
                  ) : entry.icon ? (
                    <span className={`w-4 h-4 shrink-0 flex items-center justify-center ${isDanger ? "text-danger" : "text-text-secondary"}`}>
                      {entry.icon}
                    </span>
                  ) : (
                    <span className="w-4 h-4 shrink-0" />
                  )}
                  <span className="truncate">{entry.label}</span>
                </span>

                {hasSub ? (
                  isLoadingSub ? (
                    <Loader2 className="w-3.5 h-3.5 text-text-muted animate-spin shrink-0" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-text-muted shrink-0" />
                  )
                ) : (
                  entry.shortcut && <KbdShortcut command={entry.shortcut} className="shrink-0" />
                )}
              </button>
            </div>
          );
        })}
      </motion.div>

      <AnimatePresence>
        {openSubmenuIndex >= 0 && resolvedSubmenuChildren && resolvedSubmenuChildren.length > 0 && (
          <ContextMenuPanel
            key={`submenu-${depth + 1}-${openSubmenuIndex}`}
            entries={resolvedSubmenuChildren}
            triggerRect={submenuTriggerRect}
            depth={depth + 1}
            isActiveKeyboardPanel={isActiveKeyboardPanel}
            onCloseAll={onCloseAll}
            onCloseSelf={() => setOpenSubmenuIndex(-1)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [menuState, setMenuState] = useState<ContextMenuState>({
    isOpen: false,
    x: 0,
    y: 0,
    entries: [],
  });

  const hideContextMenu = useCallback(() => {
    setMenuState((prev) => {
      if (!prev.isOpen) {
        return prev;
      }
      return { ...prev, isOpen: false };
    });
  }, []);

  const showContextMenu = useCallback(
    (event: ReactMouseEvent | MouseEvent, entries: ContextMenuEntry[]) => {
      event.preventDefault();
      event.stopPropagation();

      if (entries.length === 0) {
        hideContextMenu();
        return;
      }

      setMenuState({
        isOpen: true,
        x: event.clientX,
        y: event.clientY,
        entries,
      });
    },
    [hideContextMenu]
  );

  useEffect(() => {
    if (!menuState.isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-context-menu-panel="true"]')) {
        return;
      }
      hideContextMenu();
    };

    const handleDismiss = () => {
      hideContextMenu();
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("resize", handleDismiss);
    window.addEventListener("blur", handleDismiss);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("resize", handleDismiss);
      window.removeEventListener("blur", handleDismiss);
    };
  }, [hideContextMenu, menuState.isOpen]);

  const contextValue = useMemo<ContextMenuContextValue>(
    () => ({
      showContextMenu,
      hideContextMenu,
    }),
    [showContextMenu, hideContextMenu]
  );

  return (
    <ContextMenuContext.Provider value={contextValue}>
      {children}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {menuState.isOpen && (
              <ContextMenuPanel
                key={`root-menu-${menuState.x}-${menuState.y}`}
                entries={menuState.entries}
                anchorX={menuState.x}
                anchorY={menuState.y}
                depth={0}
                isActiveKeyboardPanel={true}
                onCloseAll={hideContextMenu}
              />
            )}
          </AnimatePresence>,
          document.body
        )}
    </ContextMenuContext.Provider>
  );
}

export function useContextMenu(): ContextMenuContextValue {
  const ctx = useContext(ContextMenuContext);
  if (!ctx) {
    throw new Error("useContextMenu must be used within a ContextMenuProvider");
  }
  return ctx;
}
