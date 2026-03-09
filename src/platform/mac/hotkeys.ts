import { globalShortcut } from 'electron';
import { HotkeysAPI } from '../interfaces/hotkeys';

class MacHotkeys implements HotkeysAPI {
  register(shortcut: string, callback: () => void): void {
    globalShortcut.register(shortcut, callback);
  }

  unregister(shortcut: string): void {
    globalShortcut.unregister(shortcut);
  }

  unregisterAll(): void {
    globalShortcut.unregisterAll();
  }
}

export const macHotkeys = new MacHotkeys();
