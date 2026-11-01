import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { extractPathLabel, getDrives, getSystemPlaces } from "../lib/ipc";
import type { ExplorerTab } from "../types/explorer";
import { useKeybinds } from "./use-keybinds";

interface TabsContextValue {
  tabs: ExplorerTab[];
  activeTab: ExplorerTab;
  activeTabId: string;
  canGoBack: boolean;
  canGoForward: boolean;
  showHidden: boolean;
  setShowHidden: (value: boolean | ((prev: boolean) => boolean)) => void;
  navigateTo: (path: string) => void;
  openTab: (path?: string) => void;
  closeTab: (id: string) => void;
  selectTab: (id: string) => void;
  goBack: () => void;
  goForward: () => void;
  goUp: () => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

const FALLBACK_INITIAL_PATH = "C:\\";

function createTabObject(path: string): ExplorerTab {
  return {
    id: crypto.randomUUID(),
    path,
    title: extractPathLabel(path),
    history: [path],
    historyIndex: 0,
  };
}

function computeParentPath(rawPath: string): string | null {
  const normalized = rawPath.replace(/\//g, "\\").replace(/\\+$/, "");
  if (/^[a-zA-Z]:$/.test(normalized)) {
    return null;
  }
  const lastSep = normalized.lastIndexOf("\\");
  if (lastSep === -1) {
    return null;
  }
  const parent = normalized.slice(0, lastSep);
  if (/^[a-zA-Z]:$/.test(parent)) {
    return `${parent}\\`;
  }
  return parent || null;
}

export function TabsProvider({ children }: { children: ReactNode }) {
  const { data: places } = useQuery({
    queryKey: ["system-places"],
    queryFn: getSystemPlaces,
    staleTime: Infinity,
  });

  const { data: drives } = useQuery({
    queryKey: ["drives"],
    queryFn: () => getDrives(false),
    staleTime: 30_000,
  });

  const defaultStartPath = useMemo(() => {
    const homePlace = places?.find((p) => p.id === "home");
    if (homePlace) {
      return homePlace.path;
    }
    if (drives && drives.length > 0) {
      return drives[0].mountPoint;
    }
    return FALLBACK_INITIAL_PATH;
  }, [places, drives]);

  const [tabs, setTabs] = useState<ExplorerTab[]>(() => [
    createTabObject(FALLBACK_INITIAL_PATH),
  ]);
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0].id);
  const [hasInitializedHome, setHasInitializedHome] = useState(false);
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => {
    if (!hasInitializedHome && places && places.length > 0) {
      const initialPath = places[0].path;
      setHasInitializedHome(true);
      setTabs((prev) => {
        if (
          prev.length === 1 &&
          prev[0].history.length === 1 &&
          prev[0].path === FALLBACK_INITIAL_PATH
        ) {
          return [
            {
              ...prev[0],
              path: initialPath,
              title: extractPathLabel(initialPath),
              history: [initialPath],
              historyIndex: 0,
            },
          ];
        }
        return prev;
      });
    }
  }, [hasInitializedHome, places]);

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? tabs[0],
    [tabs, activeTabId]
  );

  const navigateTo = useCallback(
    (targetPath: string) => {
      const cleaned = targetPath.trim();
      if (!cleaned) {
        return;
      }
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== activeTab.id) {
            return tab;
          }
          if (tab.path.toLowerCase() === cleaned.toLowerCase()) {
            return tab;
          }
          const nextHistory = tab.history.slice(0, tab.historyIndex + 1);
          nextHistory.push(cleaned);
          return {
            ...tab,
            path: cleaned,
            title: extractPathLabel(cleaned),
            history: nextHistory,
            historyIndex: nextHistory.length - 1,
          };
        })
      );
    },
    [activeTab.id]
  );

  const openTab = useCallback(
    (path?: string) => {
      const target = path ?? activeTab?.path ?? defaultStartPath;
      const newTab = createTabObject(target);
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(newTab.id);
    },
    [activeTab?.path, defaultStartPath]
  );

  const closeTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        if (prev.length <= 1) {
          return prev;
        }
        const index = prev.findIndex((t) => t.id === id);
        if (index === -1) {
          return prev;
        }
        const nextTabs = prev.filter((t) => t.id !== id);
        if (id === activeTabId) {
          const fallbackTab =
            nextTabs[Math.min(index, nextTabs.length - 1)] ?? nextTabs[0];
          setActiveTabId(fallbackTab.id);
        }
        return nextTabs;
      });
    },
    [activeTabId]
  );

  const selectTab = useCallback((id: string) => {
    setActiveTabId(id);
  }, []);

  const goBack = useCallback(() => {
    setTabs((prev) =>
      prev.map((tab) => {
        if (tab.id !== activeTab.id || tab.historyIndex <= 0) {
          return tab;
        }
        const nextIndex = tab.historyIndex - 1;
        const nextPath = tab.history[nextIndex];
        return {
          ...tab,
          path: nextPath,
          title: extractPathLabel(nextPath),
          historyIndex: nextIndex,
        };
      })
    );
  }, [activeTab.id]);

  const goForward = useCallback(() => {
    setTabs((prev) =>
      prev.map((tab) => {
        if (
          tab.id !== activeTab.id ||
          tab.historyIndex >= tab.history.length - 1
        ) {
          return tab;
        }
        const nextIndex = tab.historyIndex + 1;
        const nextPath = tab.history[nextIndex];
        return {
          ...tab,
          path: nextPath,
          title: extractPathLabel(nextPath),
          historyIndex: nextIndex,
        };
      })
    );
  }, [activeTab.id]);

  const goUp = useCallback(() => {
    const parent = computeParentPath(activeTab.path);
    if (parent) {
      navigateTo(parent);
    }
  }, [activeTab.path, navigateTo]);

  const cycleNextTab = useCallback(() => {
    if (tabs.length <= 1) {
      return;
    }
    const currentIndex = tabs.findIndex((t) => t.id === activeTab.id);
    const nextIndex = (currentIndex + 1) % tabs.length;
    setActiveTabId(tabs[nextIndex].id);
  }, [tabs, activeTab.id]);

  useKeybinds([
    {
      key: "t",
      ctrl: true,
      handler: () => openTab(),
    },
    {
      key: "w",
      ctrl: true,
      handler: () => closeTab(activeTab.id),
    },
    {
      key: "tab",
      ctrl: true,
      handler: () => cycleNextTab(),
    },
    {
      key: "arrowleft",
      alt: true,
      handler: () => goBack(),
    },
    {
      key: "arrowright",
      alt: true,
      handler: () => goForward(),
    },
    {
      key: "arrowup",
      alt: true,
      handler: () => goUp(),
    },
    {
      key: "h",
      ctrl: true,
      handler: () => setShowHidden((prev) => !prev),
    },
  ]);

  const canGoBack = activeTab.historyIndex > 0;
  const canGoForward = activeTab.historyIndex < activeTab.history.length - 1;

  const value = useMemo<TabsContextValue>(
    () => ({
      tabs,
      activeTab,
      activeTabId: activeTab.id,
      canGoBack,
      canGoForward,
      showHidden,
      setShowHidden,
      navigateTo,
      openTab,
      closeTab,
      selectTab,
      goBack,
      goForward,
      goUp,
    }),
    [
      tabs,
      activeTab,
      canGoBack,
      canGoForward,
      showHidden,
      navigateTo,
      openTab,
      closeTab,
      selectTab,
      goBack,
      goForward,
      goUp,
    ]
  );

  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
}

export function useTabs(): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) {
    throw new Error("useTabs must be used within a TabsProvider");
  }
  return ctx;
}
