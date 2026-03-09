import { spawn, type ChildProcess } from 'child_process';
import * as path from 'path';
import { app } from 'electron';
import { SpeechAPI } from '../interfaces/speech';

function getNativeBinaryPath(name: string): string {
  let base = path.join(__dirname, '..', '..', 'native', name);
  if (app.isPackaged && base.includes('app.asar')) {
    base = base.replace('app.asar', 'app.asar.unpacked');
  }
  return base;
}

class MacSpeech implements SpeechAPI {
  private activeRecognizer: ChildProcess | null = null;
  private transcribedText = '';

  async startListening(): Promise<void> {
    if (this.activeRecognizer) {
      this.activeRecognizer.kill();
      this.activeRecognizer = null;
    }
    
    this.transcribedText = '';
    
    try {
      const binPath = getNativeBinaryPath('speech-recognizer');
      this.activeRecognizer = spawn(binPath, { stdio: ['ignore', 'pipe', 'pipe'] });
      
      this.activeRecognizer.stdout?.on('data', (data) => {
        const text = data.toString().trim();
        if (text && !text.includes('Error:') && !text.includes('Microphone access denied')) {
          this.transcribedText = text;
        }
      });
      
    } catch (e) {
      console.error('Failed to start native speech recognizer:', e);
      throw e;
    }
  }

  async stopListening(): Promise<string> {
    if (!this.activeRecognizer) return this.transcribedText;
    
    const finalResult = this.transcribedText;
    try {
      this.activeRecognizer.kill();
    } catch {}
    this.activeRecognizer = null;
    
    return finalResult;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const binPath = getNativeBinaryPath('microphone-access');
      const { execSync } = require('child_process');
      const result = execSync(`"${binPath}" check`, { encoding: 'utf8' }).trim();
      return result === 'authorized' || result === 'notDetermined';
    } catch {
      return false;
    }
  }

  async requestMicrophoneAccess(prompt: boolean): Promise<import('../interfaces/speech').MicrophonePermissionResult | null> {
    const fs = require('fs');
    const binaryPath = getNativeBinaryPath('microphone-access');
    if (!fs.existsSync(binaryPath)) return null;

    return await new Promise<import('../interfaces/speech').MicrophonePermissionResult | null>((resolve) => {
      const { spawn } = require('child_process');
      const args = prompt ? ['--prompt'] : [];
      const proc = spawn(binaryPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (chunk: Buffer | string) => {
        stdout += String(chunk || '');
      });
      proc.stderr.on('data', (chunk: Buffer | string) => {
        stderr += String(chunk || '');
      });

      proc.on('error', () => {
        resolve(null);
      });

      proc.on('close', () => {
        const lines = stdout
          .split('\n')
          .map((line: string) => line.trim())
          .filter(Boolean);
        for (let i = lines.length - 1; i >= 0; i -= 1) {
          try {
            const payload = JSON.parse(lines[i]);
            let rawStatus = String(payload?.status || 'unknown').toLowerCase();
            if (rawStatus === 'authorized') rawStatus = 'granted';
            if (rawStatus === 'notdetermined') rawStatus = 'not-determined';
            const statusNames = ['not-determined', 'denied', 'restricted', 'granted', 'unknown'];
            const status = statusNames.includes(rawStatus) ? rawStatus : 'unknown';
            
            const granted = Boolean(payload?.granted) || status === 'granted';
            const requested = Boolean(payload?.requested);
            const canPrompt = typeof payload?.canPrompt === 'boolean'
              ? Boolean(payload.canPrompt)
              : status === 'not-determined' || status === 'unknown';
            
            resolve({
              granted,
              requested,
              status: status as any,
              canPrompt,
              error: granted
                ? undefined
                : String(payload?.error || '').trim() || (stderr.trim() || undefined),
            });
            return;
          } catch {}
        }
        resolve(null);
      });
    });
  }
}

export const macSpeech = new MacSpeech();
