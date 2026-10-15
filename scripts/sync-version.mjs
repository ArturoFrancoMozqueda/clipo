// Copies package.json "version" into the iOS project (Android reads it directly in build.gradle).
// Run by the cap:* scripts; `--check` only fails when they differ (used in CI).
import { readFile, writeFile } from 'node:fs/promises';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const [major, minor, patch] = version.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
const build = String(major * 10000 + minor * 100 + patch);
const file = 'ios/App/App.xcodeproj/project.pbxproj';
const before = await readFile(file, 'utf8');
const after = before
  .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`)
  .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${build};`);

if (process.argv.includes('--check')) {
  if (after !== before) {
    console.error(`La versión de iOS no coincide con package.json (${version}). Ejecuta: node scripts/sync-version.mjs`);
    process.exit(1);
  }
} else if (after !== before) {
  await writeFile(file, after);
  console.log(`iOS → ${version} (${build})`);
}
