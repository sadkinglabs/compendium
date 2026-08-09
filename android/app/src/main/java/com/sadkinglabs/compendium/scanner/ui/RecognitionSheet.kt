package com.sadkinglabs.compendium.scanner.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.clip
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sadkinglabs.compendium.scanner.model.Recognition
import com.sadkinglabs.compendium.scanner.model.ScanKind
import com.sadkinglabs.compendium.scanner.model.SetRef

/**
 * The recognition surface: a Material 3 card that springs up on lock (re-springs when the
 * result changes) and colour-codes itself + its actions to WHAT was scanned - a Codex-gold
 * card, a Decks-violet shared deck, or a Play-jade shared match (see [accentFor]). Sticky:
 * the caller keeps it up until "Scan another", a tap outside, or a new result. Swallows its
 * own taps so a tap ON the sheet never falls through to the dismiss scrim. The sparkle
 * flourish is drawn separately (over the whole screen) by [SparkleBurst].
 */
@Composable
fun RecognitionCard(
    rec: Recognition,
    collectionMode: Boolean,
    deckMode: Boolean,
    reveal: Float,
    onSearchCodex: () -> Unit,
    onAddCollection: (String?) -> Unit,
    onAddWishlist: (String?) -> Unit,
    onSaveCollection: (Int, String?) -> Unit,
    onAddToDeck: (Int) -> Unit,
    onSaveDeck: () -> Unit,
    onImportMatch: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val accent = accentFor(rec.kind)
    val key = rec.cardId ?: rec.url ?: rec.title
    // The tray rides the SHARED reveal clock and arrives LATE (0.52 -> 0.875 of the reveal) so it
    // never competes with the frame + name during their beats. `reveal` is 1f at once under
    // reduced motion, so `tray` is 1f and the sheet is simply present.
    val tray = ((reveal - 0.52f) / (0.875f - 0.52f)).coerceIn(0f, 1f)
    // Collection-mode quantity, reset for each newly recognised card.
    var qty by remember(key) { mutableStateOf(1) }
    // Collection-mode set choice: a single-set card auto-selects; a reprint starts
    // null (a pick is required); an unknown card has no sets (files Unspecified).
    var selectedSet by remember(key) { mutableStateOf(if (rec.sets.size == 1) rec.sets[0].code else null) }
    val eyebrow: String; val title: String; val subtitle: String?
    when (rec.kind) {
        ScanKind.CARD -> { eyebrow = "RECOGNISED CARD"; title = rec.title; subtitle = null }
        ScanKind.DECK -> { eyebrow = "SHARED DECK"; title = "Sorcery deck"; subtitle = "Save it to your library to see every card." }
        ScanKind.MATCH -> { eyebrow = "SHARED MATCH"; title = "Match result"; subtitle = "Import it to review the game." }
    }
    Surface(
        modifier = modifier
            .fillMaxWidth()
            .padding(16.dp)
            .graphicsLayer {
                alpha = tray
                translationY = (1f - tray) * 40f   // slide up on the shared clock, no scale pop
            }
            .pointerInput(Unit) { detectTapGestures { } }  // swallow taps (don't dismiss on sheet tap)
            .semantics { contentDescription = "$eyebrow: $title" },
        shape = MaterialTheme.shapes.extraLarge,
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, Color(0x3DDCB86F)),   // GothicSheet gilt hairline (gold @ .24)
        tonalElevation = 6.dp,
        shadowElevation = 16.dp,
    ) {
        Column(Modifier.fillMaxWidth().padding(22.dp)) {
            Text(eyebrow, color = accent, fontFamily = FontDisplay, fontSize = 10.5f.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 2.5f.sp)
            Spacer(Modifier.height(6.dp))
            // Compact heading: the large gilt name is already the payoff above the frame, so the
            // tray restates it quietly (two lines max) rather than competing with a second big title.
            Text(
                title, color = MaterialTheme.colorScheme.onSurface, fontFamily = FontDisplay,
                fontSize = 18.sp, fontWeight = FontWeight.Bold, lineHeight = 22.sp,
                maxLines = 2, overflow = TextOverflow.Ellipsis,
            )
            // Single-set card: its set shown as a quiet gilt pill (as if recognised).
            if (rec.kind == ScanKind.CARD && rec.sets.size == 1) {
                Spacer(Modifier.height(11.dp))
                SetPill(rec.sets[0].name, accent)
            }
            if (subtitle != null) {
                Spacer(Modifier.height(7.dp))
                Text(subtitle, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f), fontFamily = FontRead, fontSize = 15.sp, lineHeight = 21.sp)
            }
            Spacer(Modifier.height(18.dp))
            Hairline()
            Spacer(Modifier.height(18.dp))
            when (rec.kind) {
                ScanKind.CARD -> if (deckMode) {
                    // A deck is name-level (Alpha & Beta are the same card in a list), so
                    // the printing is informational only - no pick, no gate. Multi-set cards
                    // show their printings as quiet pills; single-set shows one in the header.
                    if (rec.sets.size > 1) {
                        Text("PRINTINGS", color = accent, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 2.sp)
                        Spacer(Modifier.height(11.dp))
                        Row(
                            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) { for (s in rec.sets) SetPill(s.name, accent) }
                        Spacer(Modifier.height(20.dp))
                    }
                    // Rarity copy limit, minus what the deck already holds: the max we can
                    // add. At 0 the card is full - no stepper, a spent-out note instead.
                    val remaining = (rec.limit - rec.inDeck).coerceAtLeast(0)
                    DeckLimitNote(inDeck = rec.inDeck, limit = rec.limit, remaining = remaining, accent = accent)
                    if (remaining > 0) {
                        val shown = qty.coerceIn(1, remaining)
                        Spacer(Modifier.height(16.dp))
                        QtyStepper(shown, accent, onDec = { if (shown > 1) qty = shown - 1 }, onInc = { if (shown < remaining) qty = shown + 1 }, max = remaining)
                        Spacer(Modifier.height(18.dp))
                        PrimaryAction(
                            if (shown == 1) "Add 1 to deck" else "Add $shown to deck",
                            Icons.Filled.Add, accent,
                        ) { onAddToDeck(shown) }
                    } else {
                        Spacer(Modifier.height(16.dp))
                        PrimaryAction("Already at the limit", Icons.Filled.Add, accent, enabled = false) { }
                    }
                } else {
                    // A card reprinted across sets: pick the printing (both modes) before adding.
                    if (rec.sets.size > 1) {
                        Text("WHICH PRINTING?", color = accent, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 2.sp)
                        Spacer(Modifier.height(11.dp))
                        SetChips(rec.sets, selectedSet, accent, onPick = { selectedSet = it })
                        Spacer(Modifier.height(20.dp))
                    }
                    val effectiveSet = when {
                        rec.sets.size == 1 -> rec.sets[0].code
                        rec.sets.size > 1 -> selectedSet
                        else -> null
                    }
                    val ready = rec.sets.size <= 1 || selectedSet != null
                    // WISHLIST NEEDS A REAL SET, ownership does not.
                    //
                    // A card the catalog places in no set can still be OWNED - it goes to the
                    // uncategorised pile and triage resolves it later. It cannot be WANTED:
                    // a want names a collector item, so with no set there is no honest item to
                    // record. `ready` allows the zero-set case, so the wishlist button had it
                    // enabled, showed "Added to your wishlist", and JS then counted the same
                    // action as a failure - success reported to the user, nothing stored.
                    val wishlistReady = effectiveSet != null
                    if (collectionMode) {
                        QtyStepper(qty, accent, onDec = { if (qty > 1) qty -= 1 }, onInc = { if (qty < 99) qty += 1 })
                        Spacer(Modifier.height(18.dp))
                        PrimaryAction(
                            if (qty == 1) "Add 1 copy" else "Add $qty copies",
                            Icons.Filled.Add, accent, enabled = ready,
                        ) { onSaveCollection(qty, effectiveSet) }
                        // Scanning a stack sorts into two piles - what you have, and what you still want -
                        // so the wishlist has to be reachable from the collection loop too. Without it the
                        // only route was to leave, scan again in universal mode, and come back. Adds ONE
                        // want (the stepper counts copies you own; a want is a single item), on the same
                        // selected printing, and stays disabled until a reprint has one chosen.
                        Spacer(Modifier.height(10.dp))
                        OutlinedButton(
                            onClick = { onAddWishlist(effectiveSet) },
                            enabled = wishlistReady,
                            modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
                        ) {
                            Icon(Icons.Filled.FavoriteBorder, contentDescription = null)
                            Spacer(Modifier.width(6.dp))
                            Text("Add to wishlist")
                        }
                    } else {
                        PrimaryAction("Search Codex", Icons.Filled.Search, accent, onClick = onSearchCodex)
                        Spacer(Modifier.height(10.dp))
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            OutlinedButton(onClick = { onAddCollection(effectiveSet) }, enabled = ready, modifier = Modifier.weight(1f).heightIn(min = 52.dp)) {
                                Icon(Icons.Filled.Add, contentDescription = null)
                                Spacer(Modifier.width(6.dp))
                                Text("Collection")
                            }
                            // Wants name a collector item under schema v11, so the wishlist
                            // action carries the SAME selected printing the collection action
                            // does - and is disabled for a reprint until one is chosen, rather
                            // than silently discarding the user's pick.
                            OutlinedButton(onClick = { onAddWishlist(effectiveSet) }, enabled = wishlistReady, modifier = Modifier.weight(1f).heightIn(min = 52.dp)) {
                                Icon(Icons.Filled.FavoriteBorder, contentDescription = null)
                                Spacer(Modifier.width(6.dp))
                                Text("Wishlist")
                            }
                        }
                    }
                }
                ScanKind.DECK -> PrimaryAction("Save to My Decks", Icons.Filled.Add, accent, onClick = onSaveDeck)
                ScanKind.MATCH -> PrimaryAction("Review & import", Icons.Filled.PlayArrow, accent, onClick = onImportMatch)
            }
            Spacer(Modifier.height(8.dp))
            TextButton(onClick = onDismiss, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                Text(if (collectionMode && rec.kind == ScanKind.CARD) "Skip / keep scanning" else "Scan another")
            }
        }
    }
}

/** The full-width primary action, filled in the result's type accent. Disabled
 *  (greyed) until [enabled] - used to gate "Add" on a set pick for reprints. */
@Composable
private fun PrimaryAction(label: String, icon: ImageVector, accent: Color, enabled: Boolean = true, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
        colors = ButtonDefaults.buttonColors(containerColor = accent, contentColor = OnPillar),
    ) {
        Icon(icon, contentDescription = null)
        Spacer(Modifier.width(8.dp))
        Text(label)
    }
}

/** A quiet gilt pill naming a card's (single) set - the recognised-printing badge. */
@Composable
private fun SetPill(name: String, accent: Color) {
    Text(
        name.uppercase(),
        color = accent,
        fontSize = 11.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 1.5f.sp,
        modifier = Modifier
            .clip(CircleShape)
            .background(Color(0x14DCB86F))
            .border(1.dp, accent.copy(alpha = 0.4f), CircleShape)
            .padding(horizontal = 13.dp, vertical = 6.dp),
    )
}

/** A centered fade hairline - the app's manuscript section divider. */
@Composable
private fun Hairline() {
    Box(
        Modifier.fillMaxWidth().height(1.dp).background(
            Brush.horizontalGradient(
                0f to Color.Transparent, 0.3f to Color(0xFF4A3C22), 0.7f to Color(0xFF4A3C22), 1f to Color.Transparent,
            ),
        ),
    )
}

/** Printing chooser for a reprinted card: a scrollable row of pick-one pills. The
 *  chosen one fills with a gilt gradient + check; the rest are gold-outlined. */
@Composable
private fun SetChips(sets: List<SetRef>, selected: String?, accent: Color, onPick: (String) -> Unit) {
    val gilt = Brush.verticalGradient(listOf(Color(0xFFD8B872), Color(0xFFB8954F)))
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        for (s in sets) {
            val on = s.code == selected
            Row(
                Modifier
                    .clip(CircleShape)
                    .clickable { onPick(s.code) }
                    .then(if (on) Modifier.background(gilt) else Modifier.background(Color(0x14DCB86F)))
                    .border(1.dp, if (on) Color(0xFFE3C589) else accent.copy(alpha = 0.35f), CircleShape)
                    .heightIn(min = 44.dp)
                    .padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                if (on) Icon(Icons.Filled.Check, contentDescription = null, tint = OnPillar, modifier = Modifier.size(15.dp))
                Text(
                    s.name.uppercase(),
                    color = if (on) OnPillar else accent,
                    fontSize = 12.5f.sp,
                    fontWeight = FontWeight.SemiBold,
                    letterSpacing = 1.sp,
                )
            }
        }
    }
}

/** A big −/N/+ stepper for how many copies to record. [max] caps the + button -
 *  99 for collection, or the remaining deck headroom (limit − already in deck). */
@Composable
private fun QtyStepper(qty: Int, accent: Color, onDec: () -> Unit, onInc: () -> Unit, max: Int = 99) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        StepButton("−", accent, enabled = qty > 1, onClick = onDec)   // minus sign
        Text(
            qty.toString(),
            color = MaterialTheme.colorScheme.onSurface,
            fontSize = 30.sp,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
            modifier = Modifier.width(96.dp),
        )
        StepButton("+", accent, enabled = qty < max, onClick = onInc)
    }
}

/** Deck mode: a one-line note on where the card sits against its copy limit -
 *  how many the deck already holds and how many more may be added. Turns to the
 *  accent when the card is full. Unlimited cards ("any number of") say so. */
@Composable
private fun DeckLimitNote(inDeck: Int, limit: Int, remaining: Int, accent: Color) {
    val muted = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.68f)
    val unlimited = limit >= 99
    val text = when {
        remaining <= 0 -> "At the copy limit · $inDeck of $limit in this deck"
        unlimited && inDeck <= 0 -> "Any number allowed in a deck"
        unlimited -> "$inDeck in this deck · any number allowed"
        inDeck <= 0 -> "None in this deck yet · up to $limit"
        else -> "$inDeck of $limit in this deck · $remaining more"
    }
    Text(
        text,
        color = if (remaining <= 0) accent else muted,
        fontSize = 13.sp,
        fontWeight = FontWeight.Medium,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** A round outlined step button; the glyph dims when the step is disabled. */
@Composable
private fun StepButton(glyph: String, accent: Color, enabled: Boolean, onClick: () -> Unit) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        shape = CircleShape,
        modifier = Modifier.size(56.dp),
        contentPadding = PaddingValues(0.dp),
        border = BorderStroke(1.dp, accent.copy(alpha = if (enabled) 0.6f else 0.22f)),
    ) {
        Text(glyph, color = accent.copy(alpha = if (enabled) 1f else 0.35f), fontSize = 26.sp, fontWeight = FontWeight.Bold)
    }
}

/** Shown when camera permission is denied. */
@Composable
fun PermissionPrompt(onClose: () -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            "Camera permission needed",
            color = MaterialTheme.colorScheme.onBackground,
            fontSize = 18.sp,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            "Allow camera access to scan cards and codes. Everything stays on your device - nothing is uploaded.",
            color = MaterialTheme.colorScheme.onBackground,
            fontSize = 14.sp,
        )
        Spacer(Modifier.height(20.dp))
        Button(onClick = onClose) { Text("Close") }
    }
}
