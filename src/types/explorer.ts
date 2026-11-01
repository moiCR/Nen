export interface SystemPlace {
  id: string;
  name: string;
  path: string;
  icon: string;
}

export interface DriveInfo {
  name: string;
  mountPoint: string;
  fileSystem: string;
  totalSpace: number;
  availableSpace: number;
  isRemovable: boolean;
}

export interface FileEntry {
  name: string;
  extension: string;
  path: string;
  isDir: boolean;
  isHidden: boolean;
  size: number;
  modified: number | null;
  icon: string | null;
}

export interface DirectorySnapshot {
  path: string;
  parentPath: string | null;
  entries: FileEntry[];
}

export interface FsChangedPayload {
  directory: string;
}

export interface IconRequest {
  path: string;
  extension: string;
  isDir: boolean;
}

export interface SearchProgressPayload {
  searchId: number;
  entries: FileEntry[];
  totalFound: number;
  done: boolean;
}

export interface ShellMenuItem {
  id: string;
  menuIndex: number;
  cmdId: number | null;
  customAction: string | null;
  label: string;
  isSeparator: boolean;
  disabled: boolean;
  hasSubmenu: boolean;
  icon: string | null;
  children: ShellMenuItem[];
}

export interface ExplorerTab {
  id: string;
  path: string;
  title: string;
  history: string[];
  historyIndex: number;
}
