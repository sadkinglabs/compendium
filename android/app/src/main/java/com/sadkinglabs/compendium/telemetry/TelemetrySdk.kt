package com.sadkinglabs.compendium.telemetry

import android.content.Context
import com.google.android.gms.tasks.Tasks
import com.google.firebase.analytics.FirebaseAnalytics
import com.google.firebase.crashlytics.FirebaseCrashlytics
import java.util.concurrent.TimeUnit

/**
 * The seam between the consent machine and Firebase.
 *
 * WHY THIS INTERFACE EXISTS
 *
 * Not for tidiness - for evidence. The consent machine's whole job is to be correct
 * when things fail, and the previous version could not be tested for that at all: it
 * called Firebase statics directly, so the only way to exercise a failure was to have
 * one on a real device. Review found two defects in exactly the paths that were
 * untestable, and both would have been caught by a fake.
 *
 * Every operation returns Boolean = "did this actually happen". A false is a real
 * failure that the caller MUST NOT paper over. The old code caught Throwable and
 * returned Unit, which let deny() persist `denied` while an SDK kept a live override -
 * Settings saying off while collection ran. That is the exact privacy lie this whole
 * feature exists to prevent, written into the thing preventing it.
 */
interface TelemetrySdk {
    /** True if Firebase is configured at all. A clone without google-services.json has
     *  the classes but no config: that is fail-CLOSED and normal, and must be
     *  distinguishable from a transition that FAILED. Same symptom, opposite meaning. */
    fun isAvailable(): Boolean

    fun setAnalyticsEnabled(enabled: Boolean): Boolean
    fun setCrashlyticsEnabled(enabled: Boolean): Boolean
    fun resetAnalyticsData(): Boolean

    /**
     * Ask Crashlytics to drop unsent reports.
     *
     * RETURNS "THE REQUEST WAS MADE", NOT "THE REPORTS ARE GONE" - and the difference is
     * load-bearing. Bytecode for firebase-crashlytics 19.3.0:
     *
     *     public void deleteUnsentReports();
     *       4: invokevirtual CrashlyticsCore.deleteUnsentReports:()Lcom/.../Task;
     *       7: pop            <-- the SDK discards its own completion signal
     *       8: return
     *
     * The operation IS asynchronous (CrashlyticsController holds
     * unsentReportsHandled: TaskCompletionSource<Void>) and the public API gives you no
     * way to await it. NO CALLER MAY TREAT `true` HERE AS "DELETION COMPLETED".
     *
     * An earlier design tried to launder this by not enabling Crashlytics until the next
     * boot - but that is ELAPSED TIME, not evidence. Kill the process fast enough and the
     * deletion never lands, while the next boot happily enables collection over a report
     * that is still on disk. [hasUnsentReports] is the actual evidence; see it.
     */
    fun deleteUnsentReports(): Boolean

    /**
     * The ONLY observable answer to "is anything still queued?" - and the pivot the whole
     * grant path now turns on.
     *
     * Wraps checkForUnsentReports(), the one Task-returning member of this group. Its
     * callback fires **only while automatic collection is disabled**, which is exactly
     * the state a pending grant sits in, so the constraint costs nothing here.
     *
     * @return true = reports remain (do NOT enable), false = none remain (safe to enable),
     *         null = could not determine. Null must be treated as "reports remain":
     *         not knowing and knowing-there-are-none are not the same, and only one of
     *         them is safe to act on.
     */
    fun hasUnsentReports(): Boolean?
}

/** The real thing. Every call is guarded, but a guard now REPORTS rather than swallows. */
class FirebaseTelemetrySdk(private val context: Context) : TelemetrySdk {

    override fun isAvailable(): Boolean =
        try { FirebaseCrashlytics.getInstance(); true } catch (_: Throwable) { false }

    override fun setAnalyticsEnabled(enabled: Boolean): Boolean = try {
        FirebaseAnalytics.getInstance(context).setAnalyticsCollectionEnabled(enabled); true
    } catch (_: Throwable) { false }

    override fun setCrashlyticsEnabled(enabled: Boolean): Boolean = try {
        FirebaseCrashlytics.getInstance().setCrashlyticsCollectionEnabled(enabled); true
    } catch (_: Throwable) { false }

    override fun resetAnalyticsData(): Boolean = try {
        FirebaseAnalytics.getInstance(context).resetAnalyticsData(); true
    } catch (_: Throwable) { false }

    override fun deleteUnsentReports(): Boolean = try {
        FirebaseCrashlytics.getInstance().deleteUnsentReports(); true
    } catch (_: Throwable) { false }

    /**
     * Blocks on the Task. Safe because every caller runs on the plugin's single-thread
     * executor, never the WebView thread - and the timeout means a Task that never
     * resolves (checkForUnsentReports only fires while collection is disabled) degrades
     * to null = "assume reports remain", not to a hung boot.
     */
    override fun hasUnsentReports(): Boolean? = try {
        Tasks.await(FirebaseCrashlytics.getInstance().checkForUnsentReports(), 5, TimeUnit.SECONDS)
    } catch (_: Throwable) { null }
}

/** Durable consent storage, behind an interface for the same reason as above: the
 *  interesting cases are the ones where the write FAILS. */
interface ConsentStore {
    fun read(): String
    /** commit(), not apply(): the write must have landed before we touch an SDK. */
    fun write(value: String): Boolean
}

class PrefsConsentStore(private val context: Context) : ConsentStore {
    companion object {
        const val PREFS = "compendium_telemetry"
        const val KEY = "telemetry_consent"
    }
    override fun read(): String =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) ?: Consent.UNSET

    override fun write(value: String): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, value).commit()
}
