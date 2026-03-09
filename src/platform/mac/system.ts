import { exec } from 'child_process';
import { promisify } from 'util';
import { app } from 'electron';
import { SystemAPI } from '../interfaces/system';

const execAsync = promisify(exec);

class MacSystem implements SystemAPI {
  async getApplications(directory = '/Applications'): Promise<any[]> {
    // Advanced discovery logic remains in commands.ts for now,
    // this exposes a simplified bridge if needed by the platform layer.
    throw new Error('Advanced application discovery is handled by commands.ts');
  }

  async getFrontmostApplication(): Promise<any> {
    const script = `
      tell application "System Events"
        set frontApp to first application process whose frontmost is true
        set bundleId to bundle identifier of frontApp
        set appName to name of frontApp
        set appFile to file of frontApp
        set appPath to POSIX path of appFile
        return "{\\\"name\\\":\\\"" & appName & "\\\", \\\"bundleId\\\":\\\"" & bundleId & "\\\", \\\"path\\\":\\\"" & appPath & "\\\"}"
      end tell
    `;

    try {
      const { stdout } = await execAsync(`/usr/bin/osascript -e '${script}'`, { timeout: 2000 });
      return JSON.parse(stdout.trim());
    } catch {
      return null;
    }
  }

  async getDefaultApplication(filePath: string): Promise<any> {
    const script = `
      use framework "AppKit"
      set fileURL to current application's NSURL's fileURLWithPath:"${filePath.replace(/"/g, '\\"')}"
      set appURL to current application's NSWorkspace's sharedWorkspace()'s URLForApplicationToOpenURL:fileURL
      if appURL is missing value then
        error "No default application found"
      end if
      set appPath to appURL's |path|() as text
      set appBundle to current application's NSBundle's bundleWithPath:appPath
      set appName to (appBundle's infoDictionary()'s objectForKey:"CFBundleName") as text
      set bundleId to (appBundle's bundleIdentifier()) as text
      return appName & "|||" & appPath & "|||" & bundleId
    `;
    try {
      const { stdout } = await execAsync(`/usr/bin/osascript -l AppleScript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 2000 });
      const [name, appPath, bundleId] = stdout.trim().split('|||');
      return { name, path: appPath, bundleId };
    } catch {
      return null;
    }
  }

  async runAppleScript(script: string): Promise<string> {
    try {
      const { stdout } = await execAsync(`/usr/bin/osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 10000 });
      return stdout.trim();
    } catch (e: any) {
      throw new Error(`AppleScript failed: ${e.message}`);
    }
  }

  async trash(paths: string | string[]): Promise<void> {
    const pathArray = Array.isArray(paths) ? paths : [paths];
    for (const p of pathArray) {
      const { shell } = require('electron');
      await shell.trashItem(p);
    }
  }

  async showInFinder(filePath: string): Promise<void> {
    const { shell } = require('electron');
    shell.showItemInFolder(filePath);
  }

  async openSettingsPane(identifier: string): Promise<void> {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    if (identifier.startsWith('com.apple.')) {
      try { await execAsync(`open "x-apple.systempreferences:${identifier}"`); return; } catch {}
    }

    try {
      await execAsync(`open "x-apple.systempreferences:com.apple.settings.${identifier}"`);
      return;
    } catch {}

    try {
      await execAsync(`open "x-apple.systempreferences:com.apple.preference.${identifier.toLowerCase()}"`);
      return;
    } catch {}

    try { await execAsync('open -a "System Settings"'); } catch {
      try { await execAsync('open -a "System Preferences"'); } catch (e) {
        console.error('Could not open System Settings:', e);
      }
    }
  }
}

export const macSystem = new MacSystem();
