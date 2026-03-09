import { spawn, execFileSync, type ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import type { SpeechAPI, SpeechRecognitionPermissionResult } from '../interfaces/speech';

function getNativeBinaryPath(name: string): string {
  let base = path.join(__dirname, '..', '..', 'native', name);
  if (app.isPackaged && base.includes('app.asar')) {
    base = base.replace('app.asar', 'app.asar.unpacked');
  }
  return base;
}

function ensureSpeechRecognizerBinary(): string {
  const binaryPath = getNativeBinaryPath('speech-recognizer');
  if (fs.existsSync(binaryPath)) return binaryPath;

  // On-demand compilation for development
  const sourceCandidates = [
    path.join(app.getAppPath(), 'src', 'native', 'mac', 'speech-recognizer.swift'),
    path.join(app.getAppPath(), 'src', 'native', 'speech-recognizer.swift'),
    path.join(process.cwd(), 'src', 'native', 'mac', 'speech-recognizer.swift'),
    path.join(__dirname, '..', '..', 'src', 'native', 'mac', 'speech-recognizer.swift'),
  ];
  const sourcePath = sourceCandidates.find((c) => fs.existsSync(c));
  if (!sourcePath) {
    throw new Error('Speech recognizer binary and source not found. Reinstall SuperCmd.');
  }
  fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
  execFileSync('swiftc', [
    '-O', '-o', binaryPath, sourcePath,
    '-framework', 'Speech',
    '-framework', 'AVFoundation',
  ]);
  console.log('[Speech] Compiled speech-recognizer binary');
  return binaryPath;
}

class MacSpeech implements SpeechAPI {
  private activeRecognizer: ChildProcess | null = null;
  private transcribedText = '';
  private nativeTranscriptionProcess: ChildProcess | null = null;
  private nativeStdoutBuffer = '';

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
    try { this.activeRecognizer.kill(); } catch {}
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
    const binaryPath = getNativeBinaryPath('microphone-access');
    if (!fs.existsSync(binaryPath)) return null;

    return await new Promise<import('../interfaces/speech').MicrophonePermissionResult | null>((resolve) => {
      const args = prompt ? ['--prompt'] : [];
      const proc = spawn(binaryPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (chunk: Buffer | string) => { stdout += String(chunk || ''); });
      proc.stderr.on('data', (chunk: Buffer | string) => { stderr += String(chunk || ''); });
      proc.on('error', () => { resolve(null); });

      proc.on('close', () => {
        const lines = stdout.split('\n').map((line: string) => line.trim()).filter(Boolean);
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

  async ensureSpeechRecognitionAccess(prompt: boolean, language: string): Promise<SpeechRecognitionPermissionResult> {
    if (!prompt) {
      return {
        granted: false,
        requested: false,
        speechStatus: 'unknown',
        microphoneStatus: 'unknown',
      };
    }

    let binaryPath: string;
    try {
      binaryPath = ensureSpeechRecognizerBinary();
    } catch {
      return {
        granted: false,
        requested: false,
        speechStatus: 'unknown',
        microphoneStatus: 'unknown',
        error: 'Speech recognizer helper is missing. Reinstall SuperCmd and retry.',
      };
    }

    return await new Promise<SpeechRecognitionPermissionResult>((resolve) => {
      const proc = spawn(binaryPath, [language, '--auth-only'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let settled = false;
      let stdoutBuffer = '';
      let stderrBuffer = '';
      let helperError = '';
      let speechStatus = 'unknown';
      let microphoneStatus = 'unknown';
      let timeout: NodeJS.Timeout | null = null;

      const normalizeStatus = (s: string): string => {
        const raw = String(s || '').toLowerCase();
        if (raw === 'authorized') return 'granted';
        if (raw === 'notdetermined' || raw === 'not_determined') return 'not-determined';
        return raw || 'unknown';
      };

      const finalize = (result: SpeechRecognitionPermissionResult) => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        resolve(result);
      };

      const parseLine = (line: string) => {
        const trimmed = String(line || '').trim();
        if (!trimmed) return;
        try {
          const payload = JSON.parse(trimmed) as any;
          if (payload?.speechStatus !== undefined) {
            speechStatus = normalizeStatus(payload.speechStatus);
          }
          if (payload?.microphoneStatus !== undefined) {
            microphoneStatus = normalizeStatus(payload.microphoneStatus);
          }
          if (payload?.authorized === true) {
            speechStatus = 'granted';
            if (microphoneStatus === 'unknown') microphoneStatus = 'granted';
          }
          if (payload?.error) {
            helperError = String(payload.error || '').trim();
          }
        } catch {}
      };

      proc.stdout.on('data', (chunk: Buffer | string) => {
        stdoutBuffer += String(chunk || '');
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() || '';
        for (const line of lines) parseLine(line);
      });

      proc.stderr.on('data', (chunk: Buffer | string) => {
        stderrBuffer += String(chunk || '');
      });

      proc.on('error', (error: Error) => {
        finalize({
          granted: false,
          requested: false,
          speechStatus,
          microphoneStatus,
          error: error.message || 'Failed to request speech recognition access.',
        });
      });

      proc.on('close', (code: number | null) => {
        if (stdoutBuffer.trim()) parseLine(stdoutBuffer.trim());
        const granted = speechStatus === 'granted';
        let error = helperError || '';
        if (!granted && !error) {
          const stderr = stderrBuffer.trim();
          if (stderr) {
            error = stderr;
          } else if (code && code !== 0) {
            error = `Speech recognition permission check exited with code ${code}.`;
          } else {
            error = 'Speech recognition permission is required for Whisper.';
          }
        }
        finalize({
          granted,
          requested: true,
          speechStatus,
          microphoneStatus,
          error: error || undefined,
        });
      });

      timeout = setTimeout(() => {
        try { proc.kill('SIGTERM'); } catch {}
        finalize({
          granted: speechStatus === 'granted',
          requested: true,
          speechStatus,
          microphoneStatus,
          error: helperError || 'Speech permission prompt timed out. Please allow access and retry.',
        });
      }, 15000);
    });
  }

  async startNativeTranscription(
    language: string,
    options?: { singleUtterance?: boolean },
    onChunk?: (payload: any) => void,
    onExit?: (code: number | null) => void
  ): Promise<void> {
    // Kill existing process
    if (this.nativeTranscriptionProcess) {
      try { this.nativeTranscriptionProcess.kill('SIGTERM'); } catch {}
      this.nativeTranscriptionProcess = null;
      this.nativeStdoutBuffer = '';
    }

    const binaryPath = ensureSpeechRecognizerBinary();
    const args: string[] = [language];
    if (options?.singleUtterance) args.push('--single-utterance');

    this.nativeTranscriptionProcess = spawn(binaryPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.nativeStdoutBuffer = '';
    console.log(`[Speech] Started native transcription (lang=${language})`);

    this.nativeTranscriptionProcess.stdout!.on('data', (chunk: Buffer | string) => {
      this.nativeStdoutBuffer += chunk.toString();
      const lines = this.nativeStdoutBuffer.split('\n');
      this.nativeStdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const payload = JSON.parse(trimmed);
          onChunk?.(payload);
        } catch {}
      }
    });

    this.nativeTranscriptionProcess.stderr!.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString().trim();
      if (text) console.warn('[Speech][native]', text);
    });

    this.nativeTranscriptionProcess.on('exit', (code: number | null) => {
      console.log(`[Speech] Native transcription exited (code=${code})`);
      this.nativeTranscriptionProcess = null;
      this.nativeStdoutBuffer = '';
      onExit?.(code);
    });
  }

  async stopNativeTranscription(): Promise<void> {
    if (this.nativeTranscriptionProcess) {
      try { this.nativeTranscriptionProcess.kill('SIGTERM'); } catch {}
      this.nativeTranscriptionProcess = null;
      this.nativeStdoutBuffer = '';
    }
  }
}

export const macSpeech = new MacSpeech();
