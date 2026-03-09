import { defineConfig } from 'vite';
import path from 'path';


export default defineConfig((_) => {
  const targetOS = process.env.TARGET_OS;
  if (!targetOS) {
    throw new Error('TARGET_OS environment variable is not set');
  }
  return {
    resolve: {
      alias: {
        '@platform': path.resolve(__dirname, `src/platform/${targetOS}`)
      }
    },
    build: {
      ssr: true, // Indicates this is a Node.js build, not browser
      outDir: path.join(__dirname, 'dist/main'),
      emptyOutDir: true,
      lib: {
        entry: 'src/main/main.ts',
        formats: ['cjs'],
      },
      rollupOptions: {
        // Exclude Electron and Node.js built-ins from the bundle
        external: [
          'electron',
          'path',
          'fs',
          'os',
          'child_process',
          'crypto',
          // Exclude native modules
          'electron-liquid-glass',
          'node-window-manager',
          'node-edge-tts'
        ]
      }
    }
  }
});
