import { exec } from 'child_process';
import { promisify } from 'util';
import { AccessibilityAPI } from '../interfaces/accessibility';

const execAsync = promisify(exec);

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
}

export const macAccessibility = new MacAccessibility();
