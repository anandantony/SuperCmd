# Proposal: Platform Abstraction Layer for Future Cross-Platform Support

SuperCmd currently relies on macOS-specific native integrations (Swift helpers compiled via `npm run build:native`). While this works well for macOS, it tightly couples platform logic with the core application, which makes future platform support (such as Windows or Linux) significantly harder.

This proposal suggests introducing a **platform abstraction layer** to isolate OS-specific functionality from the rest of the application.

---

## Motivation

SuperCmd includes several platform-dependent features currently implemented through macOS-specific Swift binaries (compiled into `dist/native/`):

- **Clipboard monitoring** — native clipboard access
- **Global hotkeys** — hotkey monitor binary, also registered in `src/main/main.ts` via Electron's `globalShortcut`
- **Speech-to-text** — speech recognizer binary
- **Text-to-speech** — Swift-based TTS, alongside Edge TTS and ElevenLabs options
- **Color picker** — native color picker binary
- **Window manager** — window management binary
- **Accessibility integrations** — selected text/Finder item interactions
- **System / application interaction** — app discovery, script command execution

These are currently scattered across `src/main/main.ts` (IPC handlers, global shortcuts), `src/native/` (Swift source), and the build pipeline (`npm run build:native` → `dist/native/`). This results in:

- Platform logic mixed with application logic (e.g., Swift binary invocations embedded in main process IPC handlers)
- Difficulty introducing additional OS implementations without touching core files
- Higher maintenance complexity as the feature set grows

Introducing a platform abstraction layer would decouple these concerns and make the architecture more extensible — consistent with the project's principles of **progressive enhancement** and clear separation of concerns.

---

## Goals

- Separate platform-specific logic from core application logic
- Introduce a consistent interface layer for OS integrations
- Allow future platform implementations without major architectural changes
- Maintain full compatibility with the current macOS implementation and all existing Swift helpers

---

## Non-Goals

This proposal does **not** aim to:

- Implement Windows or Linux support immediately
- Change existing functionality or behavior
- Replace current macOS native integrations
- Affect the Raycast API compatibility layer in `src/renderer/src/raycast-api/`

The goal is strictly **architectural preparation for future platform support**.

---

## Proposed Architecture

Introduce a platform adapter layer between the core application and OS-specific implementations.

```
Core Application (src/main/main.ts, IPC handlers)
        ↓
Platform Interfaces (src/platform/interfaces/)
        ↓
Platform Implementations
  ├── src/platform/mac/       ← wraps existing Swift binaries in dist/native/
  ├── src/platform/windows/   ← future
  └── src/platform/linux/     ← future
```

The core application interacts only with interfaces. Each platform provides its own implementation, and the macOS implementation is a thin wrapper around the existing `dist/native/` binaries — **no behavior changes**.

---

## Proposed File Structure

```
src/
  main/
    main.ts              ← unchanged entry point; imports from platform adapter
    ai-provider.ts       ← unchanged
    commands.ts          ← unchanged
    ...
  platform/
    index.ts             ← re-exports the active platform implementation
    interfaces/
      clipboard.ts
      hotkeys.ts
      speech.ts
      tts.ts
      color-picker.ts
      window-manager.ts
      accessibility.ts
      system.ts
    mac/
      index.ts           ← assembles macOS platform object
      clipboard.ts       ← wraps existing dist/native/ binary calls
      hotkeys.ts
      speech.ts
      tts.ts
      color-picker.ts
      window-manager.ts
      accessibility.ts
      system.ts
    windows/             ← skeleton only (no implementation yet)
      index.ts
      clipboard.ts
      ...
  native/
    mac/                 ← existing Swift sources, moved here (no changes to content)
      clipboard/
      hotkey-monitor/
      speech-recognizer/
      tts/
      color-picker/
      window-manager/
    windows/             ← future native addons (e.g. Win32 via node-addon-api)
    linux/               ← future native addons
```

**Key point:** `src/platform/mac/` implementations are thin wrappers around the existing Swift binary invocations. The Swift sources themselves are simply relocated from `src/native/` into `src/native/mac/` — **no content changes**, only a folder move. The `build:native` script path references would be updated accordingly.

---

## Example Interfaces

### Clipboard

```typescript
// src/platform/interfaces/clipboard.ts
export interface ClipboardAPI {
  read(): Promise<string>;
  write(text: string): Promise<void>;
  startMonitoring(callback: (text: string) => void): void;
  stopMonitoring(): void;
}
```

### Hotkeys

```typescript
// src/platform/interfaces/hotkeys.ts
export interface HotkeysAPI {
  register(shortcut: string, callback: () => void): void;
  unregister(shortcut: string): void;
  unregisterAll(): void;
}
```

### Speech-to-Text

```typescript
// src/platform/interfaces/speech.ts
export interface SpeechAPI {
  startListening(): Promise<void>;
  stopListening(): Promise<string>;
  isAvailable(): Promise<boolean>;
}
```

### Platform Object

```typescript
// src/platform/interfaces/platform.ts
export interface Platform {
  clipboard: ClipboardAPI;
  hotkeys: HotkeysAPI;
  speech: SpeechAPI;
  tts: TTSAPI;
  colorPicker: ColorPickerAPI;
  windowManager: WindowManagerAPI;
  accessibility: AccessibilityAPI;
  system: SystemAPI;
}
```

---

## Build-Time Platform Resolution

Platform implementations can be resolved at **build time** using Vite/esbuild aliasing rather than runtime `process.platform` checks.

In `vite.config.ts` / esbuild config for the main process:

```typescript
// Build-time alias example
resolve: {
  alias: {
    '@platform': path.resolve(__dirname, `src/platform/${process.platform === 'darwin' ? 'mac' : process.platform}`)
  }
}
```

Usage in core code:

```typescript
// src/main/main.ts (after refactor)
import { platform } from '@platform';

platform.hotkeys.register('Cmd+Shift+Space', () => toggleWindow());
platform.clipboard.startMonitoring((text) => handleClipboard(text));
```

**Benefits:**

- Smaller bundles (only the active platform's code is included)
- No runtime `process.platform` branching in core logic
- Clearer platform boundaries
- Easier to test: mock the `@platform` alias in tests

---

## Migration Plan

This refactor can be implemented incrementally to avoid disrupting the current macOS implementation:

1. **Reorganize `src/native/`** — move existing Swift sources into `src/native/mac/`; update `build:native` script paths. No content changes to Swift files.
2. **Introduce interface definitions** in `src/platform/interfaces/` — TypeScript only, no runtime impact
3. **Create `src/platform/mac/`** by extracting existing Swift binary invocations from `main.ts` and `commands.ts` into typed wrappers — behavior is identical
4. **Add build-time alias** pointing `@platform` to `src/platform/mac/`
5. **Update `src/main/main.ts`** to import from `@platform` instead of calling binaries directly — same logic, different import path
6. **Add `src/platform/windows/` and `src/native/windows/` skeletons** with `throw new Error('Not implemented')` stubs — satisfies the interface, no functionality change
7. **Validate** with `npm run build` and `npm run dev` that all existing behavior is preserved

This ensures **zero disruption to the current macOS implementation** and no changes to the Raycast extension compatibility layer.

---

## Affected Files (Estimated Scope)

Based on the current project structure:

| File | Change |
|---|---|
| `src/main/main.ts` | Replace direct Swift binary calls with `platform.*` calls |
| `src/main/commands.ts` | Replace direct system calls with `platform.system.*` |
| `vite.config.ts` | Add `@platform` alias |
| `src/platform/` (new) | All new files; macOS implementations are extracted from existing code |
| `src/native/` | Reorganized — Swift sources moved into `src/native/mac/`; no content changes |
| `build/` or `package.json` build scripts | Update `build:native` path references to point to `src/native/mac/` |
| `dist/native/` | **Untouched** — compiled binary output location remains as-is |
| `src/renderer/` | **Untouched** — renderer and Raycast API shims unaffected |

---

## Benefits

- Clear separation between platform and application logic
- Improved maintainability for `main.ts` (currently a large file with mixed concerns)
- No disruption to the existing `npm run build:native` pipeline
- Enables future Windows and Linux support with well-defined contribution points
- Encourages broader community contributions — contributors can implement a single platform module without understanding the whole codebase
- Consistent with the existing principle of keeping system-level logic in `src/main/`

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Refactor touches `main.ts` which is the core entry point | Introduce abstraction gradually; each module can be migrated independently in separate PRs |
| Platform interfaces may initially be incomplete | Expand interfaces incrementally as new features require them; initial pass covers only the modules already backed by Swift binaries |
| Build alias introduces a new build dependency | Vite already supports `resolve.alias`; this is a minimal config change |
| Behavior regression in existing macOS features | macOS implementations are direct extractions of existing code; full manual testing on macOS before merging |

---

## Future Possibilities

Once the abstraction layer is in place, Windows support could be implemented using:

- **Win32 Clipboard APIs** (or Electron's built-in `clipboard` module as a starting point) → native addon in `src/native/windows/`
- **`RegisterHotKey`** via a native Node addon or `uiohook-napi` → `src/native/windows/hotkey-monitor/`
- **Windows Speech Recognition** / Azure Speech SDK → `src/native/windows/speech-recognizer/`
- **Windows UI Automation** for accessibility → `src/native/windows/accessibility/`

The `src/native/mac/` layout would serve as a structural template for each new platform's native directory.

However, this proposal focuses only on **introducing the abstraction layer**, not implementing additional platforms yet.

---

## Feedback

Feedback on the architecture and migration approach would be appreciated, especially regarding:

- Appropriate scope for the first abstraction pass (all modules at once vs. one module as a proof-of-concept PR)
- Whether `src/platform/` alongside `src/main/` is the preferred location, or within `src/main/platform/`
- Build-time alias vs. a lightweight runtime factory (e.g., `getPlatform()` returning the correct implementation)
- Which module to start with as a pilot — **clipboard** or **hotkeys** seem like the most self-contained candidates given the current `main.ts` structure
