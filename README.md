# Sparky

A habit tracker with a turtle who holds you to it.

Pick one to three habits. Every evening at 21:00 Sparky checks your day: everything done and he gives you a thumbs up, 70% or more is so-so, less than that and he is disappointed. He means it. Sparky is for people who really want to change their habits.

<p>
  <img src="docs/screenshots/onboarding.png" width="240" alt="Choosing habits on first launch">
  <img src="docs/screenshots/today.png" width="240" alt="Today screen with Sparky's card and tonight's bar">
  <img src="docs/screenshots/history.png" width="240" alt="History with the week strip">
</p>

## What it does

- **Today:** your social media time against its limit, today's steps, Sparky inside a ring that fills as you finish habits ("2 of 5 done today"), and tonight's bar ("Sparky's bar tonight: 3 of 4 by 21:00").
- **App limits count as one habit:** stay under your social media limit and it counts as done; go over and it counts as one miss.
- **Set up in one go:** on first launch Sparky asks, one by one, for notifications, screen time, Health Connect (steps and sleep) and an optional ChatGPT connection. Each can be skipped.
- **Reminders that learn:** Sparky learns when you usually finish each habit and reminds you a little before, only if it is still open.
- **Evening check:** a notification at 21:00 with Sparky's verdict, even when the app is closed.
- **Small wins, check-ins, streaks** with freezes earned by full weeks, and planned rest days that don't count against you.
- **Focus sessions** that can turn on Do Not Disturb and always turn it off again.
- **History and reports** by day, week, month or year, plus optional phone screen time and Health Connect data.
- **Coach (optional):** connect your own ChatGPT plan to ask about your habits. Nothing is sent unless you connect it and choose to share.
- **Private by default:** your records stay on your phone. No account, no ads, no tracking. Export or back up whenever you like.

## Install

Download the latest APK from [Releases](../../releases) and open it on an Android phone (Android 9 or newer). Android will ask you to allow installs from your browser or file manager.

## Build from source

Requirements: Node.js 20+, JDK 17, Android SDK (compileSdk 36) and Gradle 8.11.

```sh
npm install
npm run build          # builds the web app into dist/
npm test               # unit tests
npm run test:browser   # browser tests (Playwright)
cd android
gradle :app:assembleRelease   # packages dist/ into the APK
```

The release APK is unsigned; sign it with your own key (`zipalign` then `apksigner sign`).

## Privacy and terms

See the [privacy policy](docs/privacy.md) and [docs/one-life-terms.md](docs/one-life-terms.md).

## License

MIT, see [LICENSE](LICENSE). Sparky's artwork and name are included for this app; please give your own fork its own mascot and name.
