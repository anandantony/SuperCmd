export interface AccessibilityAPI {
  getSelectedText(): Promise<string>;
  getSelectedFinderItems(): Promise<string[]>;
}
