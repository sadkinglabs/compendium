package com.sorcerycompendium.compendium.scanner.match

import com.getcapacitor.JSArray

/** Parses the JS-supplied catalog array (`[{id,name,isSite}]`) into [CardRef]s. */
object Catalog {
    fun parse(arr: JSArray?): List<CardRef> {
        if (arr == null) return emptyList()
        val out = ArrayList<CardRef>(arr.length())
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            val id = o.optString("id").takeIf { it.isNotBlank() } ?: continue
            val name = o.optString("name").takeIf { it.isNotBlank() } ?: continue
            out.add(CardRef(id, name, o.optBoolean("isSite", false)))
        }
        return out
    }
}
