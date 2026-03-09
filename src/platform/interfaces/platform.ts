import { ClipboardAPI } from './clipboard';
import { HotkeysAPI } from './hotkeys';
import { SpeechAPI } from './speech';
import { TTSAPI } from './tts';
import { ColorPickerAPI } from './color-picker';
import { WindowManagerAPI } from './window-manager';
import { AccessibilityAPI } from './accessibility';
import { SystemAPI } from './system';
import { CommandsDiscoveryAPI } from './commands-discovery';

export interface Platform {
  clipboard: ClipboardAPI;
  hotkeys: HotkeysAPI;
  speech: SpeechAPI;
  tts: TTSAPI;
  colorPicker: ColorPickerAPI;
  windowManager: WindowManagerAPI;
  accessibility: AccessibilityAPI;
  system: SystemAPI;
  commandsDiscovery: CommandsDiscoveryAPI;
}
