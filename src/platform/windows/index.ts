import { Platform } from '../interfaces/platform';
import { ClipboardAPI } from '../interfaces/clipboard';
import { HotkeysAPI } from '../interfaces/hotkeys';
import { SpeechAPI } from '../interfaces/speech';
import { TTSAPI } from '../interfaces/tts';
import { ColorPickerAPI } from '../interfaces/color-picker';
import { WindowManagerAPI } from '../interfaces/window-manager';
import { AccessibilityAPI } from '../interfaces/accessibility';
import { SystemAPI } from '../interfaces/system';

class WindowsClipboard implements ClipboardAPI {
  async read(): Promise<string> { throw new Error('Not implemented on Windows'); }
  async write(text: string): Promise<void> { throw new Error('Not implemented on Windows'); }
  startMonitoring(callback: (text: string) => void): void { throw new Error('Not implemented on Windows'); }
  stopMonitoring(): void {
    throw new Error('Not implemented on Windows');
  }

  async writeGif(filePath: string): Promise<boolean> {
    throw new Error('Not implemented on Windows');
  }
}

class WindowsHotkeys implements HotkeysAPI {
  register(shortcut: string, callback: () => void): void { throw new Error('Not implemented on Windows'); }
  unregister(shortcut: string): void { throw new Error('Not implemented on Windows'); }
  unregisterAll(): void { throw new Error('Not implemented on Windows'); }
}

class WindowsSpeech implements SpeechAPI {
  async startListening(): Promise<void> { throw new Error('Not implemented on Windows'); }
  async stopListening(): Promise<string> { throw new Error('Not implemented on Windows'); }
  async isAvailable(): Promise<boolean> { return false; }
  async requestMicrophoneAccess(prompt: boolean): Promise<import('../interfaces/speech').MicrophonePermissionResult | null> {
    return { granted: true, requested: false, status: 'granted', canPrompt: false };
  }
}

class WindowsTTS implements TTSAPI {
  async speak(text: string, options?: { voice?: string; rate?: number }): Promise<void> { throw new Error('Not implemented on Windows'); }
  async stop(): Promise<void> { throw new Error('Not implemented on Windows'); }
  async isSpeaking(): Promise<boolean> { return false; }
}

class WindowsColorPicker implements ColorPickerAPI {
  async pickColor(): Promise<string | null> { throw new Error('Not implemented on Windows'); }
}

class WindowsWindowManager implements WindowManagerAPI {
  async getActiveWindow(): Promise<any> { throw new Error('Not implemented on Windows'); }
  async getWindows(): Promise<any[]> { return []; }
  async setWindowBounds(windowId: string, bounds: { x: number, y: number, width: number, height: number }): Promise<void> {}
  async executeWindowAdjustByAction(action: string, targetHint?: any): Promise<boolean | null> {
    return null;
  }
}

class WindowsAccessibility implements AccessibilityAPI {
  async getSelectedText(): Promise<string> { throw new Error('Not implemented on Windows'); }
  async getSelectedFinderItems(): Promise<string[]> { throw new Error('Not implemented on Windows'); }
}

class WindowsSystem implements SystemAPI {
  async getApplications(directory?: string): Promise<any[]> { throw new Error('Not implemented on Windows'); }
  async getFrontmostApplication(): Promise<any> { throw new Error('Not implemented on Windows'); }
  async getDefaultApplication(path: string): Promise<any> { throw new Error('Not implemented on Windows'); }
  async trash(paths: string | string[]): Promise<void> { throw new Error('Not implemented on Windows'); }
  async showInFinder(filePath: string): Promise<void> {
    const { shell } = require('electron');
    shell.showItemInFolder(filePath);
  }
  async openSettingsPane(identifier: string): Promise<void> { throw new Error('Not implemented on Windows'); }
}

export const platform: Platform = {
  clipboard: new WindowsClipboard(),
  hotkeys: new WindowsHotkeys(),
  speech: new WindowsSpeech(),
  tts: new WindowsTTS(),
  colorPicker: new WindowsColorPicker(),
  windowManager: new WindowsWindowManager(),
  accessibility: new WindowsAccessibility(),
  system: new WindowsSystem(),
};

export type { MicrophonePermissionResult } from '../interfaces/speech';
