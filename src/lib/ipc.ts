import { invoke } from "@tauri-apps/api/core";
import type { DirectorySnapshot, DriveInfo, IconRequest, ShellMenuItem, SystemPlace } from "../types/explorer";

export function getSystemPlaces(): Promise<SystemPlace[]> {
  return invoke<SystemPlace[]>("get_system_places");
}

export function getDrives(refresh = false): Promise<DriveInfo[]> {
  return invoke<DriveInfo[]>("get_drives", { refresh });
}

export function listDirectory(path: string, showHidden = false): Promise<DirectorySnapshot> {
  return invoke<DirectorySnapshot>("list_directory", { path, showHidden });
}

export function startSearch(rootPath: string, query: string, showHidden = false, maxResults = 1000): Promise<number> {
  return invoke<number>("start_search", { rootPath, query, showHidden, maxResults });
}

export function cancelSearch(): Promise<void> {
  return invoke<void>("cancel_search");
}

export function getIconsBatch(requests: IconRequest[]): Promise<Record<string, string>> {
  return invoke<Record<string, string>>("get_icons_batch", { requests });
}

export function getShellContextMenu(path: string, isBackground = false): Promise<ShellMenuItem[]> {
  return invoke<ShellMenuItem[]>("get_shell_context_menu", { path, isBackground });
}

export function expandShellSubmenu(menuPath: number[]): Promise<ShellMenuItem[]> {
  return invoke<ShellMenuItem[]>("expand_shell_submenu", { menuPath });
}

export function invokeShellContextItem(path: string, cmdId: number | null, customAction: string | null): Promise<void> {
  return invoke<void>("invoke_shell_context_item", { path, cmdId, customAction });
}

export function watchDirectory(path: string): Promise<void> {
  return invoke<void>("watch_directory", { path });
}

export function unwatchDirectory(path: string): Promise<void> {
  return invoke<void>("unwatch_directory", { path });
}

export function createDir(path: string): Promise<string> {
  return invoke<string>("create_dir", { path });
}

export function createEmptyFile(path: string): Promise<string> {
  return invoke<string>("create_empty_file", { path });
}

export function renameEntry(from: string, to: string): Promise<string> {
  return invoke<string>("rename_entry", { from, to });
}

export function deleteToTrash(paths: string[]): Promise<void> {
  return invoke<void>("delete_to_trash", { paths });
}

export function openItem(path: string): Promise<void> {
  return invoke<void>("open_item", { path });
}

export function extractPathLabel(rawPath: string): string {
  const trimmed = rawPath.replace(/[\\/]+$/, "");
  if (!trimmed) {
    return rawPath;
  }
  if (/^[a-zA-Z]:$/.test(trimmed)) {
    return `${trimmed.toUpperCase()}\\`;
  }
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] ?? rawPath;
}

export function normalizeComparePath(rawPath: string): string {
  return rawPath.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function formatRelativeParent(fullPath: string, rootPath: string): string {
  const cleanFull = fullPath.replace(/\//g, "\\");
  const cleanRoot = rootPath.replace(/\//g, "\\").replace(/\\+$/, "");
  const lastSlash = cleanFull.lastIndexOf("\\");
  if (lastSlash === -1) {
    return "";
  }
  const dir = cleanFull.slice(0, lastSlash);
  if (dir.toLowerCase().startsWith(cleanRoot.toLowerCase())) {
    const rel = dir.slice(cleanRoot.length).replace(/^\\+/, "");
    return rel ? `.\\${rel}` : ".";
  }
  return dir;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, index);
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

export function formatModifiedDate(timestamp: number | null): string {
  if (timestamp === null) {
    return "—";
  }
  const date = new Date(timestamp);
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
