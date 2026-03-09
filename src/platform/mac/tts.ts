import { exec, type ChildProcess } from 'child_process';
import { TTSAPI } from '../interfaces/tts';

// For macOS, the built-in TTS leverages the 'say' command wrapper.
// NOTE: node-edge-tts is handled separately by the core TTS logic as it isn't platform specific,
// but the 'system' engine maps here.

class MacTTS implements TTSAPI {
  private activeProcess: ChildProcess | null = null;

  async speak(text: string, options?: { voice?: string; rate?: number }): Promise<void> {
    await this.stop();
    
    return new Promise((resolve, reject) => {
      let cmd = 'say';
      if (options?.voice) {
        cmd += ` -v "${options.voice}"`;
      }
      if (options?.rate) {
        const macRate = Math.round(options.rate * 175);
        cmd += ` -r ${macRate}`;
      }
      
      cmd += ` "${text.replace(/"/g, '\\"')}"`;
      
      this.activeProcess = exec(cmd, (error) => {
        this.activeProcess = null;
        if (error && error.killed === false) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  async stop(): Promise<void> {
    if (this.activeProcess) {
      try {
        this.activeProcess.kill();
      } catch {}
      this.activeProcess = null;
    }
  }

  async isSpeaking(): Promise<boolean> {
    return this.activeProcess !== null;
  }
}

export const macTTS = new MacTTS();
