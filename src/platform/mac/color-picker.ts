import { execFileSync } from 'child_process';
import * as path from 'path';
import { app } from 'electron';
import { ColorPickerAPI } from '../interfaces/color-picker';

function getNativeBinaryPath(name: string): string {
  let base = path.join(__dirname, '..', '..', 'native', name);
  if (app.isPackaged && base.includes('app.asar')) {
    base = base.replace('app.asar', 'app.asar.unpacked');
  }
  return base;
}

class MacColorPicker implements ColorPickerAPI {
  async pickColor(): Promise<string | null> {
    try {
      const binPath = getNativeBinaryPath('color-picker');
      const result = execFileSync(binPath, { encoding: 'utf-8', timeout: 30000 });
      const color = result.trim();
      return color && color.startsWith('#') ? color : null;
    } catch {
      return null;
    }
  }
}

export const macColorPicker = new MacColorPicker();
