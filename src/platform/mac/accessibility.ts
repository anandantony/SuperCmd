import { exec, spawn, execFileSync } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { AccessibilityAPI } from '../interfaces/accessibility';

const execAsync = promisify(exec);

function getNativeBinaryPath(name: string): string {
  let base = path.join(__dirname, '..', '..', 'native', name);
  if (app.isPackaged && base.includes('app.asar')) {
    base = base.replace('app.asar', 'app.asar.unpacked');
  }
  return base;
}

function ensureInputMonitoringBinary(): string | null {
  const binaryPath = getNativeBinaryPath('input-monitoring-request');
  if (fs.existsSync(binaryPath)) return binaryPath;

  const sourceCandidates = [
    path.join(app.getAppPath(), 'src', 'native', 'mac', 'input-monitoring-request.swift'),
    path.join(app.getAppPath(), 'src', 'native', 'input-monitoring-request.swift'),
    path.join(process.cwd(), 'src', 'native', 'mac', 'input-monitoring-request.swift'),
    path.join(process.cwd(), 'src', 'native', 'input-monitoring-request.swift'),
    path.join(__dirname, '..', '..', 'src', 'native', 'mac', 'input-monitoring-request.swift'),
  ];
  const sourcePath = sourceCandidates.find((c) => fs.existsSync(c));
  if (!sourcePath) return null;

  try {
    fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
    execFileSync('swiftc', ['-O', '-o', binaryPath, sourcePath, '-framework', 'CoreGraphics']);
    return binaryPath;
  } catch {
    return null;
  }
}

class MacAccessibility implements AccessibilityAPI {
  async getSelectedText(): Promise<string> {
    const script = `
      try
        tell application "System Events"
          keystroke "c" using command down
          delay 0.1
        end tell
        return the clipboard as text
      on error
        return ""
      end try
    `;

    try {
      const { stdout } = await execAsync(`/usr/bin/osascript -e '${script}'`, { timeout: 2000 });
      return stdout.trim();
    } catch {
      return '';
    }
  }

  async getSelectedFinderItems(): Promise<string[]> {
    const script = `
      tell application "Finder"
        set theSelection to selection
        set thePaths to {}
        repeat with i from 1 to count of theSelection
          set the item_path to POSIX path of (item i of theSelection as text)
          set end of thePaths to the item_path
        end repeat
        return thePaths
      end tell
    `;

    try {
      const { stdout } = await execAsync(`/usr/bin/osascript -e '${script}'`, { timeout: 2000 });
      const items = stdout.split(',').map(s => s.trim()).filter(Boolean);
      return items;
    } catch {
      return [];
    }
  }

  async checkInputMonitoringAccess(): Promise<boolean> {
    const binaryPath = ensureInputMonitoringBinary();
    if (!binaryPath) return false;

    return await new Promise<boolean>((resolve) => {
      const proc = spawn(binaryPath, ['--check'], { stdio: ['ignore', 'pipe', 'ignore'] });
      let stdout = '';
      let settled = false;
      const settle = (value: boolean) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      const timeout = setTimeout(() => {
        try { proc.kill('SIGTERM'); } catch {}
        settle(false);
      }, 1400);

      proc.stdout.on('data', (chunk: Buffer | string) => {
        stdout += String(chunk || '');
      });

      proc.on('error', () => {
        clearTimeout(timeout);
        settle(false);
      });

      proc.on('close', () => {
        clearTimeout(timeout);
        const lines = stdout.split('\n').map((line: string) => line.trim()).filter(Boolean);
        for (let i = lines.length - 1; i >= 0; i -= 1) {
          try {
            const payload = JSON.parse(lines[i]);
            if (typeof payload?.granted === 'boolean') {
              settle(Boolean(payload.granted));
              return;
            }
          } catch {}
        }
        settle(false);
      });
    });
  }

  async requestInputMonitoringAccess(): Promise<boolean> {
    const binaryPath = ensureInputMonitoringBinary();
    if (!binaryPath) return false;

    return await new Promise<boolean>((resolve) => {
      const proc = spawn(binaryPath, [], { stdio: ['ignore', 'pipe', 'ignore'] });
      let stdout = '';
      let settled = false;
      const settle = (value: boolean) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      const timeout = setTimeout(() => {
        try { proc.kill('SIGTERM'); } catch {}
        settle(false);
      }, 5000);

      proc.stdout.on('data', (chunk: Buffer | string) => {
        stdout += String(chunk || '');
      });

      proc.on('error', () => {
        clearTimeout(timeout);
        settle(false);
      });

      proc.on('close', () => {
        clearTimeout(timeout);
        const lines = stdout.split('\n').map((line: string) => line.trim()).filter(Boolean);
        for (let i = lines.length - 1; i >= 0; i -= 1) {
          try {
            const payload = JSON.parse(lines[i]);
            if (typeof payload?.granted === 'boolean') {
              settle(Boolean(payload.granted));
              return;
            }
          } catch {}
        }
        settle(false);
      });
    });
  }
}

export const macAccessibility = new MacAccessibility();
