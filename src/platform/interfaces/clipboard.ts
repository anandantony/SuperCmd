export interface ClipboardAPI {
  read(): Promise<string>;
  write(text: string): Promise<void>;
  startMonitoring(callback: (text: string) => void): void;
  stopMonitoring(): void;
  writeGif(filePath: string): Promise<boolean>;
}
