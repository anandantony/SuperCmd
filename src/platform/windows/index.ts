import { Platform } from '../interfaces/platform';
import { ClipboardAPI } from '../interfaces/clipboard';
import { HotkeysAPI } from '../interfaces/hotkeys';
import { SpeechAPI } from '../interfaces/speech';
import { TTSAPI } from '../interfaces/tts';
import { ColorPickerAPI } from '../interfaces/color-picker';
import { WindowManagerAPI } from '../interfaces/window-manager';
import { AccessibilityAPI } from '../interfaces/accessibility';
import { SystemAPI } from '../interfaces/system';
import { CommandsDiscoveryAPI } from '../interfaces/commands-discovery';
import { shell } from 'electron';

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
  async ensureSpeechRecognitionAccess(): Promise<import('../interfaces/speech').SpeechRecognitionPermissionResult> {
    return { granted: true, requested: false, speechStatus: 'granted', microphoneStatus: 'granted' };
  }
  async startNativeTranscription(): Promise<void> { throw new Error('Not implemented on Windows'); }
  async stopNativeTranscription(): Promise<void> {}
}

class WindowsTTS implements TTSAPI {
  async speak(text: string, options?: { voice?: string; rate?: number }): Promise<void> { throw new Error('Not implemented on Windows'); }
  async stop(): Promise<void> { throw new Error('Not implemented on Windows'); }
  async isSpeaking(): Promise<boolean> { return false; }
}

class WindowsColorPicker implements ColorPickerAPI {
  async pickColor(): Promise<import('../interfaces/color-picker').PickedColor | null> { return null; }
}

class WindowsWindowManager implements WindowManagerAPI {
  async setWindowBounds(windowId: string, bounds: { x: number, y: number, width: number, height: number }): Promise<void> {}
  async executeWindowAdjustByAction(action: string, targetHint?: any): Promise<boolean | null> {
    return null;
  }
}

class WindowsAccessibility implements AccessibilityAPI {
  async getSelectedText(): Promise<string> { throw new Error('Not implemented on Windows'); }
  async getSelectedFinderItems(): Promise<string[]> { throw new Error('Not implemented on Windows'); }
  async checkInputMonitoringAccess(): Promise<boolean> { return true; }
  async requestInputMonitoringAccess(): Promise<boolean> { return true; }
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

class WindowsCommandsDiscovery implements CommandsDiscoveryAPI {
  async discoverApplications(): Promise<any[]> { return []; }
  async discoverSystemSettings(): Promise<any[]> { return []; }
  async getAppIcon(bundlePath: string): Promise<string | undefined> { return undefined; }
  async batchExtractIcons(bundlePaths: string[]): Promise<Map<string, string>> { return new Map(); }
  async readBundleInfo(bundlePath: string): Promise<Record<string, any> | null> { return null; }
  async openApplication(appPath: string): Promise<void> { await shell.openPath(appPath); }
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
  commandsDiscovery: new WindowsCommandsDiscovery(),
};

export type { MicrophonePermissionResult } from '../interfaces/speech';
