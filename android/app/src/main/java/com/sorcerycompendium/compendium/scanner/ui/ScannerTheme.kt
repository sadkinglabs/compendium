package com.sorcerycompendium.compendium.scanner.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import com.sorcerycompendium.compendium.scanner.model.ScanKind

// Compendium's black + gold identity, mapped onto a Material 3 dark scheme.
private val Gold = Color(0xFFDCB86F)
private val Ruby = Color(0xFFC76D85)   // Manuscript rose (danger/secondary)

// The per-pillar accents (mirrors src/theme/tokens.css) that colour-code the recognition
// sheet + the frame lock-flash by WHAT was scanned: a card, a shared deck, a shared match.
val PillarGold = Color(0xFFDCB86F)     // Codex  - a catalog card
val PillarViolet = Color(0xFFA08CC0)   // Decks  - a shared deck QR   (160,140,192)
val PillarJade = Color(0xFF4DB38A)     // Play   - a shared match QR

/** Dark ink that reads on any of the (light, pastel) pillar accents above. */
val OnPillar = Color(0xFF17130B)

fun accentFor(kind: ScanKind): Color = when (kind) {
    ScanKind.CARD -> PillarGold
    ScanKind.DECK -> PillarViolet
    ScanKind.MATCH -> PillarJade
}

private val ScannerColors = darkColorScheme(
    primary = Gold,
    onPrimary = Color(0xFF221A0C),
    secondary = Ruby,
    onSecondary = Color(0xFF2A0E16),
    background = Color(0xFF000000),
    onBackground = Color(0xFFEFE7D8),   // canonical ink
    surface = Color(0xFF15110B),
    onSurface = Color(0xFFEFE7D8),
    outline = Color(0x66DCB86F),
)

@Composable
fun CompendiumScannerTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = ScannerColors, content = content)
}
