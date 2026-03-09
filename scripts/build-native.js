const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const targetOS = process.env.TARGET_OS;

if (targetOS !== 'mac') {
  console.log(`Skipping native build for target OS: ${targetOS}`);
  process.exit(0);
}

const buildCommands = [
  'mkdir -p dist/native',
  'swiftc -O -o dist/native/color-picker src/native/mac/color-picker.swift -framework AppKit',
  'swiftc -O -o dist/native/snippet-expander src/native/mac/snippet-expander.swift -framework AppKit',
  'swiftc -O -o dist/native/hotkey-hold-monitor src/native/mac/hotkey-hold-monitor.swift -framework CoreGraphics -framework AppKit -framework Carbon',
  'swiftc -O -o dist/native/speech-recognizer src/native/mac/speech-recognizer.swift -framework Speech -framework AVFoundation',
  'swiftc -O -o dist/native/microphone-access src/native/mac/microphone-access.swift -framework AVFoundation',
  'swiftc -O -o dist/native/input-monitoring-request src/native/mac/input-monitoring-request.swift -framework CoreGraphics',
  'swiftc -O -o dist/native/window-adjust src/native/mac/window-adjust.swift -framework ApplicationServices -framework AppKit',
  'swiftc -O -o dist/native/calendar-events src/native/mac/calendar-events.swift -framework EventKit'
];

console.log('Building native macOS components...');

try {
  for (const cmd of buildCommands) {
    console.log(`Executing: ${cmd}`);
    execSync(cmd, { stdio: 'inherit' });
  }
  console.log('Native build completed successfully.');
} catch (error) {
  console.error('Failed to build native components:', error.message);
  process.exit(1);
}
