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
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root)));
const apk = `dist-apk/compendium-${pkg.version}.apk`;
const apkPath = fileURLToPath(new URL(apk, root));
if (!existsSync(apkPath)) {
  console.error(`\n✗ APK not found: ${apk}\n  Build it first: (cd android && ./gradlew assembleRelease) then copy to dist-apk/compendium-${pkg.version}.apk\n`);
  process.exit(1);
}

// STALE-ARTIFACT GUARD. The filename is keyed only on version NAME (e.g.
// 1.0.2-alpha), which does not change between builds - so an OLD apk with the right
// name but a stale versionCode would otherwise be shipped. Verify the apk's embedded
// versionCode equals package.json.build, and refuse to distribute on a mismatch.
const embeddedVc = apkVersionCode(apkPath);
if (embeddedVc == null) {
  console.error(`\n✗ Cannot read the APK's versionCode (aapt2 not found in the Android SDK build-tools).\n  Set ANDROID_HOME / ANDROID_SDK_ROOT (or install build-tools) so distribution can prove the APK is build ${pkg.build}. Refusing to ship unverified.\n`);
  process.exit(1);
}
if (String(embeddedVc) !== String(pkg.build)) {
  console.error(`\n✗ Stale APK: ${apk} embeds versionCode ${embeddedVc}, but package.json build is ${pkg.build}.\n  Rebuild and copy the current release, then re-run:\n    (cd android && ./gradlew assembleRelease)\n    cp android/app/build/outputs/apk/release/app-release.apk ${apk}\n`);
  process.exit(1);
}
console.log(`✓ APK versionCode ${embeddedVc} matches build ${pkg.build}.`);

function apkVersionCode(p) {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
    || (process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Android\\Sdk` : null);
  if (!sdk) return null;
  const bt = `${sdk}/build-tools`;
  if (!existsSync(bt)) return null;
  for (const v of readdirSync(bt).sort().reverse()) {
    const exe = `${bt}/${v}/aapt2${process.platform === 'win32' ? '.exe' : ''}`;
    if (!existsSync(exe)) continue;
    try {
      const out = execFileSync(exe, ['dump', 'badging', p], { encoding: 'utf8' });
      const m = out.match(/versionCode='(\d+)'/);
      return m ? parseInt(m[1], 10) : null;
    } catch { return null; }
  }
  return null;
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
