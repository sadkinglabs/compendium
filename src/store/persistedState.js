// The persisted-state registry - §8 of docs/proposals/restore-semantics.md (Rev 4) as code.
// Increment 6: every key namespace this app persists, who owns it, and what happens to it when
// "Restore backup" REPLACES the device.
//
// WHY A MODULE AND NOT A DOCUMENT. A table in a proposal drifts the day after it is written; a
// table the replacement plan DERIVES ITS DELETES FROM cannot. replacePlan.js builds its delete
// phase from replacementDeletes() below, so a namespace cannot be deleted without an entry here
// saying so, and an entry whose disposition the planner has no semantics for throws instead of
// being silently skipped. persistedState.test.mjs closes the other direction: a persistence
// callsite in src/** whose key does not match a registered namespace fails the suite.
//
// PRESERVE BY DEFAULT. Deletion is targeted by ownership - only a `replace` or `re-key` entry
// is ever named by the replacement. Everything else, including every key NOBODY registered, is
// preserved by never being named. That default is the real safety property, because of the
//
// HONEST LIMIT: this registry and its scanner catch an unregistered NAMESPACE - a callsite the
// scanner's patterns recognise whose key nothing here matches. A key written through a pattern
// nobody taught the scanner is invisible to both. No enumeration can find the thing nobody
// thought of, which is exactly why unknown state is preserved rather than deleted.

/** Who a namespace belongs to. Ownership decides who MAY delete it, never that anything does. */
export const OWNERS = ['profile', 'device', 'catalog'];

/** What the replacement does to a namespace:
 *    replace    dies in the replacement tx; the archive's state takes its place
 *    re-key     profile-keyed: captured pids' keys are dropped in the tx, restored pids' written
 *    preserve   never named by the replacement - also the default for anything unregistered
 *    reconcile  not deleted; re-expressed against the restored state by the restore machinery
 *    exclude    device-install state that archives neither export nor restore
 */
export const DISPOSITIONS = ['replace', 're-key', 'preserve', 'reconcile', 'exclude'];

/** Where the bytes live. `sqlite` is the relational schema itself; `catalog_meta` and `_meta`
 *  are its two key-value tables; `preferences` is Capacitor Preferences (localStorage's
 *  `CapacitorStorage.*` on web); `nativePrefs` is Android SharedPreferences, which the WebView
 *  never sees; `files` is Directory.Data natively / per-purpose IndexedDB on web. */
export const STORES = ['sqlite', 'catalog_meta', '_meta', 'preferences', 'localStorage', 'nativePrefs', 'files'];

// `kind: 'prefix'` entries match every key that starts with the namespace; `key` is exact;
// `table`/`column` name relational surfaces the replacement must take a position on.
export const PERSISTED_STATE = Object.freeze([
  /* -------- sqlite - the relational schema -------- */
  {
    namespace: 'profiles', kind: 'table', store: 'sqlite', owner: 'profile', disposition: 'replace',
    reason: 'The point of a restore: DELETE FROM profiles cascades every profile-owned table, then the archive is inserted.',
  },
  {
    namespace: 'profiles.is_default', kind: 'column', store: 'sqlite', owner: 'profile', disposition: 'reconcile',
    reason: 'The Primary role is asserted from the archive inside the same transaction, so no committed state has zero Primaries.',
  },

  /* -------- _meta - install-scoped markers -------- */
  {
    namespace: 'schema_version', kind: 'key', store: '_meta', owner: 'device', disposition: 'preserve',
    reason: 'This install\'s schema position; archives migrate forward through prepareBundle instead of touching it.',
  },
  {
    namespace: 'owned_cards_canonical_version', kind: 'key', store: '_meta', owner: 'device', disposition: 'preserve',
    reason: 'Ledger canonicalisation marker; restored rows arrive canonical and the boot check is shape-first, so preserving cannot strand legacy rows.',
  },

  /* -------- catalog_meta - device/catalog key-value -------- */
  {
    namespace: 'version', kind: 'key', store: 'catalog_meta', owner: 'catalog', disposition: 'preserve',
    reason: 'The catalog is never touched by a restore (invariant §3.1).',
  },
  {
    namespace: 'dash_seeded:', kind: 'prefix', store: 'catalog_meta', owner: 'profile', disposition: 're-key',
    reason: 'Profile-keyed but outside the cascade\'s reach: captured pids\' keys are dropped in the tx, planProfileUnit writes the restored pids\'.',
  },
  {
    namespace: 'restore_pending', kind: 'key', store: 'catalog_meta', owner: 'device', disposition: 'reconcile',
    reason: 'The journal: written LAST inside the replacement tx, retired by startup reconciliation once the finish holds.',
  },
  {
    namespace: 'recovery_point', kind: 'key', store: 'catalog_meta', owner: 'device', disposition: 'preserve',
    reason: 'The pointer must outlive the data it protects - deleting it would orphan the recovery point.',
  },
  {
    namespace: 'highlights_migrated', kind: 'key', store: 'catalog_meta', owner: 'device', disposition: 'preserve',
    reason: 'Retired: nothing writes it and a migration deletes it; registered so the literal in schema.js stays accounted for.',
  },

  /* -------- Capacitor Preferences -------- */
  {
    namespace: 'activeProfileId', kind: 'key', store: 'preferences', owner: 'profile', disposition: 'reconcile',
    reason: 'Must never name a deleted profile: re-pointed via switchProfile(), the repository\'s own boundary.',
  },
  {
    namespace: 'changelogSeenBuild', kind: 'key', store: 'preferences', owner: 'device', disposition: 'exclude',
    reason: 'Install state: archives no longer export it and a restore never writes it (§8\'s resolved doc/code contradiction).',
  },

  /* -------- raw localStorage - non-authoritative UI/diagnostic state. NONE of these appear in
     §8's table; they are registered here as found (Increment 6's survey) and left preserved,
     because inventing a deletion the approved table never named is scope this increment does
     not have. The profile-keyed ones orphan on replacement - restored pids are fresh uuids, so
     a dead pid's key is unreachable litter, never wrong data. -------- */
  {
    namespace: 'cx-ongoing-match:', kind: 'prefix', store: 'localStorage', owner: 'profile', disposition: 'preserve',
    reason: 'Not in §8. Live-match snapshot keyed by pid; a deleted pid\'s key can never be read again, so it is preserved as inert litter.',
  },
  {
    namespace: 'cx-home-collapse:', kind: 'prefix', store: 'localStorage', owner: 'profile', disposition: 'preserve',
    reason: 'Not in §8. Home widget-collapse UI state keyed by pid; same unreachable-litter argument as cx-ongoing-match:.',
  },
  {
    namespace: 'cx-marg-collapse', kind: 'key', store: 'localStorage', owner: 'device', disposition: 'preserve',
    reason: 'Not in §8. Codex marginalia collapse state - a device UI preference with no profile identity in it.',
  },
  {
    namespace: 'cx-no-images', kind: 'key', store: 'localStorage', owner: 'device', disposition: 'preserve',
    reason: 'Not in §8. The zero-image diagnostic toggle (BUILD.md); device-scoped, never exported.',
  },

  /* -------- Android SharedPreferences - outside the WebView entirely -------- */
  {
    namespace: 'telemetry_consent', kind: 'key', store: 'nativePrefs', owner: 'device', disposition: 'exclude',
    reason: 'Consent in SharedPreferences "compendium_telemetry" (TelemetrySdk.kt); archives never carry it and JS cannot reach it.',
  },

  /* -------- file stores -------- */
  {
    namespace: 'recovery/', kind: 'prefix', store: 'files', owner: 'device', disposition: 'preserve',
    reason: 'Recovery point bytes (Directory.Data natively, the compendium_recovery IndexedDB on web); must survive the replacement they protect.',
  },
  {
    namespace: 'art/', kind: 'prefix', store: 'files', owner: 'catalog', disposition: 'preserve',
    reason: 'Not in §8. The on-device art cache (and its art-tmp/ staging); catalog-owned bytes refetchable from the CDN, never profile data.',
  },
].map(Object.freeze));

// Registration is only meaningful if a malformed entry cannot exist: an entry with a typo'd
// disposition failing HERE - at module load, under every gate that imports the plan - is the
// "adding a namespace without a disposition is a build failure" property, not a convention.
for (const e of PERSISTED_STATE) {
  const flaw =
    (typeof e.namespace !== 'string' || !e.namespace) ? 'an empty namespace'
      : !['key', 'prefix', 'table', 'column'].includes(e.kind) ? `unknown kind "${e.kind}"`
        : !STORES.includes(e.store) ? `unknown store "${e.store}"`
          : !OWNERS.includes(e.owner) ? `unknown owner "${e.owner}"`
            : !DISPOSITIONS.includes(e.disposition) ? `unknown disposition "${e.disposition}"`
              : (typeof e.reason !== 'string' || !e.reason) ? 'no reason'
                : (e.kind === 'prefix' && !/[:/]$/.test(e.namespace)) ? 'a prefix that does not end in ":" or "/"'
                  : null;
  if (flaw) throw new Error(`persistedState: entry "${e.namespace}" has ${flaw}.`);
}
if (new Set(PERSISTED_STATE.map((e) => `${e.store}\u0000${e.namespace}`)).size !== PERSISTED_STATE.length) {
  throw new Error('persistedState: duplicate namespace registered for one store.');
}

/**
 * The delete phase of the replacement plan, derived from `entries`. Exported with the entry
 * list as a parameter so the suite can prove the failure modes; production goes through
 * replacementDeletes() below, which binds the real registry.
 *
 * Only `replace` and `re-key` produce statements - and only in the store/kind combinations the
 * planner actually knows how to delete from. A destructive disposition anywhere else throws:
 * a registered intent to delete that nothing would carry out (or worse, that something might
 * carry out wrongly) must be loud, not blank.
 */
export function deletionStatements(entries, profileIds = []) {
  const statements = [];
  for (const e of entries) {
    if (!DISPOSITIONS.includes(e.disposition)) {
      throw new Error(`persistedState: "${e.namespace}" has disposition "${e.disposition}", which has no defined deletion semantics.`);
    }
  }
  // Tables first - the shipped Increment 4 order, so the derived plan is statement-for-statement
  // the one replaceAll.test.mjs already asserts.
  for (const e of entries) {
    if (e.disposition !== 'replace') continue;
    if (e.store !== 'sqlite' || e.kind !== 'table') {
      throw new Error(`persistedState: "${e.namespace}" is marked replace but is not a sqlite table - the planner has no deletion path for it.`);
    }
    statements.push([`DELETE FROM ${e.namespace};`]);
  }
  for (const e of entries) {
    if (e.disposition !== 're-key') continue;
    if (e.store !== 'catalog_meta' || e.kind !== 'prefix') {
      throw new Error(`persistedState: "${e.namespace}" is marked re-key but is not a catalog_meta prefix - the planner has no deletion path for it.`);
    }
    for (const pid of profileIds) {
      statements.push(['DELETE FROM catalog_meta WHERE key=?;', [`${e.namespace}${pid}`]]);
    }
  }
  return statements;
}

/** What the replacement deletes, per the registry: today `DELETE FROM profiles;` plus the
 *  captured pids' `dash_seeded:` keys - and nothing that has not been registered destructive. */
export function replacementDeletes(profileIds) {
  return deletionStatements(PERSISTED_STATE, profileIds);
}
