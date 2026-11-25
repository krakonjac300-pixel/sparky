package app.onelife.daybook

import android.app.Activity
import android.os.Bundle
import android.widget.TextView

class HealthPrivacyActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(TextView(this).apply {
            text = "Sparky can read the sleep, steps, exercise duration and distance data you allow in Health Connect. It uses those records for on-device reports and optional habit logging. Background access is a separate permission. Records can be included in readable backups you export and optional automatic copies in Downloads/Sparky. Manage and remove automatic copies in Settings. Use Settings to pause syncing or clear imported history, and use Health Connect to change permissions. Read the privacy notice under Settings, Legal and privacy."
            textSize = 18f
            val spacing = (32 * resources.displayMetrics.density).toInt()
            setPadding(spacing, spacing, spacing, spacing)
        })
    }
}
