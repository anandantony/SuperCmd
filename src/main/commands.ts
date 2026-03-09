/**
 * Command Registry
 * 
 * Cross-platform command discovery and management.
 * Platform-specific application/settings discovery is delegated to the
 * platform abstraction layer via `platform.commandsDiscovery`.
 * 
 * This module handles:
 * - Cache management
 * - CommandInfo building and normalization
 * - System commands, extensions, script commands, quick links
 * - Command execution routing
 */

import { app, shell } from 'electron';
import { platform } from '@platform';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { discoverInstalledExtensionCommands } from './extension-runner';
import { discoverScriptCommands } from './script-command-runner';
import { getAllQuickLinks, getQuickLinkCommandId, type QuickLink, type QuickLinkIcon } from './quicklink-store';
import { loadSettings } from './settings-store';

export interface CommandInfo {
  id: string;
  title: string;
  subtitle?: string;
  keywords?: string[];
  iconDataUrl?: string;
  iconEmoji?: string;
  iconName?: string;
  category: 'app' | 'settings' | 'system' | 'extension' | 'script';
  /** .app path for apps, bundle identifier for settings */
  path?: string;
  /** Extension command mode, e.g. view/no-view/menu-bar */
  mode?: string;
  /** Background refresh interval from manifest, e.g. 1m, 12h */
  interval?: string;
  /** Whether command should start disabled until user enables it */
  disabledByDefault?: boolean;
  /** Whether user confirmation is required before execution */
  needsConfirmation?: boolean;
  /** Argument definitions (used by script commands and extension no-view setup) */
  commandArgumentDefinitions?: Array<{
    name: string;
    required?: boolean;
    type?: string;
    placeholder?: string;
    title?: string;
    data?: Array<{ title?: string; value?: string }>;
  }>;
  /** Bundle path on disk (used for icon extraction) */
  _bundlePath?: string;
}

// ─── Cache ──────────────────────────────────────────────────────────

let cachedCommands: CommandInfo[] | null = null;
let cacheTimestamp = 0;
let inflightDiscovery: Promise<CommandInfo[]> | null = null;
let lastStaleRefreshRequestAt = 0;
const CACHE_TTL = 30 * 60_000; // 30 min
const STALE_REFRESH_COOLDOWN_MS = 15_000;

// ─── Helpers ────────────────────────────────────────────────────────

function canonicalAppTitle(name: string): string {
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (key === 'supercmd' || key === 'supercmd') return 'SuperCmd';
  return name;
}

function normalizeAppSearchText(value: string): string {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function buildAppKeywords(
  displayName: string,
  rawName: string,
  bundleId?: string
): string[] {
  const set = new Set<string>();
  const add = (value: string) => {
    const normalized = normalizeAppSearchText(value);
    if (normalized) set.add(normalized);
  };

  add(displayName);
  add(rawName);
  if (bundleId) add(bundleId);

  const compactRaw = rawName.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (compactRaw) set.add(compactRaw);

  const values = Array.from(set);
  for (const value of values) {
    for (const token of value.split(/\s+/g)) {
      if (token.length >= 2) set.add(token);
    }
  }

  return Array.from(set);
}

function resolveQuickLinkIconName(icon: QuickLinkIcon): string | undefined {
  const raw = String(icon || '').trim();
  if (!raw) return undefined;
  const normalized = raw.toLowerCase();
  if (normalized === 'default') return undefined;
  if (normalized === 'link') return 'Link';
  if (normalized === 'globe') return 'Globe';
  if (normalized === 'search') return 'Search';
  if (normalized === 'bolt') return 'Bolt';
  return raw.slice(0, 80);
}

function resolveQuickLinkIconDataUrl(quickLink: QuickLink, iconName?: string): string | undefined {
  if (iconName) return undefined;
  return quickLink.appIconDataUrl;
}

function buildQuickLinkKeywords(quickLink: QuickLink): string[] {
  const set = new Set<string>();
  const add = (value: string | undefined) => {
    const normalized = String(value || '').trim();
    if (!normalized) return;
    set.add(normalized);
  };

  add('quick link');
  add('quicklink');
  add(quickLink.name);
  add(quickLink.applicationName);
  add(quickLink.urlTemplate);

  const hostCandidate = quickLink.urlTemplate.replace(/\{[^}]+\}/g, 'placeholder');
  try {
    const host = new URL(hostCandidate).hostname.trim();
    if (host) add(host);
  } catch {}

  return Array.from(set);
}

// ─── Discovery (via platform layer) ─────────────────────────────────

async function discoverApplications(): Promise<CommandInfo[]> {
  const results: CommandInfo[] = [];
  const usedIds = new Set<string>();

  const apps = await platform.commandsDiscovery.discoverApplications();

  for (const appInfo of apps) {
    const name = canonicalAppTitle(appInfo.name);
    const key = name.toLowerCase().replace(/\s+/g, ' ').trim();
    const slug = key.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
    const idSuffix = crypto.createHash('md5').update(appInfo.path).digest('hex').slice(0, 8);
    const baseId = `app-${slug}`;
    const id = usedIds.has(baseId) ? `${baseId}-${idSuffix}` : baseId;
    usedIds.add(id);

    results.push({
      id,
      title: name,
      keywords: buildAppKeywords(name, appInfo.rawName, appInfo.bundleId),
      iconDataUrl: appInfo.iconDataUrl,
      category: 'app',
      path: appInfo.path,
      _bundlePath: appInfo._bundlePath || appInfo.path,
    });
  }

  // Add subtitles for duplicate titles
  const titleCounts = new Map<string, number>();
  for (const item of results) {
    const key = item.title.toLowerCase();
    titleCounts.set(key, (titleCounts.get(key) || 0) + 1);
  }
  for (const item of results) {
    if (!item.path) continue;
    if ((titleCounts.get(item.title.toLowerCase()) || 0) <= 1) continue;
    item.subtitle = path.dirname(item.path);
  }

  return results;
}

async function discoverSystemSettings(): Promise<CommandInfo[]> {
  const results: CommandInfo[] = [];

  const panes = await platform.commandsDiscovery.discoverSystemSettings();

  for (const pane of panes) {
    results.push({
      id: pane.id,
      title: pane.name,
      keywords: pane.keywords,
      iconDataUrl: pane.iconDataUrl,
      category: 'settings',
      path: pane.identifier,
      _bundlePath: pane.bundlePath,
    });

    // Add child items (search term sub-commands)
    if (pane.children) {
      for (const child of pane.children) {
        results.push({
          id: child.id,
          title: child.name,
          subtitle: pane.name,
          keywords: child.keywords,
          iconDataUrl: child.iconDataUrl || pane.iconDataUrl,
          category: 'settings',
          path: child.identifier,
          _bundlePath: child.bundlePath,
        });
      }
    }
  }

  return results;
}

// ─── Command Execution ──────────────────────────────────────────────

async function openAppByPath(appPath: string): Promise<void> {
  await platform.commandsDiscovery.openApplication(appPath);
}

async function openSettingsPane(identifier: string): Promise<void> {
  await platform.system.openSettingsPane(identifier);
}

// ─── Public API ─────────────────────────────────────────────────────

async function discoverAndBuildCommands(): Promise<CommandInfo[]> {
  const t0 = Date.now();
  console.log('Discovering applications and settings…');

  const apps = await discoverApplications();
  const settings = await discoverSystemSettings();

  apps.sort((a, b) => a.title.localeCompare(b.title));
  settings.sort((a, b) => a.title.localeCompare(b.title));

  const systemCommands: CommandInfo[] = [
    {
      id: 'system-cursor-prompt',
      title: 'Inline AI Prompt',
      keywords: ['ai', 'prompt', 'cursor', 'inline', 'rewrite', 'edit', 'command+shift+k'],
      category: 'system',
    },
    {
      id: 'system-add-to-memory',
      title: 'Add This to Memory',
      keywords: ['memory', 'supermemory', 'selected text', 'remember', 'save context'],
      category: 'system',
    },
    {
      id: 'system-clipboard-manager',
      title: 'Clipboard History',
      keywords: ['clipboard', 'history', 'copy', 'paste', 'manager'],
      category: 'system',
    },
    {
      id: 'system-open-settings',
      title: 'SuperCmd Settings',
      keywords: ['settings', 'preferences', 'config', 'configuration', 'supercmd'],
      category: 'system',
    },
    {
      id: 'system-open-ai-settings',
      title: 'SuperCmd AI',
      keywords: ['ai', 'model', 'provider', 'openai', 'anthropic', 'gemini', 'ollama', 'supercmd'],
      category: 'system',
    },
    {
      id: 'system-supercmd-whisper',
      title: 'SuperCmd Whisper',
      keywords: ['whisper', 'speech', 'voice', 'dictation', 'transcribe', 'overlay', 'supercmd'],
      category: 'system',
    },
    {
      id: 'system-supercmd-speak',
      title: 'SuperCmd Read',
      keywords: ['speak', 'tts', 'read', 'selected text', 'edge-tts', 'speechify', 'jarvis', 'supercmd'],
      category: 'system',
    },
    {
      id: 'system-window-management',
      title: 'Window Management',
      keywords: ['window', 'manage', 'tile', 'snap', 'top left', 'top right', 'bottom left', 'bottom right', 'third', 'fourth', 'sixth', 'grid', 'auto organize'],
      category: 'system',
    },
    { id: 'system-window-management-left', title: 'Window: Left Half', keywords: ['window', 'management', 'left', 'half', 'tile', 'snap'], category: 'system' },
    { id: 'system-window-management-right', title: 'Window: Right Half', keywords: ['window', 'management', 'right', 'half', 'tile', 'snap'], category: 'system' },
    { id: 'system-window-management-top', title: 'Window: Top Half', keywords: ['window', 'management', 'top', 'half', 'tile', 'snap'], category: 'system' },
    { id: 'system-window-management-bottom', title: 'Window: Bottom Half', keywords: ['window', 'management', 'bottom', 'half', 'tile', 'snap'], category: 'system' },
    { id: 'system-window-management-center', title: 'Window: Center', keywords: ['window', 'management', 'center', 'middle', 'resize'], category: 'system' },
    { id: 'system-window-management-center-80', title: 'Window: Almost Maximize', keywords: ['window', 'management', 'center', 'middle', '80%', 'resize', 'almost maximize'], category: 'system' },
    { id: 'system-window-management-fill', title: 'Window: Maximize', keywords: ['window', 'management', 'maximize', 'fill', 'fullscreen'], category: 'system' },
    { id: 'system-window-management-top-left', title: 'Window: Top Left', keywords: ['window', 'management', 'top', 'left', 'quadrant'], category: 'system' },
    { id: 'system-window-management-top-right', title: 'Window: Top Right', keywords: ['window', 'management', 'top', 'right', 'quadrant'], category: 'system' },
    { id: 'system-window-management-bottom-left', title: 'Window: Bottom Left', keywords: ['window', 'management', 'bottom', 'left', 'quadrant'], category: 'system' },
    { id: 'system-window-management-bottom-right', title: 'Window: Bottom Right', keywords: ['window', 'management', 'bottom', 'right', 'quadrant'], category: 'system' },
    { id: 'system-window-management-first-third', title: 'Window: First Third', keywords: ['window', 'management', 'first', 'third', 'left third', 'tile', 'snap'], category: 'system' },
    { id: 'system-window-management-center-third', title: 'Window: Center Third', keywords: ['window', 'management', 'center', 'third', 'middle third', 'tile', 'snap'], category: 'system' },
    { id: 'system-window-management-last-third', title: 'Window: Last Third', keywords: ['window', 'management', 'last', 'third', 'right third', 'tile', 'snap'], category: 'system' },
    { id: 'system-window-management-first-two-thirds', title: 'Window: First Two Thirds', keywords: ['window', 'management', 'first', 'two thirds', 'left two thirds', 'tile', 'snap'], category: 'system' },
    { id: 'system-window-management-center-two-thirds', title: 'Window: Center Two Thirds', keywords: ['window', 'management', 'center', 'two thirds', 'middle', 'tile', 'snap'], category: 'system' },
    { id: 'system-window-management-last-two-thirds', title: 'Window: Last Two Thirds', keywords: ['window', 'management', 'last', 'two thirds', 'right two thirds', 'tile', 'snap'], category: 'system' },
    { id: 'system-window-management-first-fourth', title: 'Window: First Fourth', keywords: ['window', 'management', 'first', 'fourth', 'left fourth', 'tile', 'snap'], category: 'system' },
    { id: 'system-window-management-second-fourth', title: 'Window: Second Fourth', keywords: ['window', 'management', 'second', 'fourth', 'tile', 'snap'], category: 'system' },
    { id: 'system-window-management-third-fourth', title: 'Window: Third Fourth', keywords: ['window', 'management', 'third', 'fourth', 'tile', 'snap'], category: 'system' },
    { id: 'system-window-management-last-fourth', title: 'Window: Last Fourth', keywords: ['window', 'management', 'last', 'fourth', 'right fourth', 'tile', 'snap'], category: 'system' },
    { id: 'system-window-management-first-three-fourths', title: 'Window: First Three Fourths', keywords: ['window', 'management', 'first', 'three fourths', 'left three fourths', 'tile', 'snap'], category: 'system' },
    { id: 'system-window-management-center-three-fourths', title: 'Window: Center Three Fourths', keywords: ['window', 'management', 'center', 'three fourths', 'middle', 'tile', 'snap'], category: 'system' },
    { id: 'system-window-management-last-three-fourths', title: 'Window: Last Three Fourths', keywords: ['window', 'management', 'last', 'three fourths', 'right three fourths', 'tile', 'snap'], category: 'system' },
    { id: 'system-window-management-top-left-sixth', title: 'Window: Top Left Sixth', keywords: ['window', 'management', 'top', 'left', 'sixth', 'grid'], category: 'system' },
    { id: 'system-window-management-top-center-sixth', title: 'Window: Top Center Sixth', keywords: ['window', 'management', 'top', 'center', 'sixth', 'grid'], category: 'system' },
    { id: 'system-window-management-top-right-sixth', title: 'Window: Top Right Sixth', keywords: ['window', 'management', 'top', 'right', 'sixth', 'grid'], category: 'system' },
    { id: 'system-window-management-bottom-left-sixth', title: 'Window: Bottom Left Sixth', keywords: ['window', 'management', 'bottom', 'left', 'sixth', 'grid'], category: 'system' },
    { id: 'system-window-management-bottom-center-sixth', title: 'Window: Bottom Center Sixth', keywords: ['window', 'management', 'bottom', 'center', 'sixth', 'grid'], category: 'system' },
    { id: 'system-window-management-bottom-right-sixth', title: 'Window: Bottom Right Sixth', keywords: ['window', 'management', 'bottom', 'right', 'sixth', 'grid'], category: 'system' },
    { id: 'system-window-management-increase-size-10', title: 'Window: Increase Size by 10%', keywords: ['window', 'management', 'increase', 'size', '10%'], category: 'system' },
    { id: 'system-window-management-decrease-size-10', title: 'Window: Decrease Size by 10%', keywords: ['window', 'management', 'decrease', 'size', '10%'], category: 'system' },
    { id: 'system-window-management-increase-left-10', title: 'Window: Increase Left by 10%', keywords: ['window', 'management', 'increase', 'left', '10%'], category: 'system' },
    { id: 'system-window-management-increase-right-10', title: 'Window: Increase Right by 10%', keywords: ['window', 'management', 'increase', 'right', '10%'], category: 'system' },
    { id: 'system-window-management-increase-top-10', title: 'Window: Increase Top by 10%', keywords: ['window', 'management', 'increase', 'top', '10%'], category: 'system' },
    { id: 'system-window-management-increase-bottom-10', title: 'Window: Increase Bottom by 10%', keywords: ['window', 'management', 'increase', 'bottom', '10%'], category: 'system' },
    { id: 'system-window-management-decrease-left-10', title: 'Window: Decrease Left by 10%', keywords: ['window', 'management', 'decrease', 'left', '10%'], category: 'system' },
    { id: 'system-window-management-decrease-right-10', title: 'Window: Decrease Right by 10%', keywords: ['window', 'management', 'decrease', 'right', '10%'], category: 'system' },
    { id: 'system-window-management-decrease-top-10', title: 'Window: Decrease Top by 10%', keywords: ['window', 'management', 'decrease', 'top', '10%'], category: 'system' },
    { id: 'system-window-management-decrease-bottom-10', title: 'Window: Decrease Bottom by 10%', keywords: ['window', 'management', 'decrease', 'bottom', '10%'], category: 'system' },
    { id: 'system-window-management-move-up-10', title: 'Window: Move Up by 10%', keywords: ['window', 'management', 'move', 'up', '10%'], category: 'system' },
    { id: 'system-window-management-move-down-10', title: 'Window: Move Down by 10%', keywords: ['window', 'management', 'move', 'down', '10%'], category: 'system' },
    { id: 'system-window-management-move-left-10', title: 'Window: Move Left by 10%', keywords: ['window', 'management', 'move', 'left', '10%'], category: 'system' },
    { id: 'system-window-management-move-right-10', title: 'Window: Move Right by 10%', keywords: ['window', 'management', 'move', 'right', '10%'], category: 'system' },
    {
      id: 'system-open-extensions-settings',
      title: 'SuperCmd Extensions',
      keywords: ['extensions', 'store', 'community', 'hotkey', 'supercmd'],
      category: 'system',
    },
    {
      id: 'system-open-onboarding',
      title: 'SuperCmd Onboarding',
      keywords: ['welcome', 'onboarding', 'intro', 'setup', 'supercmd'],
      category: 'system',
    },
    {
      id: 'system-quit-launcher',
      title: 'Quit SuperCmd',
      keywords: ['exit', 'close', 'quit', 'stop'],
      category: 'system',
    },
    {
      id: 'system-create-snippet',
      title: 'Create Snippet',
      keywords: ['snippet', 'create', 'new', 'text expansion'],
      category: 'system',
    },
    {
      id: 'system-search-snippets',
      title: 'Search Snippets',
      keywords: ['snippet', 'search', 'find', 'text expansion'],
      category: 'system',
    },
    {
      id: 'system-create-quicklink',
      title: 'Create Quick Link',
      keywords: ['quick link', 'quicklink', 'create', 'new', 'url'],
      category: 'system',
    },
    {
      id: 'system-search-quicklinks',
      title: 'Search Quick Links',
      keywords: ['quick link', 'quicklink', 'search', 'find', 'url'],
      category: 'system',
    },
    {
      id: 'system-search-files',
      title: 'Search Files',
      keywords: ['files', 'finder', 'search', 'find', 'open'],
      category: 'system',
    },
    {
      id: 'system-my-schedule',
      title: 'My Schedule',
      keywords: ['calendar', 'schedule', 'agenda', 'events', 'today', 'upcoming'],
      category: 'system',
    },
    {
      id: 'system-camera',
      title: 'Open Camera',
      keywords: ['open', 'camera', 'photo', 'webcam', 'capture', 'picture'],
      category: 'system',
    },
    {
      id: 'system-create-script-command',
      title: 'Create Script Command',
      keywords: ['script', 'command', 'create', 'custom', 'raycast', 'shell'],
      category: 'system',
    },
    {
      id: 'system-open-script-commands',
      title: 'Open Script Commands Folder',
      keywords: ['script', 'command', 'folder', 'directory', 'raycast', 'custom'],
      category: 'system',
    },
    {
      id: 'system-import-snippets',
      title: 'Import Snippets',
      keywords: ['snippet', 'import', 'load', 'file'],
      category: 'system',
    },
    {
      id: 'system-export-snippets',
      title: 'Export Snippets',
      keywords: ['snippet', 'export', 'save', 'backup', 'file'],
      category: 'system',
    },
    {
      id: 'system-check-for-updates',
      title: 'Check for Updates',
      keywords: ['update', 'upgrade', 'version', 'download', 'install', 'supercmd'],
      category: 'system',
    },
  ];

  // Installed community extensions
  let extensionCommands: CommandInfo[] = [];
  try {
    extensionCommands = discoverInstalledExtensionCommands().map((ext) => ({
      id: ext.id,
      title: ext.title,
      subtitle: ext.extensionTitle,
      keywords: ext.keywords,
      iconDataUrl: ext.iconDataUrl,
      category: 'extension' as const,
      path: `${ext.extName}/${ext.cmdName}`,
      mode: ext.mode,
      interval: ext.interval,
      disabledByDefault: ext.disabledByDefault,
      commandArgumentDefinitions: ext.commandArgumentDefinitions || [],
    }));
  } catch (e) {
    console.error('Failed to discover installed extensions:', e);
  }

  // Raycast-compatible script commands
  let scriptCommands: CommandInfo[] = [];
  try {
    scriptCommands = discoverScriptCommands().map((script) => ({
      id: script.id,
      title: script.title,
      subtitle: script.packageName,
      keywords: script.keywords,
      iconDataUrl: script.iconDataUrl,
      iconEmoji: script.iconEmoji,
      category: 'script' as const,
      path: script.scriptPath,
      mode: script.mode,
      interval: script.interval,
      needsConfirmation: script.needsConfirmation,
      commandArgumentDefinitions: script.arguments.map((arg) => ({
        name: arg.name,
        required: arg.required,
        type: arg.type,
        placeholder: arg.placeholder,
        title: arg.placeholder,
        data: arg.data,
      })),
    }));
  } catch (e) {
    console.error('Failed to discover script commands:', e);
  }

  let quickLinkCommands: CommandInfo[] = [];
  try {
    const quickLinks = getAllQuickLinks();
    quickLinkCommands = await Promise.all(
      quickLinks.map(async (quickLink) => {
        const resolvedIconName = resolveQuickLinkIconName(quickLink.icon);
        let iconDataUrl = resolveQuickLinkIconDataUrl(quickLink, resolvedIconName);

        if (!resolvedIconName && quickLink.applicationPath) {
          const resolvedAppIconDataUrl = await platform.commandsDiscovery.getAppIcon(quickLink.applicationPath);
          if (resolvedAppIconDataUrl) {
            iconDataUrl = resolvedAppIconDataUrl;
          }
        }

        return {
          id: getQuickLinkCommandId(quickLink.id),
          title: quickLink.name,
          subtitle: quickLink.applicationName || 'Quick Link',
          keywords: buildQuickLinkKeywords(quickLink),
          iconDataUrl,
          iconName: iconDataUrl ? undefined : resolvedIconName,
          category: 'system' as const,
        };
      })
    );
  } catch (e) {
    console.error('Failed to discover quick links:', e);
  }

  const allCommands = [...apps, ...settings, ...extensionCommands, ...scriptCommands, ...quickLinkCommands, ...systemCommands];

  // ── Batch-extract icons via platform layer for bundles missing icons ──
  const bundlesNeedingIcon = allCommands.filter(
    (c) =>
      !c.iconDataUrl &&
      c._bundlePath &&
      (c.category === 'app' || c.category === 'settings')
  );

  if (bundlesNeedingIcon.length > 0) {
    console.log(`Extracting ${bundlesNeedingIcon.length} app/settings icons via platform layer…`);
    const bundlePaths = Array.from(new Set(bundlesNeedingIcon.map((c) => c._bundlePath!)));
    const iconMap = await platform.commandsDiscovery.batchExtractIcons(bundlePaths);

    for (const cmd of bundlesNeedingIcon) {
      const dataUrl = iconMap.get(cmd._bundlePath!);
      if (dataUrl) {
        cmd.iconDataUrl = dataUrl;
      }
    }
  }

  // Some settings bundles yield the same generic document icon.
  const settingsIconCounts = new Map<string, number>();
  for (const cmd of allCommands) {
    if (cmd.category !== 'settings' || !cmd.iconDataUrl || cmd.subtitle) continue;
    settingsIconCounts.set(cmd.iconDataUrl, (settingsIconCounts.get(cmd.iconDataUrl) || 0) + 1);
  }
  for (const cmd of allCommands) {
    if (cmd.category !== 'settings' || !cmd.iconDataUrl || cmd.subtitle) continue;
    if ((settingsIconCounts.get(cmd.iconDataUrl) || 0) >= 5) {
      cmd.iconDataUrl = undefined;
    }
  }

  // Clean up internal _bundlePath before caching
  for (const cmd of allCommands) {
    delete cmd._bundlePath;
  }

  // Runtime metadata overlays
  try {
    const loadedSettings = loadSettings();
    const commandMetadata = loadedSettings.commandMetadata || {};
    const commandAliases = loadedSettings.commandAliases || {};
    for (const cmd of allCommands) {
      if (!(cmd.category === 'script' && cmd.mode !== 'inline')) {
        const subtitle = String(commandMetadata[cmd.id]?.subtitle || '').trim();
        if (subtitle) {
          cmd.subtitle = subtitle;
        }
      }
      const alias = String(commandAliases[cmd.id] || '').trim();
      if (alias) {
        cmd.keywords = Array.from(new Set([...(cmd.keywords || []), alias]));
      }
    }
  } catch {}

  cachedCommands = allCommands;
  cacheTimestamp = Date.now();

  console.log(
    `Discovered ${apps.length} apps, ${settings.length} settings panes, ${extensionCommands.length} extension commands, ${scriptCommands.length} script commands, ${quickLinkCommands.length} quick links in ${Date.now() - t0}ms`
  );

  return cachedCommands;
}

function ensureBackgroundRefreshForStaleCache(): void {
  if (!cachedCommands) return;
  if (inflightDiscovery) return;
  const now = Date.now();
  if (now - lastStaleRefreshRequestAt < STALE_REFRESH_COOLDOWN_MS) return;
  lastStaleRefreshRequestAt = now;
  inflightDiscovery = discoverAndBuildCommands()
    .catch((error) => {
      console.warn('[Commands] Background refresh failed:', error);
      return cachedCommands || [];
    })
    .finally(() => {
      inflightDiscovery = null;
    });
}

export async function getAvailableCommands(): Promise<CommandInfo[]> {
  const now = Date.now();
  if (cachedCommands && now - cacheTimestamp < CACHE_TTL) {
    return cachedCommands;
  }

  if (cachedCommands) {
    ensureBackgroundRefreshForStaleCache();
    return cachedCommands;
  }

  if (inflightDiscovery) {
    return inflightDiscovery;
  }

  inflightDiscovery = discoverAndBuildCommands().finally(() => {
    inflightDiscovery = null;
  });
  return inflightDiscovery;
}

export async function executeCommand(id: string): Promise<boolean> {
  if (id === 'system-quit-launcher') {
    app.quit();
    return true;
  }

  const commands = await getAvailableCommands();
  const command = commands.find((c) => c.id === id);
  if (!command?.path) {
    console.error(`Command not found: ${id}`);
    return false;
  }

  try {
    if (command.category === 'app') {
      await openAppByPath(command.path);
    } else if (command.category === 'settings') {
      await openSettingsPane(command.path);
    }
    return true;
  } catch (error) {
    console.error(`Failed to execute command ${id}:`, error);
    return false;
  }
}

export function invalidateCache(): void {
  cachedCommands = null;
  cacheTimestamp = 0;
  lastStaleRefreshRequestAt = 0;
}
