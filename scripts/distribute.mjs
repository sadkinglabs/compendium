// Push the current release APK to Firebase App Distribution.
//
//   npm run distribute -- ["release notes"]
//
// Targets dist-apk/compendium-<package.json version>.apk and reads the Firebase
// app id from android/app/google-services.json, so it always hits the right build
// without hardcoding either. Recipients come from env:
//   FAD_GROUP    a tester group (default "alpha-testers")
//   FAD_TESTERS  comma-separated emails (added directly, no group needed)
// At least one is used. Requires `npx firebase login` once, and App Distribution
// enabled in the Firebase console.
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root)));
const apk = `dist-apk/compendium-${pkg.version}.apk`;
if (!existsSync(fileURLToPath(new URL(apk, root)))) {
  console.error(`\n✗ APK not found: ${apk}\n  Build it first: (cd android && ./gradlew assembleRelease) then copy to dist-apk/compendium-${pkg.version}.apk\n`);
  process.exit(1);
}

const gsPath = new URL('android/app/google-services.json', root);
if (!existsSync(fileURLToPath(gsPath))) {
  console.error('\n✗ android/app/google-services.json missing - Firebase not set up.\n');
  process.exit(1);
}
const appId = JSON.parse(readFileSync(gsPath)).client?.[0]?.client_info?.mobilesdk_app_id;
if (!appId) { console.error('✗ Could not read mobilesdk_app_id from google-services.json'); process.exit(1); }

const notes = process.argv[2] || `Compendium ${pkg.version}`;
const args = ['appdistribution:distribute', apk, '--app', appId, '--release-notes', notes];
// Recipients: individual emails (auto-added, no group needed) and/or a group
// (must already exist in the console). If neither is set, fall back to the
// "alpha-testers" group - which you must have created first.
let hasRecipient = false;
if (process.env.FAD_TESTERS) { args.push('--testers', process.env.FAD_TESTERS); hasRecipient = true; }
if (process.env.FAD_GROUP) { args.push('--groups', process.env.FAD_GROUP); hasRecipient = true; }
if (!hasRecipient) args.push('--groups', 'alpha-testers');

// Run the CLI's JS entry through node (not the .cmd shim): Node 20+ rejects
// execFileSync on a .cmd (EINVAL) without a shell, and a shell would mangle the
// spaces in --release-notes. node + the .js entry sidesteps both, cross-platform.
const cliJs = fileURLToPath(new URL('node_modules/firebase-tools/lib/bin/firebase.js', root));
const recipients = [process.env.FAD_TESTERS, process.env.FAD_GROUP ? `group:${process.env.FAD_GROUP}` : (!process.env.FAD_TESTERS ? 'group:alpha-testers' : '')].filter(Boolean).join(', ');
console.log(`\n→ Distributing ${apk}\n  app:    ${appId}\n  notes:  ${notes}\n  to:     ${recipients}\n`);
execFileSync(process.execPath, [cliJs, ...args], { stdio: 'inherit', cwd: fileURLToPath(root) });
