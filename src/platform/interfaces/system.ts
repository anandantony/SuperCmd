export interface SystemAPI {
  getApplications(directory?: string): Promise<any[]>;
  getFrontmostApplication(): Promise<any>;
  getDefaultApplication(path: string): Promise<any>;
  runAppleScript?(script: string): Promise<string>;
  trash(paths: string | string[]): Promise<void>;
  showInFinder(path: string): Promise<void>;
  openSettingsPane(identifier: string): Promise<void>;
}
