import { execFile, execFileSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import type { ColorPickerAPI, PickedColor } from '../interfaces/color-picker';

function getNativeBinaryPath(name: string): string {
  let base = path.join(__dirname, '..', '..', 'native', name);
  if (app.isPackaged && base.includes('app.asar')) {
    base = base.replace('app.asar', 'app.asar.unpacked');
  }
  return base;
}

function ensureColorPickerBinary(): string | null {
  const binaryPath = getNativeBinaryPath('color-picker');
  if (fs.existsSync(binaryPath)) return binaryPath;

  // On-demand compilation for development
  const sourceCandidates = [
    path.join(app.getAppPath(), 'src', 'native', 'mac', 'color-picker.swift'),
    path.join(app.getAppPath(), 'src', 'native', 'color-picker.swift'),
    path.join(process.cwd(), 'src', 'native', 'mac', 'color-picker.swift'),
    path.join(process.cwd(), 'src', 'native', 'color-picker.swift'),
    path.join(__dirname, '..', '..', 'src', 'native', 'mac', 'color-picker.swift'),
  ];
  const sourcePath = sourceCandidates.find((c) => fs.existsSync(c));
  if (!sourcePath) {
    console.warn('[ColorPicker] Binary and source file not found.');
    return null;
  }

  try {
    fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
    execFileSync('swiftc', ['-O', '-o', binaryPath, sourcePath, '-framework', 'AppKit']);
    return binaryPath;
  } catch (error) {
    console.error('[ColorPicker] Failed to compile native helper:', error);
    return null;
  }
}

function toUnitRange(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (numeric > 1) {
    const normalized = numeric / 255;
    return Math.max(0, Math.min(1, normalized));
  }
  return Math.max(0, Math.min(1, numeric));
}

class MacColorPicker implements ColorPickerAPI {
  async pickColor(): Promise<PickedColor | null> {
    const binaryPath = ensureColorPickerBinary();
    if (!binaryPath) return null;

    return new Promise<PickedColor | null>((resolve) => {
      execFile(binaryPath, (error: any, stdout: string) => {
        if (error) {
          console.error('Color picker failed:', error);
          resolve(null);
          return;
        }

        const trimmed = stdout.trim();
        if (trimmed === 'null' || !trimmed) {
          resolve(null);
          return;
        }

        try {
          const parsedColor = JSON.parse(trimmed);
          if (!parsedColor || typeof parsedColor !== 'object') {
            resolve(null);
            return;
          }

          const red = toUnitRange(parsedColor.red);
          const green = toUnitRange(parsedColor.green);
          const blue = toUnitRange(parsedColor.blue);
          const alpha = toUnitRange(parsedColor.alpha ?? 1);
          if (red === null || green === null || blue === null || alpha === null) {
            resolve(null);
            return;
          }

          const colorSpace = typeof parsedColor.colorSpace === 'string' && parsedColor.colorSpace.trim()
            ? String(parsedColor.colorSpace)
            : 'srgb';

          resolve({ red, green, blue, alpha, colorSpace });
        } catch (e) {
          console.error('Failed to parse color picker output:', e);
          resolve(null);
        }
      });
    });
  }
}

export const macColorPicker = new MacColorPicker();
