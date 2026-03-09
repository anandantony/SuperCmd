/**
 * Platform-specific command discovery for applications and system settings.
 * 
 * On macOS: uses Spotlight (mdfind), filesystem scanning, plutil, sips, osascript/JXA
 * On Windows: will use registry, Start Menu scanning, shell APIs
 * On Linux: will use .desktop files, XDG directories
 */

export interface AppInfo {
  name: string;
  rawName: string;
  path: string;
  bundleId?: string;
  iconDataUrl?: string;
  /** Internal: used for batch icon extraction */
  _bundlePath?: string;
}

export interface SettingsPaneInfo {
  id: string;
  name: string;
  /** bundle ID or pane name used to open this pane */
  identifier: string;
  bundlePath: string;
  bundleId?: string;
  legacyBundleId?: string;
  iconDataUrl?: string;
  keywords?: string[];
  /** Sub-items discovered from .searchTerms files */
  children?: SettingsPaneInfo[];
}

export interface CommandsDiscoveryAPI {
  /**
   * Discover all installed applications on the system.
   */
  discoverApplications(): Promise<AppInfo[]>;

  /**
   * Discover all system settings / preference panes.
   */
  discoverSystemSettings(): Promise<SettingsPaneInfo[]>;

  /**
   * Get icon for a single bundle path as a base64 data URL.
   * Uses disk cache → fast extraction → returns undefined if needs batch.
   */
  getAppIcon(bundlePath: string): Promise<string | undefined>;

  /**
   * Batch extract icons for bundles that don't have easily extractable icon files.
   * Returns a map of bundle path → base64 data URL.
   */
  batchExtractIcons(bundlePaths: string[]): Promise<Map<string, string>>;

  /**
   * Read and return the contents of a bundle's Info.plist as a JSON object.
   */
  readBundleInfo(bundlePath: string): Promise<Record<string, any> | null>;

  /**
   * Open an application by its path.
   */
  openApplication(appPath: string): Promise<void>;
}
