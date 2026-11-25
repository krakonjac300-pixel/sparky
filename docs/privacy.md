# Sparky privacy policy

Effective date: November 25, 2026

This policy explains what the Android app Sparky (package app.sparky.dailyhabits) does with your information. Sparky is a habit tracker with an accountability turtle. It is free, shows no ads, and has no Sparky account.

## Who we are

Sparky is published by the developer of Sparky ("we", "us"). You can contact us at sparkyhabits@proton.me. We do not run a server for Sparky, so we do not receive, store or see your habit records.

## The short version

- Your records are stored on your phone. We never receive them.
- Sparky has no analytics, no advertising, no crash reporting and no tracking tools.
- Every permission is optional. Sparky works for basic habit tracking without any of them.
- Data leaves your phone only when you use an optional feature that needs it: the ChatGPT Coach (sends what you choose to OpenAI), Google Tasks (reads your tasks from Google), or when you export, back up or share something yourself.
- Health Connect data, screen time and calendar events are never sent to OpenAI or to us.

## What stays on your device

Everything you enter or import is saved in Sparky's private storage on your phone. This includes habits and their settings, habit logs and notes, mood and energy check-ins, morning plans, evening reflections, goals and measurements, timeline moments, programs, focus sessions, small wins, app limits, saved Coach chats, saved AI reviews, imported Health Connect data and screen time history.

Sparky turns off Android's automatic cloud backup, so Android does not copy this storage to your Google account. Your records leave the phone only in the ways described below.

## Optional permissions and why Sparky asks for them

You can grant or remove each permission at any time in Android Settings (and, for health data, in Health Connect). If you decline one, only the feature that needs it stops working.

**Health Connect (sleep, steps, exercise, distance).** Sparky reads the data types you allow: total sleep per night, daily steps (and hourly steps for today), daily exercise duration and daily distance, for roughly the last four weeks. It uses them to show reports, to fill in habits you have linked to a health metric, and, if you choose, to show a night's sleep on a progress card you create. Sparky only reads; it never writes to Health Connect. Details are in the Health Connect section below.

**Health Connect background read.** If you allow it, Sparky refreshes the health data above about once an hour while the app is closed, so linked habits, widgets and Sparky's daily reaction stay current. Without it, Sparky reads health data only while it is open.

**Usage access (screen time).** With Android's Usage access setting, Sparky reads how long each app was in the foreground on this phone, and lists your installed apps so you can pick which ones to limit. It uses this for the screen time view, app limits, the App budget widget and budget reminders. It refreshes about every 15 minutes in the background and every 10 minutes while open. Screen time stays on the phone.

**Calendar (read).** Sparky reads calendars synced to your phone in two cases: when you tap Show upcoming events (it shows the titles and start times of up to 30 events in the next seven days), and when it suggests a free time slot for a habit tomorrow (it reads only the start and end times of busy events, not titles). Event titles are shown on screen and are not saved. Sparky does not write to your calendar. When you tap to add a habit block or a new event, Sparky opens your calendar app's own editor with the habit name and time filled in, and you decide whether to save it there.

**Notifications.** Used for habit reminders, unfinished-habit reminders, Sparky's evening check, app budget alerts, focus timer cues and, if you turn it on, the weekly AI review. Notifications are marked private so their content is hidden on a secure lock screen.

**Exact alarms.** Lets reminders, the weekly review and the end of a focus quiet period arrive at the time you set. Without it, Android may deliver them later.

**Do Not Disturb access.** If you grant it, starting a focus session turns on a temporary Do Not Disturb rule called Sparky Focus that still lets alarms through. Sparky turns it off when the session ends. Without it, the focus timer still runs but does not silence your phone.

**Start at boot.** After a restart, time change or app update, Sparky reschedules your reminders, weekly review and focus cleanup. It does not read any data for this.

**Vibration and internet.** Vibration is used for haptic feedback. Internet is used only for the optional ChatGPT Coach and Google Tasks.

## What OpenAI receives when you use Coach

Coach is optional and off until you sign in with your own ChatGPT account. Sparky then sends requests directly from your phone to OpenAI. Requests are made with your ChatGPT account and count against your ChatGPT plan, so OpenAI can link them to that account and sees your IP address, as with any online service. Sparky asks OpenAI not to store responses (the "store: false" setting), but OpenAI handles all data it receives under its own terms and privacy policy, available at https://openai.com/policies/privacy-policy/.

**Signing in.** OpenAI's sign-in page opens in your browser. Sparky sends OpenAI a random identifier created for this installation and the app name "Sparky". OpenAI returns sign-in tokens and your account email. Sparky stores them on the phone, encrypted with a key held in Android's secure key store. We never receive them.

**Every Coach request** also includes the name of the ChatGPT model you chose and a fixed instruction telling the model to act as Sparky's coach, use only what you sent, avoid medical diagnosis, and say that it cannot change your records.

**Ask ChatGPT (chat).** OpenAI receives:
- the question you type (up to 4,000 characters);
- up to six earlier questions and answers from the same conversation, including a saved chat you reopened (older answers are shortened if very long).

**Optional app context.** Only if you tick "Include an app context summary in this message", the message also includes a summary of the last 30 days. You can read the exact text before sending. It contains:
- today's date and the period covered;
- how many scheduled habits reached their target, the previous period's rate, how many habit actions you logged, and your current streak;
- how many days Sparky was proud, so-so or disappointed;
- your life area names with their totals;
- the number of mood check-ins and your average mood and energy;
- the names of apps or app groups you set limits on and each daily limit in minutes (not how long you used them);
- your goals with target, latest measurement and due date;
- your small wins with how often you did them;
- each habit's score, name, area, schedule, minimum, target and stretch levels, unit, and the "why", "if I skip it", replacement, restart step, slip counting and reminder time you entered;
- today's priorities and their cues;
- a journal of the period: your habit log notes, skipped and slipped habits, check-in moods and notes, morning plans, evening reflections (including any text you dictated or shared into them), timeline moments, and goal measurement notes.

The context is attached only to the message where you ticked the box. It is not resent with later messages.

**AI summary (report).** When you tap Summarize on a report, Sparky builds a review request with the same kinds of information listed above for the period you chose, plus a list of questions for the review. You see the full text, can edit it, and nothing is sent until you tap Send report prompt. Earlier AI reviews are not included.

**Weekly AI review.** Off by default. If you turn it on after reading the example prompt, Sparky sends a short request on Sunday evenings, even while the app is closed. It contains only four numbers for the past seven days: scheduled targets reached, scheduled targets planned, how many reached at least the minimum, and how many habit actions you logged. It contains no habit names, notes, dates of entries, health data or screen time. If the numbers are more than three days old, Sparky sends nothing and asks you to open the app. Turning off weekly reviews, signing out or connecting another account stops it.

**Program tips.** OpenAI receives the program's title, the current practice step, and the optional question you type. Your journal is not included.

**What OpenAI never receives from Sparky:**
- Health Connect data (sleep, steps, exercise, distance) or habit entries that were filled in automatically from it;
- screen time or per-app usage;
- calendar events, titles or busy times;
- Google Tasks;
- your notes, reflections, check-ins or habit names, unless you tick the app context box or send an AI summary;
- your saved AI reviews, other saved chats, focus session history, program journal entries or backups;
- your name, contacts, location or device identifiers other than the random sign-in identifier described above.

**Saved chats and reviews.** Answers are saved on your phone: up to 100 chats with up to 50 questions and answers each, and up to 60 AI reviews. Chats are linked to a code derived from your ChatGPT account so each account sees only its own chats. You can delete a chat in Coach. Signing out stops further requests but keeps saved chats on the phone until you delete them or reset Sparky.

## Google Tasks

If you tap Connect Google Tasks, Google asks you to allow Sparky read-only access to your tasks. Sparky then reads your task list names and your unfinished tasks (title and due date) from Google and shows them. It does not change or create tasks. The access token is kept in memory only and is cleared when you disconnect or close the app. Tasks are not saved and are not sent anywhere else. To fully revoke access, remove Sparky in your Google Account's third-party connections. Google handles the sign-in under its privacy policy, available at https://policies.google.com/privacy.

## Health Connect

Sparky reads Health Connect data only after you grant each data type, and only to provide the features you can see in the app: health reports, habits that fill in from a health metric, Sparky's daily reaction, widgets and, if you choose, a sleep line on a progress card.

Sparky does not use health data for advertising, does not sell it, does not use it to build profiles for any other purpose, and does not send it to us, to OpenAI or to any other third party. It leaves your phone only if you yourself export a backup, turn on automatic copies in Downloads, or share a progress card that you chose to include sleep on.

The use of information received from Health Connect will adhere to the Health Connect Permissions policy, including the Limited Use requirements. Sparky's use of this data also follows Google Play's User Data policy.

You can pause health syncing or clear imported health history in Sparky's Phone connections screen, and change permissions in Health Connect at any time.

## Speech dictation

The Dictate reflection button opens your phone's speech recognition service (for example Google's). That service processes your voice under its own privacy policy and gives Sparky only the resulting text. Sparky never records audio and does not have microphone permission.

## Backups, exports and sharing

**Manual export.** You choose where to save a full backup file. It is readable JSON that contains all your records, including notes, saved chats and their account codes, AI reviews, health data and screen time. It does not contain ChatGPT sign-in tokens. Anyone with the file can read it, so pick a private place. If you save it to a cloud folder, that provider receives it.

**Automatic copies.** Off by default (Android 10 or later). If you turn them on, Sparky saves a verified copy to Downloads/Sparky on your phone while the app is open, keeping the latest copy for each of up to 30 days. These files stay on the phone, are readable by you and by file manager apps you allow, and can remain after you uninstall Sparky.

**Chat export, progress cards and sharing.** You can export a single chat, save or share a progress card image, share today's unfinished habits, or copy text. Each card option (stats, habit name, mood, check-in note, sleep, nickname, date) is your choice. The app you pick in Android's share menu receives exactly what you send.

**Import.** You can restore a backup file. Sparky shows a preview before replacing your records.

## Deletion and retention

We hold no copy of your data, so there is nothing for us to delete on a server. You are in control on the device:
- Delete individual entries, chats and reviews in the app.
- Clear imported health or screen time history in Phone connections.
- Use Reset in Settings to erase all records and saved chats, turn off automatic copies and weekly AI reviews, and optionally delete the automatic copies Sparky created.
- Clear Sparky's storage in Android Settings or uninstall the app.
- Delete manual exports and remaining files in Downloads/Sparky yourself.

Records are kept on your phone until you delete them. Data already sent to OpenAI or Google is handled under their policies; use their account settings to manage it. If you email support, we keep your message only as long as needed to answer it.

## Children

Sparky is not directed at children under 13 and is meant for adults. We do not knowingly collect information from children. The ChatGPT Coach is subject to OpenAI's own age requirements.

## Security

Records stay in Sparky's private app storage. ChatGPT tokens are encrypted with Android's key store. All connections to OpenAI and Google use encrypted HTTPS, and Sparky blocks unencrypted traffic. Backup files you export are not encrypted, so store them carefully.

## Your rights

Because your data is on your phone, you can view, correct, export and delete it yourself at any time. If you have a question or want to exercise a privacy right under the law that applies to you, contact us at sparkyhabits@proton.me. You can also contact your local data protection authority.

## Changes to this policy

If we change this policy, we will update it at this address and change the effective date above. If a change affects what Sparky sends off your phone, we will tell you in the app before it applies.
