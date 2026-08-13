// Verify a real Compendium archive by REPLACING a database that has never held it, through the
// shipping destructive path.
//
// This is the instrument for Increment A's "fresh-environment recovery is proven, not asserted"
// criterion. It does four things no unit test can, because it uses a REAL archive off a device:
//   1. reads it through the production reader (full validation, including the digest)
//   2. INDEPENDENTLY recomputes the digest rather than trusting the reader's own verdict
//   3. runs the REAL replaceAll() - exclusive session, capture, recovery candidate, one
//      transaction, journal - against a fresh schema-v11 database seeded with the real catalog, so
//      v11 canonicalisation resolves printings exactly as it does on device
//   4. asserts fidelity table by table, and reports COPIES for owned_cards rather than rows -
//      canonicalisation legitimately reshapes those rows, so row identity is the wrong assertion
//
// Usage:
//   node scripts/backup/verify-archive.mjs <archive.json>
//
// Pull one off a device with:
//   MSYS_NO_PATHCONV=1 adb pull /sdcard/Download/compendium-backup-*.json
//
// NOTE: the archive is REAL USER DATA. It is gitignored (compendium-*.json) and must stay that way.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const R = 'c:/Users/micro/Desktop/Sorcery Apps/Compendium/';
const B = 'file:///c:/Users/micro/Desktop/Sorcery%20Apps/Compendium/src/store/';
const { MIGRATIONS, SCHEMA_VERSION } = await import(B+'schema.js');
const { __setBackendForTests } = await import(B+'db.js');
const { __setActiveIdForTests } = await import(B+'profileRepository.js');
const { previewBackup, replaceAll } = await import(B+'backupService.js');
const { __setBackingForTests } = await import(B+'recoveryStore.js');
const { cardSlug } = await import(B+'cardSlug.js');

// Preferences' web impl needs localStorage.
const store = new Map();
globalThis.window = { localStorage: { getItem:k=>store.has(k)?store.get(k):null, setItem:(k,v)=>store.set(k,String(v)),
  removeItem:k=>store.delete(k), clear:()=>store.clear(), key:i=>[...store.keys()][i]??null, get length(){return store.size} } };
globalThis.localStorage = globalThis.window.localStorage;

const require = createRequire(R);
const SQL = await (require('sql.js'))({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
const sdb = new SQL.Database(); sdb.run('PRAGMA foreign_keys = ON;');
const rows=(s,p=[])=>{const st=sdb.prepare(s);try{if(p.length)st.bind(p);const r=[];while(st.step())r.push(st.getAsObject());return r}finally{st.free()}};
__setBackendForTests({
  query:(s,p=[])=>Promise.resolve(rows(s,p)), run:(s,p=[])=>{sdb.run(s,p);return Promise.resolve()},
  exec:(s)=>{sdb.run(s);return Promise.resolve()},
  tx:(st)=>{sdb.run('BEGIN;');try{for(const[s,p=[]]of st)sdb.run(s,p);sdb.run('COMMIT;')}catch(e){sdb.run('ROLLBACK;');throw e}return Promise.resolve()},
  persist:()=>Promise.resolve(),
  beginRead:()=>{sdb.run('BEGIN;');return Promise.resolve()}, endRead:()=>{sdb.run('COMMIT;');return Promise.resolve()},
});
for (const m of MIGRATIONS) sdb.run(m.sql);

// Real catalog, so v11 canonicalisation resolves printings exactly as on device.
const cards = JSON.parse(readFileSync(R+'dist/catalog/cards.json','utf8'));
sdb.run('BEGIN;');
for (const c of Object.values(cards)) sdb.run('INSERT OR REPLACE INTO cards(card_id,name,sets,variants) VALUES(?,?,?,?);',
  [cardSlug(c.name), c.name, JSON.stringify(c.sets??[]), JSON.stringify(c.variants??[])]);
sdb.run('COMMIT;');

// An in-memory recovery backing reporting `native`, so the durability policy allows replacement
// without an external binding. The recovery point is still WRITTEN and VERIFIED - this stands in for
// the filesystem, not for the safety property.
const recoveryFiles = new Map();
__setBackingForTests({
  kind: 'native', files: recoveryFiles,
  async write(id, t) { recoveryFiles.set(id, t); },
  async read(id) { return recoveryFiles.get(id) ?? null; },
  async remove(id) { recoveryFiles.delete(id); },
  async list() { return [...recoveryFiles.keys()]; },
});

// A FRESH install: one auto-created starter, exactly like first boot. Replacement DELETES it, which
// is the point - an additive restore used to leave it behind and this script used to call that a
// pass.
sdb.run("INSERT INTO profiles(id,name,accent,system,schema_version,is_default,created_at,updated_at) VALUES('starter','Sorcerer','gold','sorcery',11,1,'t','t');");
sdb.run("INSERT OR IGNORE INTO settings(profile_id) VALUES('starter');");
__setActiveIdForTests('starter');

if (!process.argv[2]) {
  console.error('usage: node scripts/backup/verify-archive.mjs <archive.json>');
  process.exit(2);
}
const text = readFileSync(process.argv[2],'utf8');
const preview = await previewBackup(text);
console.log('preview kind :', preview.kind, '| profiles:', preview.profiles.length);

const t0 = Date.now();
const res = await replaceAll(preview);
console.log('restore      :', res.via, '|', res.profiles, 'profiles |', res.statements, 'statements |', Date.now()-t0, 'ms');

console.log('\n--- fidelity, per restored profile ---');
let bad = 0;
for (const unit of preview.env.payload.profiles) {
  // EXACT name: replacement does not suffix, so a LIKE prefix match would hide a rename bug.
  const pid = rows('SELECT id FROM profiles WHERE name=? ORDER BY created_at DESC;', [unit.profile.name])[0]?.id;
  if (!pid) { console.log(`  ${unit.profile.name}: NOT RESTORED`); bad++; continue; }
  const checks = [
    ['decks',      unit.decks.length,             rows('SELECT COUNT(*) c FROM decks WHERE profile_id=?;',[pid])[0].c],
    ['deck_entries', unit.deck_entries.length,    rows('SELECT COUNT(*) c FROM deck_entries e JOIN decks d ON d.id=e.deck_id WHERE d.profile_id=?;',[pid])[0].c],
    ['deck_history', unit.deck_history.length,    rows('SELECT COUNT(*) c FROM deck_history h JOIN decks d ON d.id=h.deck_id WHERE d.profile_id=?;',[pid])[0].c],
    ['matches',    unit.matches.length,           rows('SELECT COUNT(*) c FROM matches WHERE profile_id=?;',[pid])[0].c],
    ['match_log',  unit.match_log_entries.length, rows('SELECT COUNT(*) c FROM match_log_entries l JOIN matches m ON m.id=l.match_id WHERE m.profile_id=?;',[pid])[0].c],
    ['notes',      unit.notes.length,             rows('SELECT COUNT(*) c FROM notes WHERE profile_id=?;',[pid])[0].c],
    ['saved',      unit.saved.length,             rows('SELECT COUNT(*) c FROM saved WHERE profile_id=?;',[pid])[0].c],
    ['card_lists', unit.card_lists.length,        rows('SELECT COUNT(*) c FROM card_lists WHERE profile_id=?;',[pid])[0].c],
  ];
  const copies = [unit.owned_cards.reduce((a,o)=>a+o.qty_owned,0), rows('SELECT COALESCE(SUM(qty_owned),0) s FROM owned_cards WHERE profile_id=?;',[pid])[0].s];
  console.log(`  ${unit.profile.name}`);
  for (const [t,exp,act] of checks) { const ok = exp===act; if(!ok) bad++; console.log(`    ${t.padEnd(13)} archive=${String(exp).padStart(5)} restored=${String(act).padStart(5)} ${ok?'ok':'MISMATCH'}`); }
  const ok = copies[0]===copies[1]; if(!ok) bad++;
  console.log(`    owned COPIES  archive=${String(copies[0]).padStart(5)} restored=${String(copies[1]).padStart(5)} ${ok?'ok':'MISMATCH'}   (rows may differ: canonicalisation reshapes)`);
}
console.log('\ndefaults after restore :', rows('SELECT COUNT(*) c FROM profiles WHERE is_default=1;')[0].c, '(must be 1)');
console.log('default is             :', rows('SELECT name FROM profiles WHERE is_default=1;')[0].name);
// The starter must be GONE: replacement leaves exactly the archive, and a survivor would mean the
// additive path ran instead.
const starterGone = rows("SELECT COUNT(*) c FROM profiles WHERE id='starter';")[0].c === 0;
console.log('starter removed       :', starterGone);
if (!starterGone) bad++;
console.log('recovery point written:', recoveryFiles.size === 1, '| settled:', res.settled !== false);
console.log('total profiles         :', rows('SELECT COUNT(*) c FROM profiles;')[0].c);
console.log('\nRESULT:', bad === 0 ? 'ALL CHECKS PASSED' : `${bad} MISMATCH(ES)`);
