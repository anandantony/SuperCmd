/**
 * macOS-specific command discovery.
 *
 * Discovers installed applications via Spotlight (mdfind) + filesystem scanning,
 * and System Settings panes via .appex / .prefPane bundle scanning.
 *
 * Icon extraction uses:
 * 1. sips for .icns files (fast path)
 * 2. NSWorkspace via osascript/JXA for bundles without .icns
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { app, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { CommandsDiscoveryAPI, AppInfo, SettingsPaneInfo } from '../interfaces/commands-discovery';

const execAsync = promisify(exec);
let iconCounter = 0;

// ─── Icon Disk Cache ────────────────────────────────────────────────

let iconCacheDir: string | null = null;

function getIconCacheDir(): string {
  if (!iconCacheDir) {
    iconCacheDir = path.join(app.getPath('userData'), 'icon-cache');
    if (!fs.existsSync(iconCacheDir)) {
      fs.mkdirSync(iconCacheDir, { recursive: true });
    }
  }
  return iconCacheDir;
}

function iconCacheKey(bundlePath: string): string {
  return 'v6-' + crypto.createHash('md5').update(bundlePath).digest('hex');
}

function getCachedIcon(bundlePath: string): string | undefined {
  try {
    const cacheFile = path.join(getIconCacheDir(), `${iconCacheKey(bundlePath)}.b64`);
    if (fs.existsSync(cacheFile)) {
      return fs.readFileSync(cacheFile, 'utf-8');
    }
  } catch {}
  return undefined;
}

function setCachedIcon(bundlePath: string, dataUrl: string): void {
  try {
    const cacheFile = path.join(getIconCacheDir(), `${iconCacheKey(bundlePath)}.b64`);
    fs.writeFileSync(cacheFile, dataUrl);
  } catch {}
}

// ─── Icon Extraction ────────────────────────────────────────────────

async function icnsToPngDataUrl(icnsPath: string): Promise<string | undefined> {
  const tmpPng = path.join(
    app.getPath('temp'),
    `launcher-icon-${++iconCounter}.png`
  );
  try {
    await execAsync(
      `/usr/bin/sips -s format png -z 64 64 "${icnsPath}" --out "${tmpPng}" 2>/dev/null`
    );
    const pngBuf = fs.readFileSync(tmpPng);
    fs.unlinkSync(tmpPng);
    if (pngBuf.length > 100) {
      return `data:image/png;base64,${pngBuf.toString('base64')}`;
    }
  } catch {
    try { fs.unlinkSync(tmpPng); } catch {}
  }
  return undefined;
}

async function getIconFromIcns(bundlePath: string): Promise<string | undefined> {
  const resourcesDir = path.join(bundlePath, 'Contents', 'Resources');

  try {
    const plistPath = path.join(bundlePath, 'Contents', 'Info.plist');
    if (fs.existsSync(plistPath)) {
      const { stdout } = await execAsync(
        `/usr/bin/plutil -convert json -o - "${plistPath}" 2>/dev/null`
      );
      const info = JSON.parse(stdout);
      const iconFileName: string | undefined =
        info.CFBundleIconFile || info.CFBundleIconName;

      if (iconFileName) {
        let icnsPath = path.join(resourcesDir, iconFileName);
        if (!fs.existsSync(icnsPath) && !iconFileName.endsWith('.icns')) {
          icnsPath = path.join(resourcesDir, `${iconFileName}.icns`);
        }
        if (fs.existsSync(icnsPath)) {
          return await icnsToPngDataUrl(icnsPath);
        }
      }
    }
  } catch {}

  if (fs.existsSync(resourcesDir)) {
    try {
      const files = fs.readdirSync(resourcesDir);
      const priorityNames = ['icon.icns', 'AppIcon.icns', 'SharedAppIcon.icns'];
      for (const name of priorityNames) {
        if (files.includes(name)) {
          const result = await icnsToPngDataUrl(path.join(resourcesDir, name));
          if (result) return result;
        }
      }
      const anyIcns = files.find((f) => f.endsWith('.icns'));
      if (anyIcns) {
        return await icnsToPngDataUrl(path.join(resourcesDir, anyIcns));
      }
    } catch {}
  }

  return undefined;
}

// ─── Plist Helpers ──────────────────────────────────────────────────

async function readPlistJson(
  bundlePath: string
): Promise<Record<string, any> | null> {
  try {
    const plistPath = path.join(bundlePath, 'Contents', 'Info.plist');
    if (!fs.existsSync(plistPath)) return null;
    const { stdout } = await execAsync(
      `/usr/bin/plutil -convert json -o - "${plistPath}" 2>/dev/null`
    );
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

async function readPlistFileJson(plistPath: string): Promise<Record<string, any> | null> {
  try {
    if (!fs.existsSync(plistPath)) return null;
    const safePath = plistPath.replace(/"/g, '\\"');
    const { stdout } = await execAsync(
      `/usr/bin/plutil -convert json -o - "${safePath}" 2>/dev/null`
    );
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

// ─── Name Helpers ───────────────────────────────────────────────────

function cleanPaneName(raw: string): string {
  let s = raw
    .replace(/Pref$/, '')
    .replace(/\.prefPane$/, '')
    .replace(/SettingsExtension$/, '')
    .replace(/Settings$/, '')
    .replace(/Extension$/, '')
    .replace(/Intents$/, '')
    .replace(/IntentsExtension$/, '');
  s = s.replace(/([a-z])([A-Z])/g, '$1 $2');
  s = s.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  return s.replace(/\s+/g, ' ').trim();
}

function canonicalSettingsTitle(title: string, _bundleId?: string): string {
  return cleanPaneName(title);
}

// ─── Filesystem Discovery ───────────────────────────────────────────

function collectAppBundles(rootDir: string, maxDepth = 4): string[] {
  const results: string[] = [];
  if (!rootDir || !fs.existsSync(rootDir)) return results;

  const queue: Array<{ dir: string; depth: number }> = [{ dir: rootDir, depth: 0 }];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    let visitKey = current.dir;
    try { visitKey = fs.realpathSync(current.dir); } catch {}
    if (visited.has(visitKey)) continue;
    visited.add(visitKey);

    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(current.dir, { withFileTypes: true }); } catch { continue; }

    for (const entry of entries) {
      const fullPath = path.join(current.dir, entry.name);
      let isDir = entry.isDirectory();
      if (!isDir && entry.isSymbolicLink()) {
        try { isDir = fs.statSync(fullPath).isDirectory(); } catch {}
      }
      if (!isDir) continue;

      if (entry.name.endsWith('.app')) {
        results.push(fullPath);
        continue;
      }
      if (
        entry.name.endsWith('.appex') ||
        entry.name.endsWith('.prefPane') ||
        entry.name.endsWith('.bundle') ||
        entry.name.endsWith('.plugin')
      ) continue;

      if (current.depth < maxDepth) {
        queue.push({ dir: fullPath, depth: current.depth + 1 });
      }
    }
  }
  return results;
}

function isPathInsideRoots(targetPath: string, roots: string[]): boolean {
  const resolvedTarget = path.resolve(targetPath);
  for (const root of roots) {
    const resolvedRoot = path.resolve(root);
    if (resolvedTarget === resolvedRoot) return true;
    if (resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) return true;
  }
  return false;
}

async function discoverAppBundlesViaSpotlight(allowedRoots: string[]): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      `/usr/bin/mdfind "kMDItemContentTypeTree == 'com.apple.application-bundle'" 2>/dev/null`
    );
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((p) => p.endsWith('.app') && !p.includes('.app/') && fs.existsSync(p))
      .filter((p) => isPathInsideRoots(p, allowedRoots));
  } catch {
    return [];
  }
}

// ─── Search Terms ───────────────────────────────────────────────────

function getLocaleCandidates(): string[] {
  const set = new Set<string>();
  const locale = String(Intl.DateTimeFormat().resolvedOptions().locale || '')
    .replace('-', '_').trim();
  const envLang = String(process.env.LANG || '')
    .split('.').shift()?.replace('-', '_').trim();

  if (locale) { set.add(locale); const base = locale.split('_')[0]; if (base) set.add(base); }
  if (envLang) { set.add(envLang); const base = envLang.split('_')[0]; if (base) set.add(base); }
  set.add('en_US'); set.add('en_GB'); set.add('en');
  return Array.from(set);
}

function resolveSearchTermsFile(bundlePath: string, searchTermsFileName?: string): string | undefined {
  const resourcesDir = path.join(bundlePath, 'Contents', 'Resources');
  if (!fs.existsSync(resourcesDir)) return undefined;

  const fileStem = String(searchTermsFileName || '').trim();
  const localeCandidates = getLocaleCandidates();
  if (fileStem) {
    for (const locale of localeCandidates) {
      const candidate = path.join(resourcesDir, `${locale}.lproj`, `${fileStem}.searchTerms`);
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  for (const locale of localeCandidates) {
    const lprojDir = path.join(resourcesDir, `${locale}.lproj`);
    if (!fs.existsSync(lprojDir)) continue;
    try {
      const files = fs.readdirSync(lprojDir).filter((f) => f.endsWith('.searchTerms'));
      if (files.length > 0) return path.join(lprojDir, files[0]);
    } catch {}
  }
  return undefined;
}

function splitSearchKeywords(value: string): string[] {
  return String(value || '')
    .split(',')
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length >= 2);
}

function makeSettingsItemId(input: string): string {
  return `settings-item-${crypto.createHash('md5').update(input).digest('hex').slice(0, 12)}`;
}

function buildSettingsKeywords(
  title: string,
  bundleId?: string,
  legacyBundleId?: string,
  extraKeywords: string[] = []
): string[] {
  const lowerTitle = title.toLowerCase();
  const set = new Set<string>(['system settings', 'preferences', lowerTitle]);
  if (bundleId) set.add(bundleId);
  if (legacyBundleId) set.add(legacyBundleId);
  for (const keyword of extraKeywords) {
    const k = String(keyword || '').trim().toLowerCase();
    if (k) set.add(k);
  }
  return Array.from(set);
}

// ─── Mac Implementation ─────────────────────────────────────────────

class MacCommandsDiscovery implements CommandsDiscoveryAPI {
  async discoverApplications(): Promise<AppInfo[]> {
    const results: AppInfo[] = [];

    const appDirs = [
      '/Applications',
      '/System/Applications',
      '/System/Applications/Utilities',
      path.join(process.env.HOME || '', 'Applications'),
    ];

    const appPathsSet = new Set<string>();
    const spotlightPaths = await discoverAppBundlesViaSpotlight(appDirs);
    for (const appPath of spotlightPaths) appPathsSet.add(appPath);
    for (const dir of appDirs) {
      for (const appPath of collectAppBundles(dir)) appPathsSet.add(appPath);
    }
    const finderPath = '/System/Library/CoreServices/Finder.app';
    if (fs.existsSync(finderPath)) appPathsSet.add(finderPath);

    const appPaths = Array.from(appPathsSet).sort((a, b) => a.localeCompare(b));
    const BATCH = 6;

    for (let i = 0; i < appPaths.length; i += BATCH) {
      const batch = appPaths.slice(i, i + BATCH);
      const items = await Promise.all(
        batch.map(async (appPath) => {
          const info = await readPlistJson(appPath);
          if (info) {
            const packageType = String(info.CFBundlePackageType || '').trim();
            const isFinder = appPath === finderPath;
            const isAllowedType = !packageType || packageType === 'APPL' || packageType === 'XPC!';
            if (!isAllowedType && !isFinder) return null;
            if (info.LSBackgroundOnly === true) return null;
          }

          const rawName = path.basename(appPath, '.app');
          const bundleId = typeof info?.CFBundleIdentifier === 'string'
            ? info.CFBundleIdentifier : undefined;
          const iconDataUrl = await this.getAppIcon(appPath);

          return {
            name: rawName,
            rawName,
            path: appPath,
            bundleId,
            iconDataUrl,
            _bundlePath: appPath,
          } as AppInfo;
        })
      );

      for (const item of items) {
        if (item) results.push(item);
      }
    }

    return results;
  }

  async discoverSystemSettings(): Promise<SettingsPaneInfo[]> {
    const results: SettingsPaneInfo[] = [];
    const seen = new Set<string>();

    // ── Source 1: .appex extensions (macOS Ventura+) ──
    const extDir = '/System/Library/ExtensionKit/Extensions';
    if (fs.existsSync(extDir)) {
      let files: string[];
      try { files = fs.readdirSync(extDir); } catch { files = []; }

      const allAppex = files.filter((f) => f.endsWith('.appex'));
      const BATCH = 6;

      for (let i = 0; i < allAppex.length; i += BATCH) {
        const batch = allAppex.slice(i, i + BATCH);
        const items = await Promise.all(
          batch.map(async (file) => {
            const extPath = path.join(extDir, file);
            const info = await readPlistJson(extPath);
            if (!info) return null;

            const exAttrs = info.EXAppExtensionAttributes || {};
            const extPoint = exAttrs.EXExtensionPointIdentifier;
            if (extPoint !== 'com.apple.Settings.extension.ui') return null;

            const settingsAttrs = exAttrs.SettingsExtensionAttributes || {};
            let displayName = info.CFBundleDisplayName || info.CFBundleName || '';
            const bundleId: string = info.CFBundleIdentifier || '';
            const legacyBundleId: string | undefined =
              typeof settingsAttrs.legacyBundleIdentifier === 'string'
                ? settingsAttrs.legacyBundleIdentifier : undefined;
            const searchTermsFileName: string | undefined =
              typeof settingsAttrs.searchTermsFileName === 'string'
                ? settingsAttrs.searchTermsFileName : undefined;
            const openIdentifier = legacyBundleId || bundleId;

            if (
              !displayName || displayName.includes('Intents') ||
              displayName.includes('Widget') || displayName.endsWith('DeviceExpert') ||
              bundleId.includes('intents') || bundleId.includes('widget') || !openIdentifier
            ) return null;

            displayName = canonicalSettingsTitle(displayName, bundleId);
            if (!displayName || displayName.length < 2) return null;

            const key = displayName.toLowerCase();
            if (seen.has(key)) return null;
            seen.add(key);

            const iconDataUrl = await this.getAppIcon(extPath);

            const pane: SettingsPaneInfo = {
              id: `settings-${key.replace(/[^a-z0-9]+/g, '-')}`,
              name: displayName,
              identifier: openIdentifier,
              bundlePath: extPath,
              bundleId,
              legacyBundleId,
              iconDataUrl,
              keywords: buildSettingsKeywords(displayName, bundleId, legacyBundleId),
            };

            // Discover search term sub-items
            const children = await this._discoverSearchTerms(
              extPath, pane, bundleId, legacyBundleId, searchTermsFileName
            );
            if (children.length > 0) pane.children = children;

            return pane;
          })
        );

        for (const item of items) {
          if (item) results.push(item);
        }
      }
    }

    // ── Source 2: .prefPane bundles ──
    const prefDirs = [
      '/System/Library/PreferencePanes',
      '/Library/PreferencePanes',
      path.join(process.env.HOME || '', 'Library', 'PreferencePanes'),
    ];

    for (const dir of prefDirs) {
      if (!fs.existsSync(dir)) continue;
      let entries: string[];
      try { entries = fs.readdirSync(dir); } catch { continue; }

      const panePaths: string[] = [];
      for (const entry of entries) {
        if (entry.endsWith('.prefPane')) panePaths.push(path.join(dir, entry));
      }

      const BATCH = 6;
      for (let i = 0; i < panePaths.length; i += BATCH) {
        const batch = panePaths.slice(i, i + BATCH);
        const items = await Promise.all(
          batch.map(async (panePath) => {
            const rawName = path.basename(panePath, '.prefPane');
            const paneInfo = await readPlistJson(panePath);
            const paneBundleId = typeof paneInfo?.CFBundleIdentifier === 'string'
              ? paneInfo.CFBundleIdentifier : undefined;
            const displayName = canonicalSettingsTitle(rawName, paneBundleId);
            const key = displayName.toLowerCase();
            if (seen.has(key)) return null;
            seen.add(key);

            const iconDataUrl = await this.getAppIcon(panePath);

            return {
              id: `settings-${key.replace(/[^a-z0-9]+/g, '-')}`,
              name: displayName,
              identifier: paneBundleId || rawName,
              bundlePath: panePath,
              bundleId: paneBundleId,
              iconDataUrl,
              keywords: buildSettingsKeywords(displayName, paneBundleId),
            } as SettingsPaneInfo;
          })
        );

        for (const item of items) {
          if (item) results.push(item);
        }
      }
    }

    return results;
  }

  async getAppIcon(bundlePath: string): Promise<string | undefined> {
    const cached = getCachedIcon(bundlePath);
    if (cached) return cached;

    const icnsResult = await getIconFromIcns(bundlePath);
    if (icnsResult) {
      setCachedIcon(bundlePath, icnsResult);
      return icnsResult;
    }
    return undefined;
  }

  async batchExtractIcons(bundlePaths: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (bundlePaths.length === 0) return result;

    const tmpDir = path.join(app.getPath('temp'), `launcher-ws-icons-${Date.now()}`);
    const tmpPathsFile = path.join(app.getPath('temp'), `launcher-icon-paths-${Date.now()}.json`);
    const tmpScript = path.join(app.getPath('temp'), `launcher-icon-script-${Date.now()}.js`);

    try {
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(tmpPathsFile, JSON.stringify(bundlePaths));

      const jxaScript = `
ObjC.import("AppKit");
ObjC.import("Foundation");

var inputPath = "${tmpPathsFile.replace(/"/g, '\\"')}";
var outputDir = "${tmpDir.replace(/"/g, '\\"')}";

var data = $.NSData.dataWithContentsOfFile(inputPath);
var str = ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding));
var paths = JSON.parse(str);

var ws = $.NSWorkspace.sharedWorkspace;
var results = {};

for (var i = 0; i < paths.length; i++) {
  try {
    var p = paths[i];
    var icon = ws.iconForFile(p);
    icon.setSize({width: 64, height: 64});
    var tiffData = icon.TIFFRepresentation;
    var bitmapRep = $.NSBitmapImageRep.imageRepWithData(tiffData);
    var pngData = bitmapRep.representationUsingTypeProperties(4, $({}));
    var outFile = outputDir + "/" + i + ".png";
    pngData.writeToFileAtomically(outFile, true);
    results[p] = outFile;
  } catch(e) {}
}

var resultStr = $.NSString.alloc.initWithUTF8String(JSON.stringify(results));
resultStr.writeToFileAtomicallyEncodingError(outputDir + "/map.json", true, 4, null);
`;
      fs.writeFileSync(tmpScript, jxaScript);
      await execAsync(`/usr/bin/osascript -l JavaScript "${tmpScript}" 2>/dev/null`);

      const mapFile = path.join(tmpDir, 'map.json');
      if (fs.existsSync(mapFile)) {
        const map: Record<string, string> = JSON.parse(fs.readFileSync(mapFile, 'utf-8'));

        for (const [bundlePath, pngFile] of Object.entries(map)) {
          try {
            await execAsync(`/usr/bin/sips -z 64 64 "${pngFile}" --out "${pngFile}" 2>/dev/null`);
            const pngBuf = fs.readFileSync(pngFile);
            if (pngBuf.length > 100) {
              const dataUrl = `data:image/png;base64,${pngBuf.toString('base64')}`;
              result.set(bundlePath, dataUrl);
              setCachedIcon(bundlePath, dataUrl);
            }
          } catch {}
        }
      }
    } catch (error) {
      console.warn('Batch icon extraction via NSWorkspace failed:', error);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      try { fs.unlinkSync(tmpPathsFile); } catch {}
      try { fs.unlinkSync(tmpScript); } catch {}
    }

    return result;
  }

  async readBundleInfo(bundlePath: string): Promise<Record<string, any> | null> {
    return readPlistJson(bundlePath);
  }

  async openApplication(appPath: string): Promise<void> {
    await shell.openPath(appPath);
  }

  // ─── Internal ───────────────────────────────────────────────────

  private async _discoverSearchTerms(
    bundlePath: string,
    pane: SettingsPaneInfo,
    bundleId?: string,
    legacyBundleId?: string,
    searchTermsFileName?: string
  ): Promise<SettingsPaneInfo[]> {
    const searchTermsFile = resolveSearchTermsFile(bundlePath, searchTermsFileName);
    if (!searchTermsFile) return [];

    const data = await readPlistFileJson(searchTermsFile);
    if (!data || typeof data !== 'object') return [];

    const commands: SettingsPaneInfo[] = [];
    const seen = new Set<string>();
    const paneTitleLower = String(pane.name || '').trim().toLowerCase();

    const addCommand = (title: string, extraKeywords: string[], sourceKey: string) => {
      const finalTitle = String(title || '').trim();
      if (finalTitle.length < 2) return;

      const dedupeKey = `${String(pane.identifier || '')}:${finalTitle.toLowerCase()}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);

      commands.push({
        id: makeSettingsItemId(`${dedupeKey}:${sourceKey}`),
        name: finalTitle,
        identifier: pane.identifier,
        bundlePath: pane.bundlePath,
        iconDataUrl: pane.iconDataUrl,
        keywords: buildSettingsKeywords(finalTitle, bundleId, legacyBundleId, extraKeywords),
      });
    };

    for (const [sectionRaw, sectionValue] of Object.entries(data)) {
      const sectionTitle = cleanPaneName(sectionRaw);
      const sectionKey = sectionRaw.toLowerCase();
      const sectionKeywords: string[] = [sectionKey];

      if (sectionTitle && sectionTitle.toLowerCase() !== paneTitleLower) {
        addCommand(sectionTitle, sectionKeywords, `section:${sectionRaw}`);
      }

      const rows = Array.isArray((sectionValue as any)?.localizableStrings)
        ? (sectionValue as any).localizableStrings
        : [];

      for (const row of rows) {
        const rowTitle = String(row?.title || '').trim();
        if (!rowTitle) continue;
        const keywords = [
          sectionKey,
          sectionTitle.toLowerCase(),
          ...splitSearchKeywords(String(row?.index || '')),
        ].filter(Boolean);
        addCommand(rowTitle, keywords, `${sectionRaw}:${rowTitle}`);
      }
    }

    return commands;
  }
}

export const macCommandsDiscovery = new MacCommandsDiscovery();
