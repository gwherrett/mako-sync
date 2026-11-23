/**
 * The MediaMonkey globals Mako Clean uses. MediaMonkey ships no type file for its
 * native objects; each name here is one MediaMonkey's own code uses (see
 * docs/reference/mediamonkey-5.md for the source of each).
 */

interface MMTrack {
  id: number;
  path: string;
  title: string;
  artist: string;
  genre: string;
  groupDesc: string;
  albumArtist: string;
  beginUpdate(): void;
  endUpdate(): void;
  commitAsync(params?: Record<string, unknown>): Promise<unknown>;
}

interface MMTrackList {
  count: number;
  whenLoaded(): Promise<unknown>;
}

interface MMDialog {
  modalResult: number;
}

interface MMAction {
  title: string | (() => string);
  hotkeyAble?: boolean;
  icon?: string;
  disabled?: unknown;
  visible?: unknown;
  execute: () => unknown;
}

declare const app: {
  getValue<T>(key: string, defaultValue: T): T;
  setValue(key: string, value: unknown): void;
  filesystem: {
    fileExistsAsync(path: string): Promise<boolean>;
    loadTextFromFileAsync(path: string): Promise<string>;
  };
};

declare const uitools: {
  getSelectedTracklist(): MMTrackList;
  openDialog(
    name: string,
    params: Record<string, unknown>,
    callback?: (dialog: MMDialog) => void
  ): MMDialog;
  notMediaListSelected: unknown;
  getCanEdit: unknown;
};

declare const actions: Record<string, MMAction>;

declare function listAsyncForEach(
  list: MMTrackList,
  callback: (item: MMTrack, next: (terminate?: boolean) => void, index: number) => void,
  finalCallback?: () => void
): void;

declare function messageDlg(
  html: string,
  type: 'Information' | 'Warning' | 'Error' | 'Confirmation',
  buttons: string[],
  options: Record<string, unknown>,
  callback?: (result: { btnID: string }) => void
): void;

interface Window {
  _menuItems: {
    editTags: { action: { submenu: { action: MMAction; order: number; grouporder: number }[] } };
  };
  settings: {
    get(section: string): { Appearance?: { MultiStringSeparator?: string } };
  };
}
