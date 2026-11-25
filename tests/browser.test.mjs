import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { before, after, test } from 'node:test';
import { chromium } from 'playwright';
import { preview } from 'vite';

let browser;
let server;
let url;
before(async () => {
  server = await preview({ build: { outDir: process.env.ONE_LIFE_TEST_DIST || 'dist' }, preview: { host: '127.0.0.1', port: 0 } });
  url = 'http://127.0.0.1:' + server.httpServer.address().port;
  browser = await chromium.launch(process.env.ONE_LIFE_BROWSER
    ? { executablePath: process.env.ONE_LIFE_BROWSER }
    : existsSync(chromium.executablePath()) ? {} : { channel: 'msedge' });
  // These suites test an existing user; the first-run habit picker has its own test.
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (options) => {
    const context = await newContext(options);
    if (!process.env.SHOW_ONBOARDING) await context.addInitScript(() => { try { localStorage.setItem('sparky-onboarding-done', '1'); } catch { /* storage blocked */ } });
    return context;
  };
});
after(async () => {
  await browser?.close();
  await server?.close();
});

const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };

test('a Health Connect goal completion and correction both refresh the Android reminder plan without a manual edit', async () => {
  const context = await browser.newContext(phone);
  const date = '2026-11-18';
  try {
    await context.addInitScript(date => {
      window.steps = 1;
      window.readPlans = [];
      window.OneLifeAndroid = { postMessage(raw) {
        const { action, id, value } = JSON.parse(raw);
        let result = true;
        if (action === 'phoneActivity') result = { health: { state: 'connected' }, usage: { state: 'off' },
          steps: { from: date, through: date, updated: 1795000000000 + window.steps,
            days: [{ date, steps: window.steps }] } };
        if (action === 'syncHabitReminders') {
          const rule = JSON.parse(value).find(item => item.id === 'read');
          if (rule) window.readPlans.push(rule.accountedFor.includes(date));
        }
        queueMicrotask(() => this.onmessage({ data: JSON.stringify({ id, value: result }) }));
      } };
    }, date);
    const page = await context.newPage();
    await page.clock.install({ time: new Date(2026, 10, 18, 12) });
    await page.goto(url);
    await page.locator('#budget-coach').waitFor();
    const { starterData, calendarDate, savePlan } = await import('../src/model.ts');
    const initial = starterData(calendarDate(date));
    const habit = initial.habits.find(h => h.id === 'read');
    const data = savePlan(initial, { ...habit, trackingType: 'count', unit: 'steps', healthSource: 'steps',
      thresholds: { minimum: 1000, target: 8000, stretch: 10000 }, reminderTime: '17:00' }, date);
    await page.evaluate(snapshot => new Promise((resolve, reject) => {
      const open = indexedDB.open('one-life', 1);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('state', 'readwrite');
        tx.objectStore('state').put(snapshot, 'app');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => reject(tx.error);
      };
    }), data);
    await page.reload();
    await page.waitForFunction(() => window.readPlans.length >= 2 && window.readPlans.at(-1) === false);
    for (const [steps, complete] of [[8000, true], [1500, false]]) {
      await page.evaluate(steps => {
        window.steps = steps;
        window.readPlans.length = 0;
        window.dispatchEvent(new Event('one-life-phone-activity'));
      }, steps);
      await page.waitForFunction(expected => window.readPlans.at(-1) === expected, complete);
    }
  } finally { await context.close(); }
});

test('Today shows Sparky above the next habit and opens a pinned exercise after reload', { timeout: 30000 }, async () => {
  const context = await browser.newContext(phone);
  try {
    const page = await context.newPage();
    await page.goto(url);
    await page.locator('#budget-coach').waitFor();
    assert.ok(await page.locator('#budget-coach').evaluate((coach) =>
      coach.compareDocumentPosition(document.querySelector('.next-action')) & Node.DOCUMENT_POSITION_FOLLOWING));
    await button(page, 'Life').click();
    await button(page, 'Programs').click();
    await button(page, 'Build confidence').click();
    await button(page, 'Save program').click();
    await button(page, 'Pin to Today').click();
    await button(page, 'Unpin from Today').waitFor();
    await page.reload();
    const pinned = page.getByRole('region', { name: 'Pinned program exercise' });
    await pinned.getByRole('heading', { name: 'Build confidence' }).waitFor();
    await button(pinned, 'Open program exercise').click();
    await button(page, 'Unpin from Today').click();
    await button(page, 'Pin to Today').click();
    await button(page, 'Unpin from Today').waitFor();
    await button(page, 'Remove program').click();
    const confirm = page.getByRole('dialog');
    await confirm.getByText('This also removes the pinned exercise from Today.').waitFor();
    await button(confirm, 'Cancel').click();
    await button(page, 'Unpin from Today').waitFor();
    await button(page, 'Remove program').click();
    await button(confirm, 'Confirm removal').click();
    await confirm.waitFor({ state: 'hidden' });
    await page.reload();
    assert.equal(await pinned.count(), 0);
  } finally { await context.close(); }
});

test('standalone Focus restores running and paused sessions and saves once', { timeout: 30000 }, async () => {
  const context = await browser.newContext(phone);
  try {
    const page = await context.newPage();
    await page.clock.install({ time: new Date(2026, 10, 18, 12) });
    await page.goto(url);
    await button(page, 'Life').click();
    await button(page, 'Focus').click();
    await button(page, 'Start focus session').click();
    await page.getByRole('timer').waitFor();
    await page.clock.fastForward(10000);
    await page.reload();
    await button(page, 'Open saved Focus session').click();
    assert.match(await page.getByRole('timer').textContent(), /^24:4[7-9]$|^24:50$/);
    await button(page, 'Pause').click();
    await button(page, 'Resume').waitFor();
    const paused = await page.getByRole('timer').textContent();
    await page.clock.fastForward(60000);
    await page.reload();
    await button(page, 'Open saved Focus session').click();
    assert.equal(await page.getByRole('timer').textContent(), paused);
    await button(page, 'Resume').click();
    await button(page, 'Pause').waitFor();
    await button(page, 'Stop and save').click();
    await page.getByText(/· Personal focus ·/).waitFor();
    assert.equal(await page.getByText(/· Personal focus ·/).count(), 1);
    await button(page, 'Today').click();
    assert.equal(await button(page, 'Open saved Focus session').count(), 0);
  } finally { await context.close(); }
});

test('Android terms are reviewable before acceptance and stay accepted locally', { timeout: 30000 }, async () => {
  const context = await browser.newContext(phone);
  try {
    await context.route('https://appassets.androidplatform.net/**', async (route) => {
      const local = new URL(route.request().url());
      const response = await context.request.get(url + local.pathname + local.search);
      await route.fulfill({ response });
    });
    const page = await context.newPage();
    await page.goto('https://appassets.androidplatform.net/index.html');
    const dialog = page.getByRole('dialog', { name: 'Welcome to Sparky' });
    await dialog.waitFor();
    assert.equal(await page.getByRole('navigation', { name: 'Main navigation' }).count(), 0);
    await dialog.locator('summary').filter({ hasText: 'Terms of use' }).click();
    await dialog.getByRole('heading', { name: 'Sparky and wellness guidance' }).waitFor();
    await dialog.locator('summary').filter({ hasText: 'Privacy notice' }).click();
    await dialog.getByRole('heading', { name: 'Optional connections and sharing' }).waitFor();
    await button(dialog, 'I agree to the terms').click();
    await page.getByRole('navigation', { name: 'Main navigation' }).waitFor();
    await page.reload();
    await page.getByRole('navigation', { name: 'Main navigation' }).waitFor();
    assert.equal(await dialog.count(), 0);
  } finally {
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
  }
});

test('Sparky shows both work and break countdowns including the final break', { timeout: 30000 }, async () => {
  const context = await browser.newContext(phone);
  try {
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.focusCues = [];
      window.OneLifeAndroid = { postMessage(raw) {
        const { id, action, value } = JSON.parse(raw);
        if (action === 'focusCue') window.focusCues.push(JSON.parse(value));
        queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ id, value: true }) }));
      } };
    });
    await page.clock.install({ time: new Date(2026, 10, 18, 12) });
    await page.goto(url);
    await button(page, 'Life').click();
    await button(page, 'Focus').click();
    await button(page, 'Start focus session').click();
    const stage = page.getByRole('dialog', { name: 'Focus: Personal focus' });
    await text(stage, 'Work 1 of 2');
    assert.match(await stage.getByRole('timer').textContent(), /^(25:00|24:59)$/);
    await page.clock.fastForward(25 * 60000);
    await text(stage, 'Break 1 of 2');
    assert.match(await stage.getByRole('timer').textContent(), /^(5:00|4:59)$/);
    await page.clock.fastForward(5 * 60000);
    await text(stage, 'Work 2 of 2');
    await page.clock.fastForward(25 * 60000);
    await text(stage, 'Break 2 of 2');
    await page.clock.fastForward(5 * 60000);
    await text(stage, 'Finished');
    await text(stage, '50:00 of focused time');
    assert.deepEqual(await page.evaluate(() => window.focusCues), ['break', 'work', 'break', 'finished'].map((phase) =>
      ({ phase, sound: true, vibration: true })));
  } finally { await context.close(); }
});

test('program tips use the existing Android coach with only the selected exercise and question', { timeout: 30000 }, async () => {
  const context = await browser.newContext(phone);
  try {
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.OneLifeAndroid = { postMessage(raw) {
        const { id, action, value } = JSON.parse(raw);
        let result = true;
        if (action === 'chatModels') result = [{ id: 'gpt-5-mini', name: 'GPT 5 mini' }];
        if (action === 'chatAsk') { window.tipRequest = JSON.parse(value); result = 'Try a quick hello at checkout.'; }
        queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ id, value: result }) }));
      } };
    });
    await page.goto(url);
    await button(page, 'Life').click();
    await button(page, 'Programs').click();
    await button(page, 'Build confidence').click();
    await button(page, 'Save program').click();
    await page.getByLabel('Practice difficulty').selectOption('8');
    await text(page, 'Lead a short group discussion or give a brief talk. Invite questions and ask someone you trust for specific feedback.');
    await page.reload();
    await button(page, 'Life').click();
    await button(page, 'Programs').click();
    assert.equal(await page.getByLabel('Practice difficulty').inputValue(), '8');
    await page.getByLabel('Practice difficulty').selectOption('1');
    await page.getByLabel('What did you learn?').fill('Private journal example');
    await button(page, 'Save notes').click();
    await button(page, 'Ask ChatGPT for tips').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Your question (optional)').fill('What should I say?');
    await button(dialog, 'Send to ChatGPT').click();
    await text(dialog, 'Try a quick hello at checkout.');
    const { messages } = await page.evaluate(() => window.tipRequest);
    assert.equal(messages.length, 1);
    assert.match(messages[0].content, /checkout/);
    assert.match(messages[0].content, /What should I say/);
    assert.doesNotMatch(messages[0].content, /Private journal example/);
  } finally { await context.close(); }
});

test('programs and focus history persist and progress cards export a real PNG', { timeout: 30000 }, async () => {
  const context = await browser.newContext(phone);
  try {
    const page = await context.newPage();
    await page.goto(url);
    await button(page, 'Life').click();
    await button(page, 'Programs').click();
    await button(page, 'Read regularly').click();
    await button(page, 'Save program').click();
    await page.getByLabel('What did you do?').fill('Read the first chapter');
    await page.getByLabel('What did you learn?').fill('It helped to put my phone away.');
    await button(page, 'Count today').click();
    await text(page, '1 of 7 practice days · active');
    await button(page, 'Pause').click();
    await text(page, '1 of 7 practice days · paused');
    await button(page, 'Focus').click();
    await button(page, 'Start focus session').click();
    await page.getByRole('timer').waitFor();
    await page.getByText('0:01 of focused time').waitFor();
    await button(page, 'Stop and save').click();
    await page.getByText(/· Personal focus ·/).waitFor();
    await page.reload();
    await button(page, 'Life').click();
    await button(page, 'Programs').click();
    await text(page, '1 of 7 practice days · paused');
    await page.locator('summary').filter({ hasText: 'Practice journal' }).click();
    await text(page.getByRole('listitem').filter({ hasText: 'Read the first chapter' }), 'It helped to put my phone away.');
    await button(page, 'History').click();
    await button(page, 'Reports').click();
    await button(page, 'Share progress').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Format').selectOption('Square');
    await dialog.getByLabel('Include progress or streak').uncheck();
    const download = page.waitForEvent('download');
    await button(dialog, 'Save PNG').click();
    const result = await download;
    const png = await readFile(await result.path());
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), 1080);
    assert.equal(png.readUInt32BE(20), 1080);
  } finally { await context.close(); }
});

test('custom subareas and one-date measurements support history corrections', { timeout: 30000 }, async () => {
  const context = await browser.newContext(phone);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    await page.goto(url);
    await button(page, 'Settings').click();
    await button(page, 'Add area').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Area name').fill('Trail time');
    await dialog.getByLabel('Parent area (optional)').selectOption({ index: 1 });
    await button(dialog, 'Save area').click();
    await dialog.waitFor({ state: 'hidden' });
    await button(page, 'Add habit').click();
    await dialog.getByLabel('Habit name').fill('Trail distance');
    await dialog.getByLabel('Tracking').selectOption('measurement');
    await dialog.getByLabel('Measurement unit').fill('km');
    await dialog.getByLabel('Schedule').selectOption('once');
    await dialog.getByLabel('Minimum', { exact: true }).fill('0.5');
    await dialog.getByLabel('Target', { exact: true }).fill('1.5');
    await dialog.getByLabel('Stretch', { exact: true }).fill('2.5');
    await button(dialog, 'Save habit').click();
    await dialog.waitFor({ state: 'hidden' });
    await button(page, 'Today').click();
    await button(page, 'Trail distance').click();
    await button(dialog, 'Log 1.5 km').click();
    await dialog.waitFor({ state: 'hidden' });
    await button(page, 'History').click();
    await button(page, 'Edit Trail distance entry').click();
    await dialog.getByLabel('Amount (km)').fill('2.5');
    await button(dialog, 'Log 2.5 km').click();
    await dialog.waitFor({ state: 'hidden' });
    await text(page, '2.5 km · Stretch reached');
  } finally { await context.close(); }
});

test('the Sparky preview responds to petting', { timeout: 30000 }, async () => {
  const context = await browser.newContext(phone);
  try {
    const page = await context.newPage();
    await page.goto(url + '/#sparky');
    const card = page.locator('#budget-coach');
    await button(card, 'Pet Sparky').click();
    await text(card, 'Sparky leans into your hand.');
    assert.equal(await page.locator('.budget-turtle').getAttribute('data-cue'), 'greeting');
    assert.equal(await page.getByRole('button', { name: 'Turn Sparky' }).count(), 0);
  } finally { await context.close(); }
});

test('reading can be entered manually and timed across a reload', { timeout: 30000 }, async () => {
  const context = await browser.newContext(phone);
  try {
    const page = await context.newPage();
    const start = new Date(2026, 10, 18, 12);
    await page.clock.setFixedTime(start);
    await page.goto(url);
    await button(page, 'Read').click();
    await button(page, '30 min').click();
    await button(page, 'Log 30 min').click();
    await button(page, 'Read').click();
    await button(page, 'Start focus').click();
    const focus = page.getByRole('dialog', { name: 'Focus: Read' });
    await focus.getByRole('timer').waitFor();
    await button(focus, 'Minimize focus').click();
    await focus.waitFor({ state: 'hidden' });
    await button(page, 'Open focus with Sparky').click();
    await focus.waitFor();
    await page.reload();
    await page.clock.setFixedTime(new Date(+start + 19 * 60000));
    await page.getByRole('dialog', { name: 'Focus: Read' }).getByRole('timer').waitFor();
    assert.match(await focus.getByRole('timer').textContent(), /^\+\d+:\d\d$/, 'already past the 20 min target, so it counts up');
    await button(focus, 'Stop and save').click();
    await focus.waitFor({ state: 'hidden' });
    await button(page, 'Read').click();
    assert.equal(await page.getByLabel('Amount (min)').inputValue(), '49');
  } finally { await context.close(); }
});
const button = (page, name) => page.getByRole('button', { name, exact: true });
const text = (page, value) => page.getByText(value, { exact: true }).waitFor();
// Phone connections moved under Settings (General | Phone) when the app went to four tabs.
const open = async (page, tab) => {
  await button(page.getByRole('navigation'), tab === 'Phone' ? 'Settings' : tab).click();
  if (tab === 'Phone') await button(page.getByRole('group', { name: 'Settings view' }), 'Phone').click();
};

test('mobile habits, levels, rest, check-ins, history, backup, and restore work end to end', { timeout: 60000 }, async () => {
  const context = await browser.newContext(phone);
  try {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);
    await page.getByRole('heading', { name: 'Today’s habits' }).waitFor();
    const initial = await page.locator('.progress-total').textContent();
    assert.match(initial, /^0 \/ [67]$/);
    assert.equal(await page.locator('body').evaluate((body) => body.scrollWidth), 390);

    await button(page, 'Add habit').click();
    await page.getByLabel('Habit name').fill('Water plants');
    await page.getByLabel('Tracking').selectOption('count');
    await page.getByLabel('Count unit').fill('pots');
    await page.getByLabel('Minimum', { exact: true }).fill('1');
    await page.getByLabel('Target', { exact: true }).fill('2');
    await page.getByLabel('Stretch', { exact: true }).fill('3');
    const todayIndex = await page.evaluate(() => (new Date().getDay() + 6) % 7);
    const weekdays = page.getByRole('group', { name: /Scheduled days/ }).getByRole('button');
    for (let index = 0; index < 7; index++) if (index !== todayIndex) await weekdays.nth(index).click();
    await button(page, 'Save habit').click();
    await button(page, 'Water plants').waitFor();
    await button(page, 'Water plants').click();
    await page.getByRole('button', { name: /minimum 1/i }).click();
    await button(page, 'Log 1 pots').click();
    await text(page, 'Minimum reached');
    await button(page, 'Water plants').click();
    await page.getByRole('button', { name: /stretch 3/i }).click();
    await button(page, 'Log 3 pots').click();
    await text(page, 'Stretch reached');

    await button(page, 'Complete Gratitude').click();
    await button(page, 'Undo Gratitude').click();
    await button(page, 'Complete Gratitude').waitFor();
    await button(page, 'Move or train').click();
    await button(page, 'Planned rest').click();
    await text(page, 'Planned rest');
    await button(page, 'Read').click();
    await button(page, 'Skip today').click();
    await text(page, 'Skipped');
    const scheduled = Number(initial.split('/')[1]);
    assert.equal(await page.locator('.progress-total').textContent(), `1 / ${scheduled}`);

    await button(page, 'Water plants').click();
    await button(page, 'Edit habit').click();
    await page.getByLabel('Habit name').fill('Water balcony plants');
    await button(page, 'Save habit').click();
    await button(page, 'Water balcony plants').waitFor();

    await button(page.getByRole('group', { name: 'Today view' }), 'Check-in').click();
    await button(page, 'Mood: Good (4 of 5)').click();
    await button(page, 'Energy: Steady (3 of 5)').click();
    await page.getByText('Checked in. A reflection is optional.').waitFor();
    await page.getByLabel('Reflection').fill('Enjoyed tending the balcony.');
    await button(page, 'Save reflection').click();
    await page.getByText('Checked in. A reflection is optional.').waitFor();

    await page.reload();
    await button(page, 'Water balcony plants').waitFor();
    await button(page.getByRole('group', { name: 'Today view' }), 'Check-in').click();
    assert.equal(await button(page, 'Mood: Good (4 of 5)').getAttribute('aria-pressed'), 'true');
    await button(page.getByRole('group', { name: 'Today view' }), 'Habits').click();
    await open(page, 'History');
    assert.equal(await page.locator('.history-days button').count(), 7);
    await text(page, 'Water plants');
    await text(page, 'Enjoyed tending the balcony.');
    await button(page, 'Previous week').click();
    await page.locator('.history-days button').first().click();
    await text(page, 'Nothing was logged this day. Tomorrow is a fresh start.');

    await open(page, 'Settings');
    await button(page, 'Dark').click();
    await page.locator('html[data-theme="dark"]').waitFor({ state: 'attached' });
    await button(page, 'Experiences & courage').click();
    await page.getByLabel('Area name').fill('Experiences');
    await button(page, 'Save area').click();
    await button(page, 'Experiences').waitFor();
    await button(page, 'Water balcony plants 1 day per week').click();
    await button(page, 'Remove habit').click();
    await button(page, 'Remove from plan').click();
    await button(page, 'Water balcony plants 1 day per week').waitFor({ state: 'detached' });

    const downloaded = page.waitForEvent('download');
    await button(page, 'Export JSON').click();
    const download = await downloaded;
    const exported = await readFile(await download.path());
    const backup = JSON.parse(exported.toString());
    assert.equal(backup.settings.theme, 'dark');
    assert.equal(backup.checkIns[0].note, 'Enjoyed tending the balcony.');
    assert.ok(backup.habits.find((habit) => habit.title === 'Water balcony plants').archivedAt);

    const upload = page.getByLabel('Import JSON', { exact: true });
    await upload.setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
    await page.getByRole('alert').waitFor();
    await button(page, 'Reset all data').click();
    await button(page.getByRole('dialog'), 'Reset all data').click();
    await page.locator('html[data-theme="light"]').waitFor({ state: 'attached' });
    await upload.setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: exported });
    await page.getByRole('dialog').waitFor();
    await button(page, 'Cancel').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    await upload.setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: exported });
    await button(page, 'Replace with backup').click();
    await page.locator('html[data-theme="dark"]').waitFor({ state: 'attached' });
    await open(page, 'History');
    await text(page, 'Enjoyed tending the balcony.');
    await open(page, 'Life');
    await button(page.getByRole('group', { name: 'Life view' }), 'Coach').click();
    await text(page, 'Your ChatGPT subscription is not connected.');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('production shell and IndexedDB keep working offline after the first load', { timeout: 25000 }, async () => {
  const context = await browser.newContext({ ...phone, viewport: { width: 360, height: 800 } });
  try {
    const page = await context.newPage();
    await page.goto(url);
    await page.getByRole('heading', { name: 'Today’s habits' }).waitFor();
    assert.equal(await page.locator('body').evaluate((body) => body.scrollWidth), 360);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, undefined, { timeout: 6000 });
    const onlineBackground = await page.locator('html').evaluate((root) => getComputedStyle(root).backgroundColor);
    assert.notEqual(onlineBackground, 'rgba(0, 0, 0, 0)');
    await context.setOffline(true);
    await page.reload();
    await page.getByRole('heading', { name: 'Today’s habits' }).waitFor();
    // Newer headless Chromium keeps navigator.onLine true after setOffline; the banner can only be checked when it flips.
    if (!(await page.evaluate(() => navigator.onLine))) await text(page, 'Offline · changes save on this device');
    assert.equal(await page.locator('html').evaluate((root) => getComputedStyle(root).backgroundColor), onlineBackground);
    await button(page, 'Complete Gratitude').click();
    await button(page, 'Undo Gratitude').waitFor();
    await page.reload();
    await button(page, 'Undo Gratitude').waitFor();
  } finally {
    await context.close();
  }
});

test('skipping or missing a session offers a smaller step in the regular habit log', { timeout: 30000 }, async () => {
  const context = await browser.newContext({ ...phone, timezoneId: 'Europe/Belgrade' });
  try {
    const page = await context.newPage();
    const day = async (date) => {
      await page.clock.setFixedTime(new Date(`${date}T12:00:00+01:00`));
      await page.goto(url);
      await page.getByRole('heading', { name: 'Today’s habits' }).waitFor();
    };
    const read = page.locator('.habit-row').filter({ has: button(page, 'Read') });
    await day('2026-11-16');
    await button(page, 'Read').click();
    await button(page, 'Skip today').click();
    await read.getByText('Next session · 5 min').waitFor();
    await button(page, 'Meditate or reflect').click();
    await button(page, 'Planned rest').click();
    await page.locator('.habit-row').filter({ has: button(page, 'Meditate or reflect') }).getByText('Planned rest').waitFor();

    await day('2026-11-17');
    await button(page, 'Read').click();
    assert.equal(await page.getByLabel('Amount (min)').inputValue(), '5');
    await page.keyboard.press('Escape');
    const rest = page.locator('.habit-row').filter({ has: button(page, 'Meditate or reflect') });
    assert.equal(await rest.getByText(/Easier step/).count(), 0);
    await button(page, 'Gratitude').click();
    await button(page, 'Log easier step').click();

    await day('2026-11-18');
    await button(page, 'Read').click();
    assert.equal(await page.getByLabel('Amount (min)').inputValue(), '2');
    await button(page, 'Log 2 min').click();
    await read.getByText('Restart logged', { exact: true }).waitFor();

    await day('2026-11-19');
    await button(page, 'Read').click();
    assert.equal(await page.getByLabel('Amount (min)').inputValue(), '20');
  } finally {
    await context.close();
  }
});

test('Up next offers a one-tap target and celebrates each new completion', { timeout: 25000 }, async () => {
  const context = await browser.newContext(phone);
  try {
    const page = await context.newPage();
    await page.goto(url);
    await button(page, 'Up next Read').click();
    assert.equal(await page.getByLabel('Amount (min)').inputValue(), '20');
    await button(page, 'Log 20 min').click();
    const celebration = page.getByRole('status').filter({ hasText: '20 min · Target reached' });
    await celebration.waitFor();
    const circle = celebration.locator('.completion-ring');
    const check = celebration.locator('.completion-check');
    assert.equal(await circle.evaluate((element) => getComputedStyle(element).animationName), 'draw-completion');
    assert.equal(await check.evaluate((element) => getComputedStyle(element).animationDelay), '0.14s');
    await button(page, 'Up next Move or train').waitFor();

    await button(page, 'Read').click();
    await page.getByLabel('Note').fill('Finished a chapter.');
    await button(page, 'Log 20 min').click();
    await celebration.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.completion-mark').count(), 0);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await button(page, 'Up next Move or train').click();
    await button(page, 'Log 20 min').click();
    await celebration.waitFor();
    assert.equal(await circle.evaluate((element) => getComputedStyle(element).animationName), 'none');
    assert.equal(await check.evaluate((element) => getComputedStyle(element).strokeDashoffset), '0px');
  } finally {
    await context.close();
  }
});

test('avoidance, reports, goals, timeline and the coaching diary persist', { timeout: 45000 }, async () => {
  const context = await browser.newContext(phone);
  try {
    const page = await context.newPage();
    await page.goto(url);
    await button(page, 'Add habit').click();
    await page.getByLabel('Habit name').fill('Eating sweets');
    await page.getByLabel('Tracking').selectOption('avoid');
    await button(page, 'Save habit').click();
    await text(page, 'Awaiting check-in');
    await button(page, 'Eating sweets').click();
    await button(page, 'A little').click();
    await text(page, 'Slipped a little · counts as minimum');
    await button(page, 'Eating sweets').click();
    await button(page, 'A lot').click();
    await text(button(page, 'Eating sweets'), 'Slipped a lot');
    assert.equal(await button(page, 'Avoided Eating sweets').count(), 0, 'a slip is settled: no circle asking to finish it');
    await button(page, 'Eating sweets').click();
    await button(page, 'I avoided it').click();
    await text(button(page, 'Eating sweets'), 'Avoided');
    await open(page, 'History');
    await text(page.locator('.history-panel'), 'Avoided');
    await button(page, 'Reports').click();
    const labels = ['Week', 'Month', 'Quarter', '6 months', 'Year'];
    for (const label of labels) await button(page, label).click();
    await page.getByRole('heading', { name: 'Review', exact: true }).waitFor();

    await open(page, 'Life');
    await button(page, 'Add goal').click();
    await page.getByLabel('Title').fill('Run further');
    await page.getByLabel('Unit').fill('km');
    await page.getByLabel('Target value').fill('5');
    await button(page, 'Save').click();
    await button(page, 'Record measurement').click();
    await page.getByLabel('Measured value').fill('3.5');
    await button(page, 'Save').click();
    await text(page, '3.5 km');
    // Goals and Timeline are one section: the timeline sits under the goals.
    assert.equal(await page.getByRole('group', { name: 'Life view' }).getByRole('button', { name: 'Timeline' }).count(), 0);
    await button(page, 'Add entry').click();
    await page.getByLabel('Title').fill('First outdoor run');
    await page.getByLabel('Kind').selectOption('Milestone');
    await button(page, 'Save').click();
    await text(page, 'First outdoor run');

    await open(page, 'Life');
    await button(page.getByRole('group', { name: 'Life view' }), 'Coach').click();
    await page.getByLabel('Morning plan').fill('Walk after lunch');
    await page.getByLabel('Evening reflection').fill('A short walk worked well.');
    await button(page, 'Save notes').click();
    await text(page, 'Daily coaching notes saved.');
    await button(page, 'Prepare weekly summary').click();
    assert.match(await page.getByLabel('Summary to share').inputValue(), /logged 1 habit action\./);
    await page.reload();
    await open(page, 'Life');
    await button(page.getByRole('group', { name: 'Life view' }), 'Coach').click();
    assert.equal(await page.getByLabel('Evening reflection').inputValue(), 'A short walk worked well.');
    await open(page, 'Life');
    await text(page, '3.5 km');
  } finally { await context.close(); }
});

test('History date selection and report navigation use calendar periods', { timeout: 30000 }, async () => {
  const context = await browser.newContext({ ...phone, timezoneId: 'Europe/Belgrade' });
  try {
    const page = await context.newPage();
    await page.clock.install({ time: new Date('2024-03-31T12:00:00+02:00') });
    await page.goto(url);
    await open(page, 'History');
    const picker = page.getByLabel('Choose date', { exact: true });
    await picker.fill('2024-02-29');
    await button(page, 'Reports').click();
    await button(page, 'Month').click();
    const heading = (name) => page.getByRole('heading', { name, exact: true }).waitFor();
    await heading('Feb 1, 2024 to Feb 29, 2024');
    await button(page, 'Next month').click();
    await heading('Mar 1, 2024 to Mar 31, 2024');
    assert.ok(await button(page, 'Next month').isDisabled());
    await button(page, 'Quarter').click();
    await heading('Jan 1, 2024 to Mar 31, 2024');
    await button(page, '6 months').click();
    await button(page, 'Previous 6 months').click();
    await heading('Jul 1, 2023 to Dec 31, 2023');
    await page.locator('.heatmap').getByRole('button', { name: /^Nov 15, 2023,/ }).click();
    assert.equal(await picker.inputValue(), '2023-11-15');
    await button(page, 'Phone activity').click();
    await heading('Wednesday, November 15, 2023');
    await button(page, 'Month').click();
    await page.getByLabel('Activity day').selectOption('2023-11-04');
    await button(page, 'Daily').click();
    assert.equal(await picker.inputValue(), '2023-11-04');
  } finally { await context.close(); }
});

test('phone activity refreshes hourly and shows today, calendar week, calendar month and a chosen day', { timeout: 25000 }, async () => {
  const context = await browser.newContext(phone);
  try {
    await context.addInitScript(() => {
      window.usageSeconds = 7200;
      let revisions = 0;
      window.OneLifeAndroid = { postMessage(message) {
        const { id, action, value: argument } = JSON.parse(message);
        const now = new Date();
        const dateKey = (day) => `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
        const date = dateKey(now);
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        const previous = dateKey(yesterday);
        const older = '2026-10-18';
        const updated = now.getTime() + revisions++;
        if (action === 'pausePhoneActivity' && argument === 'usage') sessionStorage.setItem('usagePaused', 'true');
        const usageEnabled = !sessionStorage.getItem('usagePaused');
        const value = action === 'phoneActivity' ? {
          health: { state: 'connected', sleep: true, steps: true, background: true }, usage: { state: usageEnabled ? 'connected' : 'off' },
          sleep: { from: previous, through: date, updated, days: [{ date, minutes: 435, source: 'Health Connect' }] },
          steps: { from: previous, through: date, updated, days: [
            { date, steps: 6872, hours: [{ hour: 8, value: 2000 }, { hour: 9, value: 4872 }] },
            { date: previous, steps: 2530 },
          ] },
          screen: usageEnabled ? { updated, days: [
            { date: older, seconds: 1800, apps: [{ id: 'books', name: 'Books', seconds: 1800 }] },
            { date: previous, seconds: 3600, apps: [{ id: 'maps', name: 'Maps', seconds: 3600 }] },
            { date, seconds: window.usageSeconds, apps: [{ id: 'video', name: 'Video', seconds: window.usageSeconds }],
              hours: [8, 9, 10].map((hour) => ({ hour, value: Math.min(3600, Math.max(0, window.usageSeconds - (hour - 8) * 3600)) })) },
          ] } : undefined,
        } : action === 'calendar' ? [{ title: 'Example event', start: updated, allDay: false }] : true;
        queueMicrotask(() => this.onmessage({ data: JSON.stringify({ id, value }) }));
      } };
    });
    const page = await context.newPage();
    await page.clock.install({ time: new Date(2026, 10, 18, 12) });
    await page.goto(url);
    await open(page, 'History');
    await text(page, '7 h 15 min · Health Connect');
    await button(page, 'Phone activity').click();
    await text(page, '6,872');
    await text(page, 'Apps used today');
    await text(page, 'Video');
    await page.getByRole('group', { name: 'Steps by hour' }).getByRole('img', { name: '08:00, 2,000 steps' }).waitFor();
    await page.getByRole('group', { name: 'Screen time by hour' }).getByRole('img', { name: '09:00, 1 h 0 min' }).waitFor();
    assert.equal(await page.getByText('Maps', { exact: true }).count(), 0);
    assert.equal(await page.locator('body').evaluate((body) => body.scrollWidth), 390);

    await page.evaluate(() => { window.usageSeconds = 9000; });
    await page.clock.fastForward(60 * 60 * 1000);
    await page.getByRole('group', { name: 'Screen time by hour' }).getByRole('img', { name: '10:00, 0 h 30 min' }).waitFor();

    await button(page, 'Week').click();
    await text(page, 'Nov 16 to Nov 22, 2026');
    await text(page, '9,402');
    assert.equal(await page.locator('body').evaluate((body) => body.scrollWidth), 390);
    await text(page, 'Video');
    await text(page, 'Maps');
    await page.getByRole('group', { name: 'Daily screen time' }).getByRole('button', { name: /, 1 h 0 min$/ }).click();
    await page.getByRole('heading', { name: 'Apps on Nov 17' }).waitFor();
    await text(page, '2,530');
    await text(page, 'Maps');
    assert.equal(await page.getByText('Video', { exact: true }).count(), 0);
    await button(page, 'Month').click();
    await page.getByRole('heading', { name: 'November 2026', exact: true }).waitFor();
    assert.equal(await page.locator('body').evaluate((body) => body.scrollWidth), 390);
    await page.getByLabel('Activity day').selectOption('2026-11-18');
    await text(page, 'Video');
    await button(page, 'Previous month').click();
    await page.getByRole('heading', { name: 'October 2026', exact: true }).waitFor();
    await text(page, 'Books');
    await button(page, 'Next month').click();

    await page.evaluate(() => {
      window.usageSeconds = 10800;
      window.dispatchEvent(new Event('one-life-phone-activity'));
    });
    await page.getByRole('group', { name: 'Daily screen time' }).getByRole('button', { name: /, 3 h 0 min$/ }).waitFor();

    await button(page, 'Phone connections').click();
    await page.getByRole('heading', { name: 'Phone connections' }).waitFor();
    await button(page, 'Show upcoming events').click();
    await text(page, 'Example event');
    await button(page, 'Clear screen time history').click();
    await button(page, 'Confirm removal').click();
    await text(page, 'Screen time history cleared.');
    await page.reload();
    await open(page, 'History');
    await button(page, 'Phone activity').click();
    await text(page, 'No app activity recorded today.');
  } finally { await context.close(); }
});

test('daily app limits follow hourly usage, survive a reload, and keep earlier results', { timeout: 25000 }, async () => {
  const context = await browser.newContext(phone);
  try {
    await context.addInitScript(() => {
      let revision = 0;
      const first = '2026-11-18';
      const video = { id: 'video', name: 'Video' };
      window.OneLifeAndroid = { postMessage(message) {
        const { id, action } = JSON.parse(message);
        const now = new Date();
        const day = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
        const seconds = Number(sessionStorage.getItem('videoSeconds') ?? 1500);
        const days = [{ date: first, seconds, apps: [{ ...video, seconds }] }];
        if (day !== first) days.push({ date: day, seconds: 60, apps: [{ id: 'maps', name: 'Maps', seconds: 60 }] });
        const value = action === 'phoneActivity' ? {
          health: { state: 'off' }, usage: { state: 'connected' }, screen: { updated: now.getTime() + revision++, days },
        } : true;
        queueMicrotask(() => this.onmessage({ data: JSON.stringify({ id, value }) }));
      } };
    });
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    await page.clock.install({ time: new Date(2026, 10, 18, 12) });
    await page.goto(url);
    await open(page, 'Life');
    const limits = page.getByRole('region', { name: 'App limits' });
    await button(limits, 'Set app limit').click();
    await page.getByRole('dialog', { name: 'Set app limit' }).getByRole('combobox').selectOption('video');
    await page.getByLabel('Daily limit in minutes').fill('30');
    await button(page, 'Save limit').click();
    await text(limits, 'Under limit · 5 min left');

    await page.evaluate(() => sessionStorage.setItem('videoSeconds', '1800'));
    await page.clock.fastForward(60 * 60 * 1000);
    await text(limits, 'At limit');
    await page.evaluate(() => sessionStorage.setItem('videoSeconds', '2160'));
    await page.clock.fastForward(60 * 60 * 1000);
    await text(limits, 'Over limit · 6 min over');
    assert.equal(await page.locator('body').evaluate((body) => body.scrollWidth), 390);

    await page.reload();
    await open(page, 'History');
    await button(page, 'Phone activity').click();
    await text(limits, 'Over limit · 6 min over');
    await page.clock.fastForward(24 * 60 * 60 * 1000);
    await text(limits, 'Under limit · 30 min left');
    await button(limits, 'Edit Video limit').click();
    await page.getByLabel('Daily limit in minutes').fill('45');
    await button(page, 'Save limit').click();
    await text(limits, 'Under limit · 45 min left');
    await button(limits, 'Edit Video limit').click();
    await button(page, 'Pause limit').click();
    await text(page, 'App limit paused.');

    await button(page, 'Week').click();
    await text(limits, '0 of 1 completed days at or under');
    await page.getByLabel('Activity day').selectOption('2026-11-18');
    await text(limits, 'Daily limit 30 min');
    await text(limits, 'Over limit · 6 min over');
  } finally { await context.close(); }
});

test('the plush turtle uses still poses with reduced motion and plays clips when motion is enabled', { timeout: 12000 }, async () => {
  const context = await browser.newContext({ ...phone, reducedMotion: 'reduce' });
  try {
    const page = await context.newPage();
    // The plan starts the day before, so this evening is scored normally (day one with nothing logged is a welcome).
    await page.clock.install({ time: new Date(2026, 10, 17, 10, 0) });
    await page.goto(url);
    await button(page, 'Pet Sparky').waitFor();
    await page.clock.setSystemTime(new Date(2026, 10, 18, 20, 59));
    await page.reload();
    const turtle = button(page, 'Pet Sparky');
    await turtle.waitFor();
    assert.equal(await turtle.getAttribute('data-renderer'), 'sprite');
    const artwork = turtle.locator('.turtle-sprite');
    assert.equal(await artwork.evaluate((element) => getComputedStyle(element).animationName), 'none');
    assert.equal((await page.request.get(`${url}/turtle-plush-poses.png`)).ok(), true);
    await turtle.click();
    await text(turtle, 'Sparky leans into your hand.');
    assert.equal(await turtle.locator('.turtle-sprite.proud').count(), 0);
    await page.clock.fastForward(1500);
    await turtle.locator('.turtle-sprite.ready').waitFor();
    await page.clock.fastForward(120000);
    await turtle.locator('.turtle-sprite.disappointed').waitFor();
    await page.getByText(/Evening check · 0 of [67] habits done/).waitFor();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await turtle.scrollIntoViewIfNeeded();
    const canvas = page.locator('.budget-turtle[data-renderer="clip"] .turtle-canvas');
    await canvas.waitFor();
    const neutralFrame = await canvas.evaluate((element) => element.toDataURL());
    await page.clock.runFor(700);
    assert.notEqual(await canvas.evaluate((element) => element.toDataURL()), neutralFrame);
    await page.clock.fastForward(4200);
    await page.clock.runFor(80);
    const restingFrame = await canvas.evaluate((element) => element.toDataURL());
    await page.clock.runFor(420);
    assert.notEqual(await canvas.evaluate((element) => element.toDataURL()), restingFrame);

  } finally { await context.close(); }
});

test('each completed habit gets a short reaction and the evening check uses the chosen local time', { timeout: 20000 }, async () => {
  const context = await browser.newContext(phone);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    await page.clock.install({ time: new Date(2026, 10, 18, 20, 59) });
    await page.goto(url);
    const turtle = button(page, 'Pet Sparky');
    const cue = page.locator('.budget-turtle[data-cue="habit"]');
    await page.locator('.budget-turtle[data-renderer="clip"]').waitFor();
    await button(page, 'Complete Gratitude').click();
    await cue.waitFor();
    await turtle.scrollIntoViewIfNeeded();
    await cue.waitFor({ state: 'hidden' });
    await button(page, 'Undo Gratitude').click();
    assert.equal(await turtle.getAttribute('data-cue'), null);
    await button(page, 'Complete Gratitude').click();
    await cue.waitFor();

    await button(page, 'Budget coach settings').click();
    const settings = page.getByRole('dialog', { name: 'Budget coach settings' });
    await settings.getByLabel('Evening check').selectOption('22');
    await button(settings, 'Save settings').click();
    await settings.waitFor({ state: 'hidden' });
    await page.clock.fastForward(120000);
    assert.equal(await page.getByText(/Evening check ·/).count(), 0);
    await page.clock.fastForward(60 * 60 * 1000);
    await page.getByText(/Evening check · 1 of [67] habits done/).waitFor();
    assert.equal(await page.locator('#budget-coach').getAttribute('data-pose'), 'disappointed');
    await page.reload();
    await page.getByText(/Evening check · 1 of [67] habits done/).waitFor();
    assert.equal(await turtle.getAttribute('data-cue'), null);
  } finally { await context.close(); }
});

test('a shared limit drives the turtle, reset, widget controls and past results', { timeout: 30000 }, async () => {
  const context = await browser.newContext(phone);
  try {
    await context.addInitScript(() => {
      const tiktok = { id: 'tt', name: 'TikTok' };
      const instagram = { id: 'ig', name: 'Instagram' };
      const discord = { id: 'dc', name: 'Discord' };
      const settings = { id: 'settings', name: 'Settings' };
      const first = '2026-11-18';
      let revision = 0;
      window.pinnedWidgets = [];
      window.OneLifeAndroid = { postMessage(message) {
        const { id, action, value: argument } = JSON.parse(message);
        if (action === 'syncBudgetPlan') window.syncedBudget = JSON.parse(argument);
        if (action === 'addHomeWidget') window.pinnedWidgets.push(argument);
        const now = new Date();
        const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
        const firstDay = sessionStorage.getItem('laterUsage')
          ? [{ ...tiktok, seconds: 6600 }, { ...instagram, seconds: 3840 }, { ...discord, seconds: 720 }]
          : [{ ...tiktok, seconds: 4200 }, { ...instagram, seconds: 2700 }];
        firstDay.push({ ...settings, seconds: 1200 });
        const day = (date, apps) => ({ date, apps, seconds: apps.reduce((total, app) => total + app.seconds, 0) });
        const days = [day(first, firstDay)];
        if (date > first) days.push(day(date, [{ ...tiktok, seconds: 10860 }, { ...instagram, seconds: 900 }, { ...discord, seconds: 600 }]));
        const value = action === 'installedUsageApps' ? [tiktok, instagram, discord, settings] : action === 'phoneActivity' ? {
          health: { state: 'off' }, usage: { state: 'connected' }, screen: { updated: now.getTime() + revision++, days },
        } : action === 'phoneHabitActions' ? { open: window.openBudgetWidget ? { habitId: '', date, section: 'budget' } : null } : true;
        if (action === 'phoneHabitActions') window.openBudgetWidget = false;
        queueMicrotask(() => this.onmessage({ data: JSON.stringify({ id, value }) }));
      } };
    });
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    await page.clock.install({ time: new Date(2026, 10, 18, 12) });
    await page.goto(url);
    await open(page, 'Life');
    const limits = page.getByRole('region', { name: 'App limits' });
    await button(limits, 'Set shared limit').click();
    const dialog = page.getByRole('dialog', { name: 'Set shared limit' });
    await dialog.getByLabel('Shared limit name').fill('Social media');
    await dialog.getByRole('checkbox', { name: 'TikTok' }).check();
    await dialog.getByRole('checkbox', { name: 'Instagram' }).check();
    await dialog.getByLabel('Find an app').fill('discord');
    await dialog.getByRole('checkbox', { name: 'Discord' }).check();
    await dialog.getByLabel('Daily limit in minutes').fill('180');
    await button(dialog, 'Save limit').click();
    await text(limits, 'Shared daily limit 3 h');
    await text(limits, '1 h 55 min used');
    await text(limits, 'Under limit · 1 h 5 min left');
    await limits.getByText('3 apps share this limit', { exact: true }).click();
    await text(limits, 'Discord');
    await text(limits, '0 min');

    await button(limits, 'Set app limit').click();
    const individual = page.getByRole('dialog', { name: 'Set app limit' });
    await individual.getByRole('combobox').selectOption('tt');
    await individual.getByLabel('Daily limit in minutes').fill('60');
    await button(individual, 'Save limit').click();
    await text(limits, 'Daily limit 1 h');

    await open(page, 'Today');
    const turtle = page.getByRole('region', { name: 'Social media' });
    await text(turtle, '1 h 5 min left');
    await page.clock.runFor(2600);
    await page.screenshot({path: '_work/daybook-native/budget-example.png', animations: 'disabled'});
    await text(turtle, '10 min over your TikTok limit.');
    assert.equal(await turtle.getAttribute('data-pose'), 'disappointed');
    await button(turtle, 'Budget coach settings').click();
    const settings = page.getByRole('dialog', { name: 'Budget coach settings' });
    await settings.getByLabel('My reset after going over').fill('Take a short walk.');
    await settings.getByRole('checkbox', { name: 'One heads-up per day at 75%' }).check();
    await button(settings, 'Save settings').click();
    await text(page, 'Budget coach settings saved.');
    await page.waitForFunction(() => window.syncedBudget?.headsUp === true);

    await page.evaluate(() => sessionStorage.setItem('laterUsage', 'true'));
    await page.clock.fastForward(60 * 60 * 1000);
    await text(turtle, '6 min over');
    assert.equal(await turtle.getAttribute('data-pose'), 'disappointed');
    await text(turtle, 'Take a short walk.');
    await button(turtle, 'I did my reset').click();
    await text(turtle, 'You followed through on your reset.');
    assert.equal(await turtle.getAttribute('data-pose'), 'disappointed');

    await open(page, 'Life');
    await text(limits, '3 h 6 min used');
    await text(limits, 'Over limit · 6 min over');
    assert.equal(await page.locator('body').evaluate((body) => body.scrollWidth), 390);

    await page.clock.fastForward(24 * 60 * 60 * 1000);
    await text(limits, '3 h 26 min used');
    await button(limits, 'Edit Social media limit').click();
    const edit = page.getByRole('dialog', { name: 'Edit shared limit' });
    await edit.getByRole('checkbox', { name: 'TikTok' }).uncheck();
    await edit.getByLabel('Daily limit in minutes').fill('120');
    await button(edit, 'Save limit').click();
    await text(limits, '25 min used');
    await button(limits, 'Edit Social media limit').click();
    await button(edit, 'Pause limit').click();
    await limits.getByText('Paused shared limits', { exact: true }).click();
    await button(limits, 'Resume Social media limit').click();
    assert.equal(await edit.getByLabel('Daily limit in minutes').inputValue(), '120');
    await button(edit, 'Save limit').click();

    await open(page, 'History');
    await button(page, 'Phone activity').click();
    await button(page, 'Week').click();
    await text(limits.locator('.app-limit-row').filter({ hasText: 'Social media' }), '0 of 1 completed days at or under');
    await page.getByLabel('Activity day').selectOption('2026-11-18');
    await text(limits, 'Shared daily limit 3 h');
    await text(limits, 'Over limit · 6 min over');

    await open(page, 'Phone');
    await button(page, 'Add Next habit widget').click();
    await text(page, 'Confirm the widget on your home screen.');
    await button(page, 'Add App budget widget').click();
    await page.waitForFunction(() => window.pinnedWidgets.length === 2);
    assert.deepEqual(await page.evaluate(() => window.pinnedWidgets), ['next', 'budget']);
    await page.evaluate(() => {
      window.openBudgetWidget = true;
      window.dispatchEvent(new Event('one-life-phone-action'));
    });
    await page.waitForFunction(() => document.activeElement?.id === 'budget-coach');
    await text(turtle, '1 h 35 min left');
  } finally { await context.close(); }
});

test('Android Coach connects, answers in-app with the app context, and signs out', { timeout: 35000 }, async () => {
  const context = await browser.newContext(phone);
  try {
    await context.addInitScript(() => {
      let authorized = false;
      let weekly = false;
      window.coachRequests = [];
      window.weeklyRequests = [];
      window.OneLifeAndroid = { postMessage(message) {
        const { id, action, value } = JSON.parse(message);
        let result;
        if (action === 'chatConnect') { authorized = true; result = true; }
        if (action === 'chatSignOut') { authorized = false; weekly = false; result = true; }
        if (action === 'weeklyStatus') result = weekly;
        if (action === 'weeklyEnable') { weekly = true; window.weeklyRequests.push(JSON.parse(value)); result = true; }
        if (action === 'weeklyDisable') { weekly = false; result = false; }
        if (action === 'chatStatus') result = { authorized, owner: authorized ? 'test-account' : '', registered: true, email: 'test@example.invalid', accounts: [] };
        if (action === 'chatModels') result = [{ id: 'test-model', name: 'Test model' }];
        if (action === 'exportChat') window.exportedChat = JSON.parse(value);
        if (action === 'chatAsk') {
          window.coachRequests.push(JSON.parse(value));
          result = 'Start with one small habit.';
        }
        queueMicrotask(() => this.onmessage({ data: JSON.stringify({ id, value: result }) }));
      } };
    });
    const page = await context.newPage();
    await page.goto(url);
    await open(page, 'Life');
    await button(page.getByRole('group', { name: 'Life view' }), 'Coach').click();
    await button(page, 'Continue with ChatGPT').click();
    await button(page, 'Review weekly AI sharing').click();
    assert.equal(await page.evaluate(() => window.weeklyRequests.length), 0);
    await page.getByLabel('Example weekly prompt').waitFor();
    await button(page, 'Allow automatic weekly AI reviews').click();
    await button(page, 'Turn off weekly AI reviews').click();
    await button(page, 'Review weekly AI sharing').waitFor();
    const weekly = await page.evaluate(() => window.weeklyRequests[0].prompt);
    assert.match(weekly, /scheduled targets/);
    assert.doesNotMatch(weekly, /Gratitude|journal|Sleep|Screen time/);
    await page.getByLabel('Question').fill('Help me choose a habit.');
    await button(page, 'Send').click();
    await text(page, 'Start with one small habit.');
    const first = await page.evaluate(() => window.coachRequests[0]);
    assert.equal(first.messages.length, 1);
    assert.equal(first.messages[0].content, 'Help me choose a habit.');
    assert.equal(first.model, 'test-model');
    await open(page, 'Today');
    await open(page, 'Life');
    await button(page.getByRole('group', { name: 'Life view' }), 'Coach').click();
    await text(page, 'Start with one small habit.');
    await button(page, 'Summarize my week').click();
    await page.getByLabel('Include an app context summary in this message').check();
    await page.getByLabel('App context sent to OpenAI').waitFor();
    await button(page, 'Send').click();
    await page.waitForFunction(() => window.coachRequests.length === 2);
    const second = await page.evaluate(() => window.coachRequests[1]);
    assert.equal(second.messages[1].role, 'assistant');
    assert.equal(second.messages[0].content, 'Help me choose a habit.');
    assert.match(second.messages[2].content, /^Here is what is going on in my Sparky habit app/);
    assert.match(second.messages[2].content, /My question: Summarize my week and suggest one practical adjustment for next week\.$/);
    await page.waitForFunction(() => !document.querySelector('.chat-privacy + label input')?.checked);
    assert.equal(await page.getByLabel('Include an app context summary in this message').isChecked(), false);
    await button(page, 'Export chat').click();
    await page.waitForFunction(() => window.exportedChat?.turns.length === 2);
    assert.equal(await page.evaluate(() => window.exportedChat.turns[0].question), 'Help me choose a habit.');
    await button(page, 'Sign out').click();
    await button(page, 'Continue with ChatGPT').waitFor();
    assert.equal(await button(page, 'Export chat').count(), 0);
    assert.equal(await page.getByRole('list', { name: 'Conversation' }).count(), 0);
  } finally { await context.close(); }
});

test('Break List presets set a deadline, outcomes update Android reminders, and Google Tasks can be displayed', { timeout: 35000 }, async () => {
  const context = await browser.newContext(phone);
  try {
    await context.addInitScript(() => {
      window.syncedReminderPlan = [];
      window.OneLifeAndroid = { postMessage(message) {
        const { id, action, value } = JSON.parse(message);
        let result = true;
        if (action === 'syncHabitReminders') window.syncedReminderPlan = JSON.parse(value);
        if (action === 'reminderStatus') result = '';
        if (action === 'chatStatus') result = { authorized: false, registered: false, email: '', accounts: [] };
        if (action === 'googleTaskStatus') result = false;
        if (action === 'googleTaskClear') window.taskClears = (window.taskClears ?? 0) + 1;
        if (action === 'googleTaskConnect') result = [{ id: 'personal', title: 'Personal' }];
        if (action === 'googleTaskItems') result = [{ id: 'task', title: 'Water the balcony plants', due: '' }];
        queueMicrotask(() => this.onmessage({ data: JSON.stringify({ id, value: result }) }));
      } };
    });
    const page = await context.newPage();
    await page.goto(url);
    await button(page, 'Break List').click();
    assert.ok(await page.getByRole('dialog').getByRole('button').count() > 10);
    await button(page, 'Eating sweets').click();
    assert.equal(await page.getByLabel('Habit name').inputValue(), 'Eating sweets');
    assert.equal(await page.getByLabel('Tracking').inputValue(), 'avoid');
    await page.getByLabel(/Check-in time/).fill('21:00');
    await button(page, 'Save habit').click();
    await button(page, 'Eating sweets').waitFor();
    await page.waitForFunction(() => window.syncedReminderPlan.some((item) => item.title === 'Eating sweets' && item.time === '21:00' && item.accountedFor.length === 0));
    await button(page, 'Eating sweets').click();
    await button(page, 'Normal amount').click();
    await page.waitForFunction(() => window.syncedReminderPlan.some((item) => item.title === 'Eating sweets' && item.accountedFor.length === 1));
    await open(page, 'Phone');
    await button(page, 'Connect Google Tasks').click();
    await text(page, 'Water the balcony plants');
    assert.equal(await page.getByLabel('Google Tasks list').inputValue(), 'personal');
    await button(page, 'Hide Google Tasks').click();
    assert.equal(await page.getByLabel('Google Tasks list').count(), 0);
    assert.equal(await page.evaluate(() => window.taskClears ?? 0), 0);
    await button(page, 'Show Google Tasks').click();
    await text(page, 'Water the balcony plants');
    await button(page, 'Disconnect Google Tasks').click();
    await button(page, 'Connect Google Tasks').waitFor();
    assert.equal(await page.evaluate(() => window.taskClears), 1);
    assert.equal(await page.getByLabel('Google Tasks list').count(), 0);
    await open(page, 'Life');
    await button(page.getByRole('group', { name: 'Life view' }), 'Coach').click();
    await button(page, 'Test connection').click();
    await text(page, 'Sparky reached OpenAI’s sign-in and ChatGPT services. You can sign in now.');
    // The result sits right under the button that was tapped, not above the explanation text.
    const tested = await button(page, 'Test connection').boundingBox();
    const result = await page.getByText('Sparky reached OpenAI’s sign-in').boundingBox();
    assert.ok(result.y > tested.y && result.y - tested.y < 160, `result ${result.y} vs button ${tested.y}`);
  } finally { await context.close(); }
});

test('daily priorities, flexible sessions, replacement plans, and phone actions persist together', { timeout: 45000 }, async () => {
  const context = await browser.newContext(phone);
  try {
    await context.addInitScript(() => {
      window.reminderRules = [];
      window.phoneAction = { completed: [], open: null };
      window.OneLifeAndroid = { postMessage(message) {
        const { id, action, value } = JSON.parse(message);
        let result = true;
        if (action === 'chatStatus') result = { authorized: false, registered: false, email: '', accounts: [] };
        if (action === 'reminderStatus') result = '';
        if (action === 'syncHabitReminders') window.reminderRules = JSON.parse(value);
        if (action === 'phoneHabitActions') result = window.phoneAction;
        if (action === 'ackPhoneHabitActions') {
          window.phoneScoreAck = JSON.parse(value);
          window.phoneAction = { completed: [], open: null };
        }
        queueMicrotask(() => this.onmessage({ data: JSON.stringify({ id, value: result }) }));
      } };
    });
    const page = await context.newPage();
    await page.goto(url);
    await button(page, 'Choose priorities').click();
    await page.getByRole('checkbox', { name: 'Read', exact: true }).check();
    await page.getByLabel('Cue for Read').fill('After coffee');
    await page.getByRole('checkbox', { name: /Use the minimum today/ }).check();
    await button(page, 'Save priorities').click();
    await text(page.locator('#today-plan'), 'After coffee');
    await text(page, 'Today’s minimum · 5 min');
    await button(page, 'Up next Read After coffee').click();
    await button(page, 'Log 5 min').waitFor();
    await page.keyboard.press('Escape');

    await button(page, 'Add habit').click();
    await page.getByLabel('Habit name').fill('Practice guitar');
    await page.getByRole('dialog').getByRole('combobox', { name: /^Schedule/ }).selectOption('weekly');
    await page.getByLabel('Sessions per week').fill('3');
    await button(page, 'Save habit').click();
    await text(page, '0 / 3 sessions at target');
    await button(page, 'Plan sessions').click();
    await page.getByRole('dialog').getByRole('checkbox').first().check();
    await button(page, 'Save sessions').click();
    await page.waitForFunction(() => window.reminderRules.some((item) => item.title === 'Practice guitar' && item.committedDates?.length === 1));

    await button(page, 'Break List').click();
    await button(page, 'Eating sweets').click();
    await page.getByLabel('When I’m tempted').fill('After dinner');
    await page.getByLabel('What I’ll do instead').fill('Make tea first');
    await page.getByLabel('Remind me before that').fill('17:00');
    await button(page, 'Save habit').click();
    await page.waitForFunction(() => window.reminderRules.some((item) => item.kind === 'replacement' && item.message === 'Make tea first' && item.time === '17:00'));
    await button(page, 'Eating sweets').click();
    await page.getByLabel('I used the replacement').check();
    await button(page, 'I avoided it').click();
    await open(page, 'History');
    await text(page, 'Used the replacement');

    await page.evaluate(() => {
      const date = window.reminderRules.find((rule) => rule.title === 'Practice guitar').committedDates[0];
      window.phoneAction = { completed: [{ id: 'queue-1', habitId: 'gratitude', date }], open: { habitId: 'practice-absent', date } };
      window.dispatchEvent(new Event('one-life-phone-action'));
    });
    await button(page, 'Undo Gratitude').waitFor();
    await page.waitForFunction(() => window.phoneScoreAck?.ids.includes('queue-1'));
    const acknowledged = await page.evaluate(() => window.phoneScoreAck.summary);
    assert.ok(acknowledged.done >= 1);
    assert.ok(!acknowledged.missed.includes('Gratitude'));
    await page.reload();
    await text(page.locator('#today-plan'), 'After coffee');
    await button(page, 'Undo Gratitude').waitFor();
    await open(page, 'Phone');
    await button(page, 'Add Today overview widget').click();
    await text(page, 'Confirm the widget on your home screen.');
  } finally { await context.close(); }
});

test('Sparky welcomes a return once and rechecks a real calendar opening before saving tomorrow', { timeout: 35000 }, async () => {
  const context = await browser.newContext(phone);
  try {
    await context.addInitScript(() => {
      window.OneLifeAndroid = { postMessage(message) {
        const { action, id, value: argument } = JSON.parse(message);
        let value = null;
        if (action === 'phoneActivity') value = { health: { state: 'off' }, usage: { state: 'off' } };
        if (action === 'requestCalendarRead') { sessionStorage.setItem('calendarAccess', 'yes'); value = true; }
        if (action === 'calendarBusy' && sessionStorage.getItem('calendarAccess')) {
          const morning = new Date(argument + 'T08:00:00').getTime();
          const count = Number(sessionStorage.getItem('calendarReads') || 0);
          sessionStorage.setItem('calendarReads', String(count + 1));
          value = [{ start: morning, end: morning + (count === 0 ? 60 : 90) * 60000 }];
        }
        if (action === 'calendarBlockEditor') { sessionStorage.setItem('editor', argument); value = true; }
        queueMicrotask(() => this.onmessage({ data: JSON.stringify({ id, value }) }));
      } };
    });
    const page = await context.newPage();
    await page.clock.install({ time: new Date(2026, 10, 18, 12) });
    await page.goto(url);
    await button(page, 'Complete Gratitude').waitFor();
    await page.clock.setSystemTime(new Date(2026, 10, 19, 21, 5));
    await page.reload();
    await button(page, 'Gratitude').click();
    await button(page, 'Log easier step').click();
    await page.locator('.budget-turtle[data-cue="welcome"]').waitFor();
    await page.getByText('Sparky noticed your comeback.').waitFor();
    const planner = page.getByRole('region', { name: 'Plan with Sparky' });
    await button(planner, 'Connect calendar').click();
    const accept = planner.getByRole('button', { name: /^Plan Read at/ });
    const first = await accept.textContent();
    await accept.click();
    await text(planner, 'Your calendar changed. Check the updated suggestion.');
    assert.notEqual(await accept.textContent(), first);
    await accept.click();
    await planner.getByText(/Saved in Sparky/).waitFor();
    await button(planner, 'Change time').click();
    const time = planner.getByLabel('Start time');
    await time.fill('18:35');
    await button(planner, 'Check again').click();
    await text(planner, 'Your chosen time is free.');
    assert.equal(await time.inputValue(), '18:35');
    await button(planner, 'Save new time').click();
    await planner.getByText(/Saved in Sparky/).waitFor();
    await button(planner, 'Add to phone calendar').click();
    const editor = await page.evaluate(() => JSON.parse(sessionStorage.getItem('editor')));
    assert.equal(editor.title, 'Read');
    assert.equal(new Date(editor.start).getHours(), 18);
    assert.equal(new Date(editor.start).getMinutes(), 35);
    assert.equal(editor.end - editor.start, 20 * 60000);
    await page.reload();
    await planner.getByText(/Saved in Sparky/).waitFor();
    assert.equal(await page.locator('.budget-turtle[data-cue="welcome"]').count(), 0);
    await page.clock.setSystemTime(new Date(2026, 10, 20, 9));
    await page.reload();
    await page.getByText(/You planned Read for/).waitFor();
  } finally { await context.close(); }
});

test('Coach isolates account switches, delayed answers, reset and restored transcripts', { timeout: 60000 }, async () => {
  const context = await browser.newContext(phone);
  try {
    await context.addInitScript(() => {
      window.coachOwner = 'A';
      window.coachAsks = [];
      let input = '';
      let chunks = [];
      window.OneLifeAndroid = { postMessage(raw) {
        const { id, action, value } = JSON.parse(raw);
        const reply = result => this.onmessage({ data: JSON.stringify({ id, value: result }) });
        let result = false;
        if (action === 'chatStatus') result = { authorized: !!window.coachOwner, registered: true,
          owner: window.coachOwner, email: 'same@example.invalid', accounts: [] };
        if (action === 'chatSignOut') window.coachOwner = '';
        if (action === 'chatConnect') window.coachOwner = 'B';
        if (action === 'chatModels') result = [{ id: 'model-' + window.coachOwner, name: 'Model' }];
        if (action === 'chatAsk') {
          window.coachAsks.push(JSON.parse(value));
          if (window.holdCoach) {
            window.releaseCoach = () => { window.holdCoach = false; window.releaseCoach = null; reply('Private delayed answer'); };
            return;
          }
          result = 'Answer for ' + window.coachOwner;
        }
        if (action === 'backupStatus' || action === 'backupEnabled') result = { supported: true, enabled: false, last: 0 };
        if (action === 'backupBegin') chunks = [];
        if (action === 'backupAppendBytes') chunks.push(Uint8Array.from(atob(value), c => c.charCodeAt(0)));
        if (action === 'backupFinish') {
          void new Blob(chunks).text().then(content => { window.coachBackup = JSON.parse(content); reply(true); });
          return;
        }
        if (action === 'export') { window.coachBackup = JSON.parse(value); result = true; }
        if (action === 'exportChat') { window.coachTranscript = JSON.parse(value); result = true; }
        if (action === 'import') {
          input = btoa(Array.from(new TextEncoder().encode(JSON.stringify(window.restoreCoach)), b => String.fromCharCode(b)).join(''));
          result = true;
        }
        if (action === 'backupRead') { result = input; input = ''; }
        queueMicrotask(() => reply(result));
      } };
    });
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    await page.goto(url);
    const coach = async () => {
      await open(page, 'Life');
      await button(page.getByRole('group', { name: 'Life view' }), 'Coach').click();
      await page.getByLabel('Question', { exact: true }).waitFor();
    };
    const question = page.getByLabel('Question', { exact: true });
    const consent = page.getByLabel('Include an app context summary in this message');
    const send = async prompt => { await question.fill(prompt); await button(page, 'Send').click(); };
    const backup = async () => {
      await page.evaluate(() => { window.coachBackup = null; });
      await button(page, 'Export JSON').click();
      await page.waitForFunction(() => !!window.coachBackup);
      return page.evaluate(() => window.coachBackup);
    };
    await coach();
    await send('Private A turn');
    await button(page, 'Chat history (1)').waitFor();
    await question.fill('Private A draft');
    await consent.check();
    await button(page, 'Sign out').click();
    await button(page, 'Continue with ChatGPT').waitFor();
    assert.equal(await page.getByLabel('Chat to export').count(), 0);
    await button(page, 'Use another account').click();
    await question.waitFor();
    assert.equal(await question.inputValue(), '');
    assert.equal(await consent.isChecked(), false);
    assert.equal(await page.getByLabel('Chat to export').count(), 0);
    await send('B turn');
    await button(page, 'Chat history (1)').waitFor();
    assert.deepEqual(await page.evaluate(() => window.coachAsks.at(-1)), {
      owner: 'B', model: 'model-B', messages: [{ role: 'user', content: 'B turn' }],
    });
    await consent.check();
    await page.evaluate(() => { window.holdCoach = true; });
    await send('Late B turn');
    await page.waitForFunction(() => !!window.releaseCoach);
    await page.evaluate(() => { window.coachOwner = 'A'; window.dispatchEvent(new Event('one-life-phone-activity')); });
    await page.waitForFunction(() => document.querySelector('.chat-form textarea')?.value === '' && !document.querySelector('.chat-form textarea')?.disabled);
    await page.evaluate(() => window.releaseCoach());
    assert.equal(await consent.isChecked(), false);
    assert.equal(await page.getByRole('list', { name: 'Conversation' }).count(), 0);
    await button(page, 'Export chat').click();
    await page.waitForFunction(() => !!window.coachTranscript);
    const transcript = await page.evaluate(() => window.coachTranscript);
    assert.deepEqual(Object.keys(transcript).sort(), ['id', 'started', 'turns']);
    assert.deepEqual(transcript.turns.map(turn => turn.question), ['Private A turn']);
    await open(page, 'Settings');
    const original = await backup();
    assert.equal(original.chats.length, 2);
    assert.doesNotMatch(JSON.stringify(original), /Late B turn|Private delayed answer/);
    await page.evaluate(snapshot => {
      snapshot.chats = snapshot.chats.filter(chat => chat.owner === 'B');
      window.restoreCoach = snapshot;
    }, original);

    for (const operation of ['reset', 'import']) {
      await coach();
      await send('Previous ' + operation);
      await page.getByRole('list', { name: 'Conversation' }).waitFor();
      await page.getByLabel('Evening reflection').fill('Previous reflection');
      await page.evaluate(() => { window.holdCoach = true; });
      await send('Pending ' + operation);
      await page.waitForFunction(() => !!window.releaseCoach);
      await open(page, 'Settings');
      await button(page, operation === 'reset' ? 'Reset all data' : 'Import JSON').click();
      const dialog = page.getByRole('dialog');
      await button(dialog, operation === 'reset' ? 'Reset all data' : 'Replace with backup').click();
      await dialog.waitFor({ state: 'hidden' });
      await page.evaluate(() => window.releaseCoach());
      const snapshot = await backup();
      assert.deepEqual((snapshot.chats ?? []).map(chat => chat.owner), operation === 'reset' ? [] : ['B']);
      assert.doesNotMatch(JSON.stringify(snapshot), /Pending |Previous reflection|Private delayed answer/);
      await coach();
      assert.equal(await page.getByLabel('Evening reflection').inputValue(), '');
      assert.equal(await question.inputValue(), '');
      assert.equal(await consent.isChecked(), false);
      assert.equal(await page.getByRole('list', { name: 'Conversation' }).count(), 0);
      await send('Fresh ' + operation);
      await button(page, 'Chat history (1)').waitFor();
      const request = await page.evaluate(() => window.coachAsks.at(-1));
      assert.equal(request.owner, 'A');
      assert.equal(request.model, 'model-A');
      assert.deepEqual(request.messages, [{ role: 'user', content: 'Fresh ' + operation }]);
    }
  } finally { await context.close(); }
});

test('coach exports the endangered chat and requires consent before trimming', { timeout: 35000 }, async () => {
  const context = await browser.newContext(phone);
  try {
    await context.addInitScript(() => {
      window.asks = 0;
      window.OneLifeAndroid = { postMessage(message) {
        const { id, action, value } = JSON.parse(message);
        let result;
        if (action === 'chatStatus') result = { authorized: true, owner: 'test-account', registered: true, accounts: [] };
        if (action === 'chatModels') result = [{ id: 'test-model', name: 'Test model' }];
        if (action === 'chatAsk') { window.asks++; result = 'New answer'; }
        if (action === 'exportChat') { window.exportedChat = JSON.parse(value); result = true; }
        queueMicrotask(() => this.onmessage({ data: JSON.stringify({ id, value: result }) }));
      } };
    });
    const page = await context.newPage();
    await page.goto(url);
    await button(page, 'Life').waitFor();
    await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open('one-life', 1);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('state', 'readwrite');
        const store = tx.objectStore('state');
        const get = store.get('app');
        get.onsuccess = () => {
          const at = new Date().toISOString();
          const chats = Array.from({ length: 100 }, (_, i) => ({ id: String(i), owner: 'test-account', started: at,
            turns: Array.from({ length: i === 99 ? 50 : 1 }, (_, j) => ({ at, question: `Chat ${i} turn ${j}`, answer: 'Old answer' })) }));
          store.put({ ...get.result, chats }, 'app');
        };
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => reject(tx.error);
      };
    }));
    await page.reload();
    await open(page, 'Life');
    await button(page.getByRole('group', { name: 'Life view' }), 'Coach').click();
    await button(page, 'Export before sending').click();
    await text(page, 'Chat exported.');
    assert.equal(await page.evaluate(() => window.exportedChat.id), '99');
    await button(page, 'Chat history (100)').click();
    await page.getByRole('button', { name: /Chat 99 turn 0/ }).click();
    await page.getByLabel('Question', { exact: true }).fill('Another question');
    await button(page, 'Send').click();
    assert.equal(await page.evaluate(() => window.asks), 0);
    await button(page, 'Export before sending').click();
    await text(page, 'Chat exported.');
    assert.equal(await page.evaluate(() => window.exportedChat.turns[0].question), 'Chat 99 turn 0');
    await page.getByLabel('Allow removal when this answer is saved').check();
    await button(page, 'Send').click();
    await text(page, 'New answer');
    await page.getByLabel('Chat to export').selectOption('99');
    await button(page, 'Export chat').click();
    await page.waitForFunction(() => window.exportedChat.turns.at(-1).answer === 'New answer');
    assert.equal(await page.evaluate(() => window.exportedChat.turns[0].question), 'Chat 99 turn 1');
  } finally { await context.close(); }
});

test('Settings pauses the streak through reload and resumes scoring today', async () => {
  const context = await browser.newContext(phone);
  try {
    const page = await context.newPage();
    await page.goto(url);
    await button(page, 'Settings').click();
    await button(page, 'Pause streak').click();
    await button(page, 'Resume streak').waitFor();
    await page.reload();
    await button(page, 'Streak: 0 days, paused').click();
    await page.getByText('Streak paused. Resume in Settings.').waitFor();
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    if (!(await button(page, 'Resume streak').isVisible())) await button(page, 'Settings').click();
    await button(page, 'Resume streak').click();
    // Unpaused with no streak yet: the chip stays hidden until the first counted day.
    await page.getByRole('button', { name: 'Streak: 0 days, paused' }).waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('button', { name: /^Streak: / }).count(), 0);
  } finally { await context.close(); }
});

test('quota abort explains how to retry and preserves the previous backup through reload', async () => {
  const context = await browser.newContext({ ...phone, serviceWorkers: 'block' });
  try {
    const { randomBytes } = await import('node:crypto');
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const quota = quotaSize => cdp.send('Storage.overrideQuotaForOrigin', { origin: new URL(url).origin, quotaSize });
    const download = async () => {
      const ready = page.waitForEvent('download');
      await button(page, 'Export JSON').click();
      return JSON.parse(await readFile(await (await ready).path(), 'utf8'));
    };
    await quota(256 * 1024);
    await page.goto(url);
    await button(page, 'Settings').click();
    const before = await download();
    const audit = Array.from({ length: 12000 }, (_, i) => ({
      id: String(i), timestamp: '2026-01-01T00:00:00Z', detail: randomBytes(180).toString('base64'),
    }));
    const incoming = { ...before, audit };
    const upload = () => page.getByLabel('Import JSON', { exact: true }).setInputFiles({
      name: 'quota.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(incoming)),
    });
    await upload();
    await button(page, 'Replace with backup').click();
    await page.waitForFunction(() => document.querySelector('[role=alert]') || !document.querySelector('dialog[open]'));
    assert.match(await page.getByRole('dialog').getByRole('alert').allTextContents().then(messages => messages.join(' ')), /Free up space/);
    assert.equal(await button(page, 'Replace with backup').isEnabled(), true);
    await page.reload();
    await button(page, 'Settings').click();
    assert.deepEqual(await download(), before);
    await quota(64 * 1024 * 1024);
    await upload();
    await button(page, 'Replace with backup').click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.deepEqual((await download()).audit, incoming.audit);
  } finally { await context.close(); }
});

test('partial automatic copy removal shows the native switch, surviving count and a working retry', async () => {
  const context = await browser.newContext(phone);
  try {
    await context.addInitScript(() => {
      const status = { supported: true, enabled: true, copies: 3, last: 1000 };
      window.OneLifeAndroid = { postMessage(message) {
        const { action, id } = JSON.parse(message);
        let error;
        if (action === 'backupClear') {
          status.enabled = false;
          status.last = 0;
          if (status.copies === 3) {
            status.copies = 1;
            error = 'Provider denied deletion';
          } else status.copies = 0;
        }
        const value = ['backupStatus', 'backupClear', 'autoBackup'].includes(action) ? status : false;
        queueMicrotask(() => this.onmessage({ data: JSON.stringify({ id, value, error }) }));
      } };
    });
    const page = await context.newPage();
    await page.goto(url);
    await button(page, 'Settings').click();
    await button(page, 'Remove automatic copies').click();
    await button(page, 'Delete automatic files').click();
    await button(page, 'Allow automatic copies').waitFor();
    await page.getByRole('alert').filter({ hasText: '1 automatic file remains' }).waitFor();
    await button(page, 'Delete automatic files').click();
    await button(page, 'Delete automatic files').waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('alert').filter({ hasText: 'file remains' }).count(), 0);
  } finally { await context.close(); }
});

test('Downloads copies require consent, retry current records and reset weekly sharing', { timeout: 40000 }, async () => {
  const context = await browser.newContext(phone);
  try {
    await context.addInitScript(() => {
      let enabled = false;
      let weekly = true;
      let last = 0;
      window.copyAttempts = [];
      window.resetActions = [];
      window.OneLifeAndroid = { postMessage(message) {
        const { id, action, value } = JSON.parse(message);
        let result;
        let error;
        if (action === 'weeklyStatus') result = weekly;
        if (action === 'weeklyDisable') { weekly = false; window.resetActions.push(action); }
        if (action === 'backupEnabled') enabled = value === 'on';
        if (action === 'backupClear') { enabled = false; last = 0; window.resetActions.push(action); }
        if (action === 'autoBackup') {
          window.copyAttempts.push(JSON.parse(value).settings.theme);
          if (window.copyAttempts.length === 1) error = 'Disk full.';
          else last = Date.now();
        }
        if (['backupStatus', 'backupEnabled', 'backupClear', 'autoBackup'].includes(action)) result = { supported: true, enabled, last };
        queueMicrotask(() => this.onmessage({ data: JSON.stringify({ id, value: result, error }) }));
      } };
    });
    const page = await context.newPage();
    await page.clock.install();
    await page.goto(url);
    await open(page, 'Settings');
    await button(page, 'Allow automatic copies').waitFor();
    await page.clock.fastForward(61000);
    assert.deepEqual(await page.evaluate(() => window.copyAttempts), []);
    await button(page, 'Allow automatic copies').click();
    await button(page, 'Turn off automatic copies').waitFor();
    await page.clock.fastForward(2000);
    await page.getByText(/Disk full/).waitFor();
    await button(page, 'Dark').click();
    // The save is real IndexedDB work; let it land before the fake clock jumps to the retry.
    await page.locator('html[data-theme="dark"]').waitFor({ state: 'attached' });
    await page.clock.fastForward(61000);
    await page.waitForFunction(() => window.copyAttempts.length === 2);
    assert.deepEqual(await page.evaluate(() => window.copyAttempts), ['light', 'dark']);
    await button(page, 'Light').click();
    await page.locator('html[data-theme="light"]').waitFor({ state: 'attached' });
    await page.clock.fastForward(61000);
    await page.waitForFunction(() => window.copyAttempts.length === 3);
    await button(page, 'Reset all data').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/Also delete automatic copies/).check();
    await button(dialog, 'Reset all data').click();
    await dialog.waitFor({ state: 'hidden' });
    await button(page, 'Allow automatic copies').waitFor();
    assert.deepEqual(await page.evaluate(() => window.resetActions), ['weeklyDisable', 'backupClear']);
  } finally { await context.close(); }
});

test('a habit can opt into a learned reminder and keep its lead after reload', async () => {
  const context = await browser.newContext(phone);
  try {
    const page = await context.newPage();
    await page.goto(url);
    await button(page, 'Add habit').click();
    const form = page.getByRole('dialog');
    await form.getByLabel('Habit name').fill('Read at three');
    await form.getByRole('combobox', { name: /^Habit reminder/ }).selectOption('30');
    await form.getByText(/Learning from your check-ins/).waitFor();
    await button(form, 'Save habit').click();
    await form.waitFor({ state: 'hidden' });
    await page.reload();
    await button(page, 'Settings').click();
    await page.getByRole('button', { name: /Read at three/ }).click();
    assert.equal(await form.getByRole('combobox', { name: /^Habit reminder/ }).inputValue(), '30');
  } finally { await context.close(); }
});

test('returning from the browser opens Sparky Coach and reads the saved account again', async () => {
  const context = await browser.newContext(phone);
  try {
    await context.addInitScript(() => {
      window.coachBack = false;
      window.coachSaved = false;
      window.OneLifeAndroid = { postMessage(message) {
        const { id, action } = JSON.parse(message);
        let value = false;
        if (action === 'chatStatus') value = { authorized: window.coachSaved, owner: window.coachSaved ? 'test-account' : '', registered: window.coachSaved, email: '', accounts: [] };
        if (action === 'phoneHabitActions') {
          const now = new Date();
          const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
          value = { completed: [], open: window.coachBack ? { section: 'coach', date, habitId: '' } : null };
          window.coachBack = false;
        }
        queueMicrotask(() => this.onmessage({ data: JSON.stringify({ id, value }) }));
      }};
    });
    const page = await context.newPage();
    await page.goto(url);
    await page.locator('#budget-coach').waitFor();
    await open(page, 'Life');
    await button(page.getByRole('group', { name: 'Life view' }), 'Coach').click();
    await button(page, 'Continue with ChatGPT').waitFor();
    await open(page, 'Today');
    await page.evaluate(() => {
      window.coachSaved = true;
      window.coachBack = true;
      window.dispatchEvent(new Event('one-life-phone-action'));
      window.dispatchEvent(new Event('one-life-phone-activity'));
    });
    await button(page, 'Sign out').waitFor();
    await page.getByLabel('Question').waitFor();
  } finally { await context.close(); }
});

test('the Sparky card shows a day ring that turns into a gold check once everything is done', { timeout: 60000 }, async () => {
  const context = await browser.newContext({ ...phone, reducedMotion: 'reduce' });
  try {
    const page = await context.newPage();
    await page.goto(url);
    const card = page.locator('.daybook-feature');
    await card.locator('.next-habit').waitFor();
    // While a habit is up next, a small ring sits beside the count.
    await card.locator('.day-count .today-ring').waitFor();
    assert.equal(await card.locator('.today-ring.large').count(), 0);
    for (let i = 0; i < 20; i++) {
      const mark = card.getByRole('button', { name: 'Mark done' });
      const next = card.locator('.next-habit');
      if (await mark.count()) await mark.click();
      else if (await next.count()) await next.click();
      else break;
      await page.waitForTimeout(300);
      const dialog = page.getByRole('dialog');
      if (await dialog.count()) {
        const save = dialog.getByRole('button', { name: /save|done|log/i }).first();
        if (await save.count()) await save.click(); else await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
    }
    // Nothing is up next, but Small wins are still open: the big ring shows the fraction instead of a blank card.
    await card.getByText('Almost there').waitFor();
    assert.match(await card.locator('.today-ring-count').innerText(), /^\d+\/\d+$/);
    await button(page, 'Small wins').first().click();
    for (let i = 0; i < 40; i++) {
      const tap = page.locator('.win-tap[aria-pressed="false"]').first();
      if (!await tap.count()) break;
      await tap.click();
      await page.waitForTimeout(150);
    }
    await button(page, 'Habits').first().click();
    await card.getByText('All done!').waitFor();
    await card.locator('.today-ring.large.complete .today-ring-check').waitFor();
    const ring = await card.locator('.today-ring.large').boundingBox();
    const check = await card.locator('.today-ring-check').boundingBox();
    assert.ok(check.width < ring.width / 2, 'the check sits inside the ring');
    assert.match(await card.innerText(), /(\d+) of \1 done today/);
    // History keeps its own day rings at their original size.
    await open(page, 'History');
    const historyRing = await page.locator('.day-ring').first().boundingBox();
    assert.ok(historyRing && historyRing.width < 40);
  } finally { await context.close(); }
});

test('a check-in needs only mood and energy; the reflection is really optional', async () => {
  const context = await browser.newContext(phone);
  try {
    const page = await context.newPage();
    await page.goto(url);
    await button(page.getByRole('group', { name: 'Today view' }), 'Check-in').click();
    const panel = page.locator('#checkin');
    await panel.getByText('Pick your mood and energy to check in.').waitFor();
    assert.equal(await panel.locator('button.secondary-button').count(), 0, 'no greyed-out save button before rating');
    await button(page, 'Mood: Good (4 of 5)').click();
    await button(page, 'Energy: Steady (3 of 5)').click();
    // Saved without typing anything, and shown as done rather than as a disabled button.
    await panel.getByText('Checked in. A reflection is optional.').waitFor();
    assert.equal(await panel.locator('button.secondary-button').count(), 0);
    await page.reload();
    await button(page.getByRole('group', { name: 'Today view' }), 'Check-in').click();
    await page.locator('#checkin').getByText('Checked in. A reflection is optional.').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Mood: Good (4 of 5)' }).getAttribute('aria-pressed'), 'true');
  } finally { await context.close(); }
});

test('ChatGPT sign-in shows each step until Sparky has finished connecting', { timeout: 30000 }, async () => {
  const context = await browser.newContext(phone);
  try {
    await context.addInitScript(() => {
      window.stages = ['browser', 'browser', 'waiting', 'finishing'];
      window.connected = false;
      window.OneLifeAndroid = { postMessage(raw) {
        const { id, action } = JSON.parse(raw);
        let result = true;
        const reply = (value) => this.onmessage({ data: JSON.stringify({ id, value }) });
        if (action === 'chatStatus') result = window.connected
          ? { authorized: true, owner: 'acct', registered: true, email: 'a@example.invalid', accounts: [] }
          : { authorized: false, registered: false, email: '', accounts: [] };
        if (action === 'chatConnectStage') result = window.stages.length > 1 ? window.stages.shift() : window.stages[0];
        if (action === 'chatModels') result = [{ id: 'm', name: 'Model' }];
        if (action === 'chatConnect') {
          // Android answers only when the whole sign-in is done.
          setTimeout(() => { window.connected = true; reply(true); }, 5200);
          return;
        }
        queueMicrotask(() => reply(result));
      } };
    });
    const page = await context.newPage();
    await page.goto(url);
    await open(page, 'Life');
    await button(page.getByRole('group', { name: 'Life view' }), 'Coach').click();
    await button(page, 'Continue with ChatGPT').click();
    await text(page, 'Sign in with OpenAI in your browser, then tap Open Sparky Coach. Sparky is waiting.');
    await text(page, 'Almost done. Sparky finishes the sign-in as soon as it is open again.');
    await text(page, 'Finishing sign-in with OpenAI…');
    await page.getByText(/Using ChatGPT plan/).waitFor({ timeout: 10000 });
    assert.equal(await page.getByText('Finishing sign-in with OpenAI…').count(), 0);
  } finally { await context.close(); }
});

test('first run: a new user picks any number of habits with targets, reads the rule, and Today shows only those', { timeout: 30000 }, async () => {
  const context = await browser.newContext(phone);
  try {
    await context.addInitScript(() => { try { localStorage.removeItem('sparky-onboarding-done'); } catch { /* storage blocked */ } });
    const page = await context.newPage();
    await page.goto(url);
    const picker = page.getByRole('dialog', { name: 'Choose what Sparky holds you to' });
    await picker.waitFor();
    assert.equal(await picker.getByRole('button', { name: 'Continue' }).isDisabled(), true);
    await picker.getByRole('button', { name: 'Read' }).click();
    await picker.getByLabel('Daily target').selectOption('10');
    await picker.getByRole('button', { name: 'Gratitude' }).click();
    await picker.getByRole('button', { name: 'Personal project' }).click();
    // There is no cap: a fourth habit can be chosen (then unchosen to keep the plan below unchanged).
    await picker.getByRole('button', { name: 'Move or train' }).click();
    await picker.getByText('4 chosen').waitFor();
    await picker.getByRole('button', { name: 'Move or train' }).click();
    await picker.getByRole('button', { name: 'Continue' }).click();
    const rule = page.getByRole('dialog', { name: 'How Sparky holds you to it' });
    await rule.getByText('Less than that').waitFor();
    await rule.getByText('70% or more').waitFor();
    await rule.getByRole('button', { name: 'Start' }).click();
    await page.getByRole('heading', { name: 'Today’s habits' }).waitFor();
    for (const kept of ['Read', 'Gratitude', 'Personal project']) await page.locator('.habits-section').getByText(kept, { exact: true }).waitFor();
    assert.equal(await page.locator('.habits-section').getByText('Move or train', { exact: true }).count(), 0);
    await page.locator('.habits-section').getByText('0 / 10 min').waitFor();
    // Three habits plus Small wins: 70% of 4 rounds up to 3.
    await page.getByText("Sparky's bar tonight: 3 of 4 by 21:00").waitFor();
    // Reopening does not show the picker again.
    await page.reload();
    await page.getByRole('heading', { name: 'Today’s habits' }).waitFor();
    assert.equal(await page.getByRole('dialog', { name: 'Choose what Sparky holds you to' }).count(), 0);
  } finally { await context.close(); }
});
