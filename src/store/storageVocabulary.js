// Storage's closed vocabularies - container kinds and colours (docs/proposals/collection-storage.md).
//
// A LEAF module: imports nothing, so the schema layer, the repository, the import boundary and the
// picker can all reach it without reaching each other.
//
// ONE allow-list, used by creation, rendering, import validation and the swatch picker. That is a
// review requirement rather than tidiness: colour is written to the database and later interpolated
// into a CSS custom property, so an imported value that is neither validated nor allow-listed is a
// stylesheet injection with extra steps. Unknown values are REJECTED, never coerced and never
// passed through.

/** Container kinds. `unfiled` is the system place and cannot be chosen by a user. */
export const CONTAINER_KINDS = Object.freeze(['binder', 'box', 'deck', 'other']);
export const SYSTEM_KIND = 'unfiled';

/** The name the system container is created with. Users cannot rename or delete it. */
export const UNFILED_NAME = 'Unfiled';

/**
 * Colours, by TOKEN NAME. Never a hex string: the theme owns the actual value, so a retint changes
 * every container at once and the stored data stays content rather than presentation.
 * Each maps to an existing `--accent-*` custom property (theme/tokens.css).
 */
export const CONTAINER_COLOURS = Object.freeze(['gold', 'violet', 'jade', 'ruby']);
export const DEFAULT_COLOUR = 'gold';

/** True only for a colour this build knows. Anything else is rejected at the boundary. */
export const isContainerColour = (c) => CONTAINER_COLOURS.includes(c);

/** True for a kind a USER may pick - the system kind is deliberately excluded. */
export const isUserContainerKind = (k) => CONTAINER_KINDS.includes(k);

/** True for any kind that may legally sit in the table, system included. */
export const isContainerKind = (k) => k === SYSTEM_KIND || CONTAINER_KINDS.includes(k);

/** The CSS custom property a colour name resolves to. The ONLY place a name becomes a variable. */
export function containerColourVar(name) {
  return `var(--accent-${isContainerColour(name) ? name : DEFAULT_COLOUR})`;
}
