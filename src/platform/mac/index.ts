import { Platform } from '../interfaces/platform';
import { macClipboard } from './clipboard';
import { macHotkeys } from './hotkeys';
import { macSpeech } from './speech';
import { macTTS } from './tts';
import { macColorPicker } from './color-picker';
import { macWindowManager } from './window-manager';
import { macAccessibility } from './accessibility';
import { macSystem } from './system';
import { macCommandsDiscovery } from './commands-discovery';

export const platform: Platform = {
  clipboard: macClipboard,
  hotkeys: macHotkeys,
  speech: macSpeech,
  tts: macTTS,
  colorPicker: macColorPicker,
  windowManager: macWindowManager,
  accessibility: macAccessibility,
  system: macSystem,
  commandsDiscovery: macCommandsDiscovery,
};

export type { MicrophonePermissionResult } from '../interfaces/speech';
