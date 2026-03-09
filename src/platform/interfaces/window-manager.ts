export interface WindowManagerAPI {
  getActiveWindow(): Promise<any>;
  getWindows(): Promise<any[]>;
  setWindowBounds(windowId: string, bounds: { x: number, y: number, width: number, height: number }): Promise<void>;
  executeWindowAdjustByAction(
    action: string,
    targetHint?: {
      bundleId?: string;
      appPath?: string;
      windowId?: string;
      workArea?: { x: number; y: number; width: number; height: number } | null;
    }
  ): Promise<boolean | null>;
}
