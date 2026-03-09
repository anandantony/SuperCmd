export interface TTSAPI {
  speak(text: string, options?: { voice?: string; rate?: number }): Promise<void>;
  stop(): Promise<void>;
  isSpeaking(): Promise<boolean>;
}
