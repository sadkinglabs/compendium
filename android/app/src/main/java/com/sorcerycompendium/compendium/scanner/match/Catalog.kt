package com.sorcerycompendium.compendium.scanner.match

import com.getcapacitor.JSArray
import com.sorcerycompendium.compendium.scanner.model.SetRef

/** Parses the JS-supplied catalog array (`[{id,name,isSite,sets:[{name,code}]}]`)
 *  into [CardRef]s. `sets` is optional; missing/blank codes are dropped. */
object Catalog {
    fun parse(arr: JSArray?): List<CardRef> {
        if (arr == null) return emptyList()
        val out = ArrayList<CardRef>(arr.length())
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            val id = o.optString("id").takeIf { it.isNotBlank() } ?: continue
            val name = o.optString("name").takeIf { it.isNotBlank() } ?: continue
            val setsArr = o.optJSONArray("sets")
            val sets = ArrayList<SetRef>()
            if (setsArr != null) {
                for (j in 0 until setsArr.length()) {
                    val s = setsArr.optJSONObject(j) ?: continue
                    val code = s.optString("code").takeIf { it.isNotBlank() } ?: continue
                    sets.add(SetRef(s.optString("name").ifBlank { code }, code))
                }
            }
            out.add(CardRef(id, name, o.optBoolean("isSite", false), sets))
        }
        return out
    }
}
