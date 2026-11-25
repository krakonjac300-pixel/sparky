package app.onelife.daybook

import android.app.NotificationManager
import android.content.Context
import android.media.AudioManager
import android.media.AudioAttributes
import android.media.ToneGenerator
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.provider.Settings

/** Vibration and the ringer check behind Sparky's sounds. */
object Feel {
    @Suppress("DEPRECATION")
    fun focusCue(context: Context, phase: String, sound: Boolean, vibration: Boolean) {
        val (tone, duration, pattern) = when (phase) {
            "break" -> Triple(ToneGenerator.TONE_PROP_BEEP, 180, longArrayOf(0, 140))
            "work" -> Triple(ToneGenerator.TONE_PROP_BEEP2, 280, longArrayOf(0, 100, 100, 100))
            "finished" -> Triple(ToneGenerator.TONE_PROP_ACK, 500, longArrayOf(0, 160, 100, 160, 100, 240))
            else -> error("Unknown focus cue.")
        }
        // Focus cues use the alarm stream so they still sound during Focus's own Do Not Disturb,
        // but a phone on silent or vibrate stays quiet and only vibrates.
        if (sound && ringerNormal(context)) runCatching {
            val player = ToneGenerator(AudioManager.STREAM_ALARM, 75)
            if (player.startTone(tone, duration)) Handler(Looper.getMainLooper()).postDelayed({ player.release() }, duration + 100L)
            else player.release()
        }
        if (vibration) {
            val vibrator = context.getSystemService(Vibrator::class.java) ?: return
            if (vibrator.hasVibrator()) vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1),
                AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build())
        }
    }

    fun haptic(context: Context, kind: String) {
        val vibrator = context.getSystemService(Vibrator::class.java) ?: return
        if (!vibrator.hasVibrator()) return
        // Android 13+ applies the user's "Touch feedback" switch and strength to touch-usage vibrations; older
        // versions only expose the switch, so check it here.
        if (Build.VERSION.SDK_INT < 33 &&
            Settings.System.getInt(context.contentResolver, Settings.System.HAPTIC_FEEDBACK_ENABLED, 1) == 0) return
        val effect = when (kind) {
            // Two light taps and a firmer one: the whole day is done.
            "allDone" -> VibrationEffect.createWaveform(longArrayOf(0, 30, 80, 30, 80, 60), intArrayOf(0, 160, 0, 200, 0, 255), -1)
            "undo" -> predefined(VibrationEffect.EFFECT_TICK, 10)
            "done" -> predefined(VibrationEffect.EFFECT_CLICK, 20)
            else -> error("Unknown vibration.")
        }
        if (Build.VERSION.SDK_INT >= 33) vibrator.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_TOUCH))
        else vibrator.vibrate(effect)
    }

    private fun predefined(effect: Int, fallbackMs: Long) =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) VibrationEffect.createPredefined(effect)
        else VibrationEffect.createOneShot(fallbackMs, VibrationEffect.DEFAULT_AMPLITUDE)

    /** Sounds play only when the ringer is on and Do Not Disturb is off, so a quiet phone keeps Sparky quiet. */
    fun soundAllowed(context: Context) = ringerNormal(context) &&
        context.getSystemService(NotificationManager::class.java)?.currentInterruptionFilter.let {
            it == null || it == NotificationManager.INTERRUPTION_FILTER_ALL || it == NotificationManager.INTERRUPTION_FILTER_UNKNOWN
        }

    private fun ringerNormal(context: Context) =
        context.getSystemService(AudioManager::class.java)?.ringerMode == AudioManager.RINGER_MODE_NORMAL
}
