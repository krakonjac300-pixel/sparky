import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const [beforeAssets, afterAssets] = process.argv.slice(2);
assert.ok(beforeAssets && afterAssets, 'Pass the asset directories for both signed releases.');

const app = 'https://appassets.androidplatform.net/index.html';
const options = process.env.ONE_LIFE_BROWSER
  ? { executablePath: process.env.ONE_LIFE_BROWSER }
  : existsSync(chromium.executablePath()) ? {} : { channel: 'msedge' };
const browser = await chromium.launch(options);

function compare(original, candidate, path = '', appendAt = []) {
  if (Array.isArray(original)) {
    assert.ok(Array.isArray(candidate), `${path} should still be a list`);
    if (!appendAt.includes(path)) assert.equal(candidate.length, original.length, `${path} record count`);
    original.forEach((value, index) => compare(value, candidate[index], `${path}[${index}]`, appendAt));
  } else if (original !== null && typeof original === 'object') {
    assert.ok(candidate !== null && typeof candidate === 'object', `${path} should still hold a record`);
    for (const [key, value] of Object.entries(original)) {
      if (!path && key === 'version') continue;
      assert.ok(Object.hasOwn(candidate, key), `${path}.${key} is missing`);
      compare(value, candidate[key], path ? `${path}.${key}` : key, appendAt);
    }
  } else {
    assert.strictEqual(candidate, original, path);
  }
}

async function snapshot(page, addTestData = false) {
  return page.evaluate((seed) => new Promise((resolve, reject) => {
    const open = indexedDB.open('one-life');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const transaction = database.transaction('state', seed ? 'readwrite' : 'readonly');
      const store = transaction.objectStore('state');
      const load = store.get('app');
      let result;
      transaction.oncomplete = () => { database.close(); resolve(result); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
      load.onsuccess = () => {
        result = load.result;
        if (!seed) return;
        const entry = result.logs.find((log) => log.habitId === 'gratitude');
        if (!entry) { transaction.abort(); return; }
        const { date, timestamp } = entry;
        result.goals.push({ id: 'test-goal', title: 'Test goal', unit: 'km', target: 5,
          measurements: [{ id: 'test-measurement', date, value: 3.25, note: 'Recorded measurement' }] });
        result.moments.push({ id: 'test-moment', date, title: 'Test milestone', note: 'Recorded note', kind: 'Milestone' });
        result.routines.push({ date, plan: 'Recorded plan', reflection: 'Recorded reflection' });
        result.sleep.push({ date, minutes: 431, source: 'Health Connect' });
        result.audit.push({ id: 'test-audit', timestamp, detail: 'Retained entry' });
        result.reminder = '21:30';
        store.put(result, 'app');
      };
    };
  }), addTestData);
}

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  // An existing user is upgrading: skip the first-run habit picker (0.40.0+); older builds ignore this key.
  await context.addInitScript(() => { try { localStorage.setItem('sparky-onboarding-done', '1'); } catch { /* blocked */ } });
  await context.addInitScript(() => {
    const apps = [
      { id: 'com.demo.tiktok', name: 'TikTok', seconds: 4200 },
      { id: 'com.demo.instagram', name: 'Instagram', seconds: 2700 },
    ];
    window.OneLifeAndroid = { postMessage(message) {
      const { id, action, value: argument } = JSON.parse(message);
      let value = action === 'chatStatus'
        ? { authorized: false, registered: false, email: '', accounts: [] }
        : action === 'reminderStatus' ? '21:30' : true;
      if (action === 'installedUsageApps') value = apps.map(({ id, name }) => ({ id, name }));
      if (action === 'connectUsage') {
        sessionStorage.setItem('usageRequested', 'true');
        value = sessionStorage.getItem('usageGranted') === 'true';
      }
      if (action === 'phoneActivity') {
        const granted = sessionStorage.getItem('usageGranted') === 'true';
        const state = granted ? 'connected' : sessionStorage.getItem('usageRequested') ? 'permission' : 'off';
        value = { health: { state: 'off' }, usage: { state } };
        if (granted) {
          const now = new Date();
          const day = new Date(now.getTime() - now.getTimezoneOffset() * 60 * 1000).toISOString().slice(0, 10);
          const extra = Number(sessionStorage.getItem('usageExtra') ?? 0);
          if (argument === 'refresh') sessionStorage.setItem('usageForced', 'true');
          value.screen = { updated: now.getTime() + extra, days: [{ date: day, seconds: 6900 + extra,
            apps: [{ ...apps[0], seconds: apps[0].seconds + extra }, apps[1]],
            hours: [{ hour: now.getHours(), value: 6900 + extra }],
          }] };
        }
      }
      queueMicrotask(() => this.onmessage({ data: JSON.stringify({ id, value }) }));
    } };
  });
  let assets = beforeAssets;
  let blockAnimations = false;
  await context.route('https://appassets.androidplatform.net/**', async (route) => {
    const path = new URL(route.request().url()).pathname.slice(1);
    if ((blockAnimations && path.endsWith('.webp')) ||
      !/^(index\.html|manifest\.webmanifest|icon-\d+\.png|sparky\.glb|sparky-contact\.png|sparky-view-(0|75|180)\.png|turtle-plush-[a-z]+(-\d+)?\.(webp|png)|assets\/[A-Za-z0-9_.-]+\.(js|css|woff2))$/.test(path)) {
      await route.fulfill({ status: 404 });
      return;
    }
    const asset = join(assets, path);
    if (!existsSync(asset)) await route.fulfill({ status: 404 });
    else await route.fulfill({ path: asset });
  });

  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const button = (name) => page.getByRole('button', { name, exact: true });
  // Before 0.31 Phone was its own tab; from 0.31 it sits under Settings.
  const tab = async (name) => {
    const nav = page.getByRole('navigation');
    if (name === 'Phone' && !(await nav.getByRole('button', { name: 'Phone', exact: true }).count())) {
      await nav.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('group', { name: 'Settings view' }).getByRole('button', { name: 'Phone', exact: true }).click();
      return;
    }
    await nav.getByRole('button', { name, exact: true }).click();
  };
  // From 0.25 the check-in has its own Today section; older apps show it on the page.
  const todayView = async (name) => {
    const group = page.getByRole('group', { name: 'Today view' });
    if (await group.count()) await group.getByRole('button', { name, exact: true }).click();
  };
  async function acceptTermsIfShown() {
    const agree = button('I agree to the terms');
    const habits = page.getByRole('heading', { name: 'Today’s habits', exact: true });
    await agree.or(habits).first().waitFor();
    if (await agree.isVisible()) {
      const dialog = page.getByRole('dialog', { name: /Welcome to (One Life|Sparky)/ });
      await dialog.locator('summary').filter({ hasText: 'Terms of use' }).click();
      await dialog.getByRole('heading', { name: 'Sparky and wellness guidance' }).waitFor();
      await agree.click();
    }
  }
  await page.goto(app);
  await acceptTermsIfShown();
  await button('Complete Gratitude').click();
  await button('Undo Gratitude').waitFor();
  await todayView('Check-in');
  await button('Mood: Good (4 of 5)').click();
  await button('Energy: Steady (3 of 5)').click();
  const reflection = page.getByRole('textbox', { name: 'Reflection (optional)', exact: true });
  await reflection.fill('Check-in saved in the older app.');
  // Older builds show "Save check-in" then "Check-in saved"; 0.39.6+ checks in on rating and saves the note separately.
  const saveNote = page.getByRole('button', { name: /^(Save check-in|Save reflection)$/ });
  await saveNote.click();
  await page.getByRole('button', { name: 'Check-in saved', exact: true }).or(page.getByText('Checked in. A reflection is optional.')).first().waitFor();
  await snapshot(page, true);
  await page.reload();
  await todayView('Habits');
  await button('Undo Gratitude').waitFor();
  const original = await snapshot(page);
  assert.ok(original.logs.some((entry) => entry.habitId === 'gratitude' && entry.status === 'done'));
  assert.equal(original.checkIns[0].note, 'Check-in saved in the older app.');

  assets = afterAssets;
  await page.reload();
  await acceptTermsIfShown();
  await page.getByRole('heading', { name: 'Today’s habits', exact: true }).waitFor();
  await button('Undo Gratitude').waitFor();
  await todayView('Check-in');
  assert.equal(await reflection.inputValue(), 'Check-in saved in the older app.');
  await todayView('Habits');
  const updated = await snapshot(page);
  compare(original, updated);
  console.log(JSON.stringify(original) === JSON.stringify(updated)
    ? 'All stored records and fields match exactly after opening the update.'
    : 'The update preserved all existing records and fields.');

  await tab('Settings');
  await button('Light').click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  const saved = await snapshot(page);
  compare({ ...original, settings: { ...original.settings, theme: 'light' } }, saved);

  await tab('Today');
  await button('Add habit').click();
  await page.getByLabel('Habit name').fill('One new upgrade test habit');
  await button('Save habit').click();
  await button('One new upgrade test habit').waitFor();
  const added = await snapshot(page);
  assert.equal(added.habits.length, saved.habits.length + 1);
  compare(saved, added, '', ['habits', 'plans']);
  console.log('Changing a setting and adding a habit also preserved existing logs, check-ins, goals, timeline, and sleep.');

  await tab('Phone');
  for (const name of ['Phone connections', 'Health Connect', 'Screen time', 'Calendar']) {
    await page.getByRole('heading', { name, exact: true }).waitFor();
  }
  await tab('Life');
  await button('Coach').click();
  assert.equal(await page.getByLabel('Morning plan').inputValue(), 'Recorded plan');
  await button('Sparky').click();
  const budget = page.locator('#budget-coach');
  await budget.waitFor();
  await page.waitForFunction(() => document.activeElement?.id === 'budget-coach');
  const turtle = budget.locator('.budget-turtle');
  console.log('The signed update shows the original Sparky portrait.');
  await turtle.locator('canvas').waitFor();
  assert.ok(await turtle.locator('canvas').evaluate((canvas) => {
    const rgba = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    return rgba.some((value, index) => index % 4 === 3 && value > 128);
  }), 'The installed turtle should draw visible artwork.');
  await button('Pet Sparky').click();
  await turtle.locator('canvas').waitFor();
  await page.waitForFunction(() => document.querySelector('.budget-turtle')?.getAttribute('data-greeting') === 'true');

  await button('Connect screen time').click();
  await budget.getByText(/Allow Usage access for (One Life|Sparky) in Android Settings./).waitFor();
  await page.evaluate(() => {
    sessionStorage.setItem('usageGranted', 'true');
    window.dispatchEvent(new CustomEvent('one-life-phone-activity', { detail: { usageChanged: true } }));
  });
  await budget.getByText('1 h 55 min', { exact: true }).waitFor();
  await budget.getByText('Screen time today', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => sessionStorage.getItem('usageForced')), 'true');

  await button('View apps and charts').click();
  await page.getByRole('group', { name: 'Screen time by hour' }).waitFor();
  const chart = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Screen time', exact: true }) });
  await chart.getByText('TikTok', { exact: true }).waitFor();
  await chart.getByText('Instagram', { exact: true }).waitFor();
  await button('Week').click();
  await page.getByRole('group', { name: 'Daily screen time' }).waitFor();
  await button('Month').click();
  await page.getByRole('group', { name: 'Daily screen time' }).waitFor();
  await tab('Life');
  await button('Set shared limit').click();
  const dialog = page.getByRole('dialog', { name: 'Set shared limit' });
  await dialog.getByLabel('Shared limit name').fill('Social media');
  await dialog.getByRole('checkbox', { name: 'TikTok' }).check();
  await dialog.getByRole('checkbox', { name: 'Instagram' }).check();
  await dialog.getByLabel('Daily limit in minutes').fill('180');
  await button('Save limit').click();
  await page.getByText('Shared daily limit 3 h').waitFor();
  await button('Sparky').click();
  await budget.getByText('1 h 5 min left', { exact: true }).waitFor();
  await page.evaluate(() => sessionStorage.setItem('usageExtra', '600'));
  await button('Sync now').click();
  await budget.getByText('55 min left', { exact: true }).waitFor();

  blockAnimations = true;
  await page.reload();
  await budget.getByText('55 min left', { exact: true }).waitFor();
  assert.equal(await turtle.getAttribute('data-renderer'), 'sprite');
  assert.equal(await page.evaluate(async () => {
    const still = new Image();
    still.src = '/turtle-plush-poses.png';
    await still.decode();
    return still.naturalWidth;
  }), 384);
  console.log('Signed package smoke test passed for the Turtle shortcut, artwork fallback, screen time permission, app charts, shared limit, and manual refresh.');
} finally {
  await browser.close();
}
