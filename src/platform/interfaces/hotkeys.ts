export interface HotkeysAPI {
  register(shortcut: string, callback: () => void): void;
  unregister(shortcut: string): void;
  unregisterAll(): void;
}
