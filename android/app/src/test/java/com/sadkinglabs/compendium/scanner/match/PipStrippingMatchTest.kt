package com.sadkinglabs.compendium.scanner.match

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.File

/**
 * Device-evidence regression: a mana-cost / threshold PIP the OCR grabs from the card corner
 * ("3A Ghoul", "2V Drowned") must NOT block a match. On the 2026-07-27 Pixel capture, Ghoul was
 * read cleanly on 13/13 frames as "3A Ghoul" / "Ghoul 3A" yet never locked, and Drowned only locked
 * on the rare pip-free frame - because the un-stripped pip sank the whole-string fuzzy ratio of the
 * SHORT name below the 0.80 threshold. [Norm] now drops pip tokens, so the name matches on its own.
 *
 * Uses the frozen full 1,109-card catalog so a real neighbour (e.g. "Drown" vs "Drowned") can still
 * contest the match - a match here means it wins against the whole catalog, not a toy list.
 */
class PipStrippingMatchTest {

    private fun catalog(): List<CardRef> {
        val f = File("src/test/resources/scanner/full-catalog.tsv")
        check(f.exists()) { "missing test resource ${f.absolutePath}" }
        return f.readText().lineSequence().filter { it.isNotBlank() }.map { line ->
            val t = line.split('\t'); CardRef(id = t[0], name = t[0], isSite = t.getOrNull(1) == "1")
        }.toList()
    }

    private val matcher by lazy { Matcher(CardIndex(catalog())) }

    private fun match(raw: String, site: Boolean = false): String? =
        matcher.match(Norm.normalize(raw), site)?.card?.id

    @Test fun ghoul_with_mana_pip_matches() {
        // Every observed Ghoul frame carried the pip; none matched before the fix.
        assertEquals("Ghoul", match("3A Ghoul"))
        assertEquals("Ghoul", match("Ghoul 3A"))
        assertEquals("Ghoul", match("3 Ghoul 3A"))
    }

    @Test fun drowned_with_mana_pip_matches_and_beats_drown() {
        // The Drown/Drowned pair is the ambiguity trap; the exact name must still win.
        assertEquals("Drowned", match("2V Drowned"))
        assertEquals("Drowned", match("Drowned 2V"))
        assertEquals("Drowned", match("27 Drowned 2 V"))
    }

    @Test fun pip_stripping_does_not_break_ordinary_names() {
        // Regression guard: stripping pips must not disturb normal (longer) matches.
        assertEquals("Ghoul", match("Ghoul"))
        assertEquals("Drown", match("Drown"))
    }

    @Test fun a_bare_pip_still_matches_nothing() {
        // Pips alone carry no identity - must never resolve to a card.
        assertNull(match("3A"))
        assertNull(match("2 V"))
    }
}
