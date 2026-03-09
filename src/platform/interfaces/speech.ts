export interface MicrophonePermissionResult {
  granted: boolean;
  requested: boolean;
  status: 'not-determined' | 'denied' | 'restricted' | 'granted' | 'unknown';
  canPrompt: boolean;
  error?: string;
}

export interface SpeechRecognitionPermissionResult {
  granted: boolean;
  requested: boolean;
  speechStatus: string;
  microphoneStatus: string;
  error?: string;
}

export interface SpeechAPI {
  startListening(): Promise<void>;
  stopListening(): Promise<string>;
  isAvailable(): Promise<boolean>;
  requestMicrophoneAccess(prompt: boolean): Promise<MicrophonePermissionResult | null>;

  /**
   * Check/request speech recognition + microphone permissions.
   * On non-macOS, returns granted by default.
   */
  ensureSpeechRecognitionAccess(prompt: boolean, language: string): Promise<SpeechRecognitionPermissionResult>;

  /**
   * Start native speech-to-text transcription. Streaming JSON chunks are
   * delivered via the onChunk callback. Returns once the process is spawned.
   */
  startNativeTranscription(
    language: string,
    options?: { singleUtterance?: boolean },
    onChunk?: (payload: any) => void,
    onExit?: (code: number | null) => void
  ): Promise<void>;

  /**
   * Stop the native transcription process.
   */
  stopNativeTranscription(): Promise<void>;
}
