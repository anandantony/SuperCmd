export interface MicrophonePermissionResult {
  granted: boolean;
  requested: boolean;
  status: 'not-determined' | 'denied' | 'restricted' | 'granted' | 'unknown';
  canPrompt: boolean;
  error?: string;
}

export interface SpeechAPI {
  startListening(): Promise<void>;
  stopListening(): Promise<string>;
  isAvailable(): Promise<boolean>;
  requestMicrophoneAccess(prompt: boolean): Promise<MicrophonePermissionResult | null>;
}
