export interface AccessibilityAPI {
  getSelectedText(): Promise<string>;
  getSelectedFinderItems(): Promise<string[]>;

  /**
   * Check if input monitoring access is granted (macOS-specific).
   * Returns true on non-macOS platforms.
   */
  checkInputMonitoringAccess(): Promise<boolean>;

  /**
   * Request input monitoring access (macOS-specific).
   * Returns true if access is granted. On non-macOS, returns true.
   */
  requestInputMonitoringAccess(): Promise<boolean>;
}
