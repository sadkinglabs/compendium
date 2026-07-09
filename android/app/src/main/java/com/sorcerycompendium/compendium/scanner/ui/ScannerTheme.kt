package com.sorcerycompendium.compendium.scanner.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Compendium's black + gold identity, mapped onto a Material 3 dark scheme.
private val Gold = Color(0xFFDCB86F)
private val Ruby = Color(0xFFD25873)

private val ScannerColors = darkColorScheme(
    primary = Gold,
    onPrimary = Color(0xFF221A0C),
    secondary = Ruby,
    onSecondary = Color(0xFF2A0E16),
    background = Color(0xFF000000),
    onBackground = Color(0xFFF3E9D6),
    surface = Color(0xFF15110B),
    onSurface = Color(0xFFF3E9D6),
    outline = Color(0x66DCB86F),
)

@Composable
fun CompendiumScannerTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = ScannerColors, content = content)
}
