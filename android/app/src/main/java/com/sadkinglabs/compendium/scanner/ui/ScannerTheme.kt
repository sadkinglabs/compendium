package com.sadkinglabs.compendium.scanner.ui

import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import com.sadkinglabs.compendium.R
import com.sadkinglabs.compendium.scanner.model.ScanKind

// Compendium's black + gold identity, mapped onto a Material 3 dark scheme.
private val Gold = Color(0xFFDCB86F)
private val Ruby = Color(0xFFD25873)   // = --accent-ruby (Collection)

// The per-pillar accents - mirror src/theme/tokens.css EXACTLY (--accent-gold/violet/
// jade/ruby) so the native scanner reads as the same app. Colour-code the recognition
// sheet + the frame lock-flash by WHAT was scanned: a card, a shared deck, a shared match.
val PillarGold = Color(0xFFDCB86F)     // Codex  - = --accent-gold
val PillarViolet = Color(0xFFC79AD0)   // Decks  - = --accent-violet
val PillarJade = Color(0xFF8FD3A8)     // Play   - = --accent-jade

/** Dark ink that reads on any of the (light, pastel) pillar accents above. */
val OnPillar = Color(0xFF17130B)

fun accentFor(kind: ScanKind): Color = when (kind) {
    ScanKind.CARD -> PillarGold
    ScanKind.DECK -> PillarViolet
    ScanKind.MATCH -> PillarJade
}

// The app's three shipping type families (src/theme/tokens.css --f-display/--f-read/--f-ui),
// bundled as TTFs in res/font. Single 400 masters, exactly as the web layer ships them - Compose
// synthesises heavier weights, mirroring the app's faux-bold (DESIGN_SYSTEM OD-19).
val FontDisplay = FontFamily(Font(R.font.cinzel_regular, FontWeight.Normal))          // Cinzel  - headings / rubrics / card names
val FontRead = FontFamily(Font(R.font.ebgaramond_regular, FontWeight.Normal))         // EB Garamond - reading body
val FontUi = FontFamily(Font(R.font.hanken_grotesk_regular, FontWeight.Normal))       // Hanken Grotesk - UI chrome / labels

// UI (Hanken) as the scanner's default family: every Material component (buttons, etc.) and every
// plain Text inherits it, so nothing renders in system Roboto. Display/read are applied explicitly.
private fun scannerTypography(): Typography {
    val d = Typography()
    fun f(s: TextStyle) = s.copy(fontFamily = FontUi)
    return Typography(
        displayLarge = f(d.displayLarge), displayMedium = f(d.displayMedium), displaySmall = f(d.displaySmall),
        headlineLarge = f(d.headlineLarge), headlineMedium = f(d.headlineMedium), headlineSmall = f(d.headlineSmall),
        titleLarge = f(d.titleLarge), titleMedium = f(d.titleMedium), titleSmall = f(d.titleSmall),
        bodyLarge = f(d.bodyLarge), bodyMedium = f(d.bodyMedium), bodySmall = f(d.bodySmall),
        labelLarge = f(d.labelLarge), labelMedium = f(d.labelMedium), labelSmall = f(d.labelSmall),
    )
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
    MaterialTheme(colorScheme = ScannerColors, typography = scannerTypography()) {
        // Plain Text() (which ignores MaterialTheme.typography) defaults to Hanken too, so no
        // scanner text falls back to system Roboto; display/reading are set explicitly per-use.
        CompositionLocalProvider(LocalTextStyle provides LocalTextStyle.current.copy(fontFamily = FontUi)) {
            content()
        }
    }
}
