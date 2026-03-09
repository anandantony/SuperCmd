import { clipboard } from 'electron';
import { ClipboardAPI } from '../interfaces/clipboard';

// SuperCmd's complex clipboard monitoring logic lives in `src/main/clipboard-manager.ts`.
// The abstraction layer here provides the raw building blocks required by the interface.
// `clipboard-manager` will continue to handle polling, persistence, and images.

class MacClipboard implements ClipboardAPI {
  private listenerInterval: NodeJS.Timeout | null = null;
  private lastText = '';

  async read(): Promise<string> {
    return clipboard.readText() || '';
  }

  async write(text: string): Promise<void> {
    clipboard.writeText(text);
  }

  startMonitoring(callback: (text: string) => void): void {
    if (this.listenerInterval) {
      clearInterval(this.listenerInterval);
    }
    
    this.lastText = clipboard.readText() || '';
    
    this.listenerInterval = setInterval(() => {
      const currentText = clipboard.readText() || '';
      if (currentText && currentText !== this.lastText) {
        this.lastText = currentText;
        callback(currentText);
      }
    }, 1000);
  }

  stopMonitoring(): void {
    if (this.listenerInterval) {
      clearInterval(this.listenerInterval);
      this.listenerInterval = null;
    }
  }

  async writeGif(filePath: string): Promise<boolean> {
    try {
      const { execFileSync } = require('child_process');
      const swift = `
import Cocoa
let filePath = CommandLine.arguments[1]
let fileUrl = URL(fileURLWithPath: filePath)
guard let gifData = try? Data(contentsOf: fileUrl) else { exit(1) }
let image = NSImage(data: gifData)
let pb = NSPasteboard.general
pb.clearContents()
pb.writeObjects([fileUrl as NSURL])
pb.addTypes([NSPasteboard.PasteboardType("com.compuserve.gif"), .tiff], owner: nil)
pb.setData(gifData, forType: NSPasteboard.PasteboardType("com.compuserve.gif"))
if let tiff = image?.tiffRepresentation {
    pb.setData(tiff, forType: .tiff)
}
`;
      execFileSync('swift', ['-e', swift, filePath], { stdio: 'ignore', timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  }
}

export const macClipboard = new MacClipboard();
