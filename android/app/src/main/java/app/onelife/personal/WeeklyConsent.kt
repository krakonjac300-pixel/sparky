package app.onelife.daybook

import java.util.UUID

// All activities and workers share this lock. The durable token survives process
// recreation. A second consent from the same owner always gets a new token.
internal class WeeklyConsent {
    private var choice = 0L

    @Synchronized fun beginChoice() = ++choice

    @Synchronized fun invalidate(clear: () -> Unit) {
        choice++
        clear()
    }

    @Synchronized fun enable(expectedChoice: Long, owner: String, save: (String) -> Unit) {
        check(choice == expectedChoice && owner.isNotBlank()) { "Weekly review choice changed." }
        choice++
        save("$owner.${UUID.randomUUID()}")
    }

    @Synchronized fun <T> granted(expected: String?, current: () -> String?, action: () -> T): T? {
        if (expected.isNullOrBlank() || current() != expected) return null
        return action()
    }
}
