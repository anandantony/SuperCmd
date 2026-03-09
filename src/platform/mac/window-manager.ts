import { execFileSync } from 'child_process';
import * as path from 'path';
import { app } from 'electron';
import { WindowManagerAPI } from '../interfaces/window-manager';

function getNativeBinaryPath(name: string): string {
  let base = path.join(__dirname, '..', '..', 'native', name);
  if (app.isPackaged && base.includes('app.asar')) {
    base = base.replace('app.asar', 'app.asar.unpacked');
  }
  return base;
}

class MacWindowManager implements WindowManagerAPI {
  async setWindowBounds(windowId: string, bounds: { x: number, y: number, width: number, height: number }): Promise<void> {
    try {
      const binPath = getNativeBinaryPath('window-adjust');
      execFileSync(binPath, [
        '--window-id', windowId,
        '--area-x', String(bounds.x),
        '--area-y', String(bounds.y),
        '--area-width', String(bounds.width),
        '--area-height', String(bounds.height)
      ], { encoding: 'utf-8', timeout: 5000 });
    } catch (e) {
      console.error('Failed to adjust window via native binary:', e);
      throw e;
    }
  }

  async executeWindowAdjustByAction(
    action: string,
    targetHint?: {
      bundleId?: string;
      appPath?: string;
      windowId?: string;
      workArea?: { x: number; y: number; width: number; height: number } | null;
    }
  ): Promise<boolean | null> {
    const fsNative = require('fs');
    const helperPath = getNativeBinaryPath('window-adjust');
    if (!fsNative.existsSync(helperPath)) {
      return null;
    }

    try {
      const { execFile } = require('child_process');
      const args = [action];
      const hintedBundleId = String(targetHint?.bundleId || '').trim();
      const hintedAppPath = String(targetHint?.appPath || '').trim();
      const hintedWindowId = Math.trunc(Number(targetHint?.windowId));
      const hintedWorkArea = targetHint?.workArea || null;
      if (hintedBundleId && hintedBundleId !== 'com.supercmd.app' && hintedBundleId !== 'com.supercmd') {
        args.push('--bundle-id', hintedBundleId);
      }
      if (hintedAppPath && !hintedAppPath.includes('/SuperCmd.app')) {
        args.push('--app-path', hintedAppPath);
      }
      if (Number.isFinite(hintedWindowId) && hintedWindowId > 0) {
        args.push('--window-id', String(hintedWindowId));
      }
      if (hintedWorkArea) {
        args.push(
          '--area-x', String(hintedWorkArea.x),
          '--area-y', String(hintedWorkArea.y),
          '--area-width', String(hintedWorkArea.width),
          '--area-height', String(hintedWorkArea.height)
        );
      }

      const nativeAdjustTimeoutMs = app.isPackaged ? 1500 : 600;
      await new Promise<void>((resolve, reject) => {
        execFile(helperPath, args, { timeout: nativeAdjustTimeoutMs }, (error: any) => {
          if (error) reject(error);
          else resolve();
        });
      });
      return true;
    } catch (e) {
      console.error('Failed native window adjust:', e);
      return false;
    }
  }
}

export const macWindowManager = new MacWindowManager();
