import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { preview } from 'vite';

let browser, server, url;
const shots = process.env.DAYBOOK_PHONE_SCREENSHOTS;
const button = (scope, name) => scope.getByRole('button', { name, exact: true });
const nav = (page, name) => button(page.getByRole('navigation'), name);

before(async () => {
  server = await preview({ build: { outDir: process.env.ONE_LIFE_TEST_DIST || 'dist' }, preview: { host: '127.0.0.1', port: 0 } });
  url = 'http://127.0.0.1:' + server.httpServer.address().port;
  browser = await chromium.launch(process.env.ONE_LIFE_BROWSER ? { executablePath: process.env.ONE_LIFE_BROWSER }
    : existsSync(chromium.executablePath()) ? {} : { channel: 'msedge' });
  // These suites test an existing user; the first-run habit picker has its own test.
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (options) => {
    const context = await newContext(options);
    if (!process.env.SHOW_ONBOARDING) await context.addInitScript(() => { try { localStorage.setItem('sparky-onboarding-done', '1'); } catch { /* storage blocked */ } });
    return context;
  };
  if (shots) await mkdir(shots, { recursive: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

async function phone(t, width = 375, size = 16) {
  const context = await browser.newContext({ viewport: { width, height: width === 320 ? 640 : 812 },
    isMobile: true, hasTouch: true, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  t.after(() => context.close());
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Page.setFontSizes', { fontSizes: { standard: size, fixed: size } });
  await page.goto(url + '/third-party-notices.txt');
  await page.goto(url + '/index.html');
  await page.locator('#budget-coach').waitFor();
  assert.equal(await page.locator('html').evaluate(el => getComputedStyle(el).fontSize), size + 'px');
  return { page, cdp };
}

async function screenshot(page, name) {
  if (shots) {
    await page.locator('.toast.visible').waitFor({ state: 'hidden' });
    await page.screenshot({ path: path.join(shots, name + '.png'), animations: 'disabled' });
  }
}

async function focused(locator) {
  await locator.page().waitForFunction(el => el === document.activeElement, await locator.elementHandle(), { timeout: 3000 });
}

test('Back and Forward replay the visited tabs and Life sections', async t => {
  const { page } = await phone(t);
  await nav(page, 'Life').tap();
  await button(page, 'Programs').tap();
  await button(page, 'Programs').tap();
  await page.goBack();
  await page.getByRole('button', { name: 'Goals', pressed: true, exact: true }).waitFor();
  await page.goBack();
  await page.locator('#budget-coach').waitFor();
  await page.goForward();
  await page.goForward();
  await page.getByRole('button', { name: 'Programs', pressed: true, exact: true }).waitFor();
  await page.goBack();
  await page.goBack();
  await page.goBack();
  assert.equal(page.url(), url + '/third-party-notices.txt');
});

test('Today and History replay individual section changes across tabs', async t => {
  const { page } = await phone(t);
  const steps = ['Habits', 'Small wins', 'Check-in', 'Daily', 'Reports', 'Phone activity'];
  await button(page, 'Small wins').tap();
  await button(page, 'Check-in').tap();
  await nav(page, 'History').tap();
  await button(page, 'Reports').tap();
  await button(page, 'Phone activity').tap();
  const selected = name => page.getByRole('button', { name, exact: true, pressed: true }).waitFor();
  for (const name of steps.slice(0, -1).reverse()) {
    await page.goBack();
    await selected(name);
  }
  for (const name of steps.slice(1)) {
    await page.goForward();
    await selected(name);
  }
  await page.goBack();
  await button(page, 'Daily').tap();
  assert.equal(await page.goForward(), null);
  await selected('Daily');
});

test('a first-page local dialog consumes Back and restores its opener', async t => {
  const { page } = await phone(t);
  const trigger = button(page, 'Budget coach settings');
  const dialog = page.getByRole('dialog', { name: 'Budget coach settings' });
  await trigger.press('Enter');
  await dialog.waitFor();
  await page.goBack();
  await focused(trigger);
  assert.equal(page.url(), url + '/index.html');
  await page.goForward();
  await dialog.waitFor();
  await button(dialog, 'Close').press('Enter');
  await focused(trigger);
  await page.waitForFunction(() => !history.state?.daybookDialogs?.length);
  await page.goBack();
  assert.equal(page.url(), url + '/third-party-notices.txt');
});

test('Back unwinds nested dialogs and Forward reopens each level', async t => {
  const { page } = await phone(t);
  const read = button(page, 'Read');
  const log = page.getByRole('dialog', { name: 'Read', exact: true });
  const edit = button(log, 'Edit habit');
  const editor = page.getByRole('dialog', { name: 'Edit habit', exact: true });
  await read.tap();
  await edit.press('Enter');
  await editor.waitFor();
  await page.goBack();
  await focused(edit);
  await page.goBack();
  await focused(read);
  await page.goForward();
  await log.waitFor();
  await page.goForward();
  await editor.waitFor();
  await page.keyboard.press('Escape');
  await focused(edit);
  await page.waitForFunction(() => history.state?.daybookDialogs?.length === 1);
  await page.goBack();
  await focused(read);
});

test('Forward restores a dialog after its page remounts without saving it', async t => {
  const { page } = await phone(t);
  await nav(page, 'Settings').tap();
  const add = button(page, 'Add habit');
  await add.tap();
  const dialog = page.getByRole('dialog', { name: 'Add a habit' });
  await dialog.getByLabel('Habit name').fill('Unsaved browser traversal');
  await page.evaluate(() => history.go(-2));
  await page.locator('#budget-coach').waitFor();
  await page.evaluate(() => history.go(2));
  await dialog.waitFor();
  assert.equal(await dialog.getByLabel('Habit name').inputValue(), '');
  await page.goBack();
  await focused(add);
  assert.equal(await page.getByText('Unsaved browser traversal', { exact: true }).count(), 0);
});

test('the Android bridge keeps native history and keyboard dismissal', async t => {
  const { page } = await phone(t);
  await page.addInitScript(() => {
    window.OneLifeAndroid = { postMessage(raw) {
      const { id } = JSON.parse(raw);
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ id, value: null }) }));
    } };
  });
  await page.reload();
  const before = await page.evaluate(() => history.length);
  await button(page, 'Small wins').tap();
  await nav(page, 'History').tap();
  await button(page, 'Reports').tap();
  await nav(page, 'Settings').tap();
  const add = button(page, 'Add habit');
  await add.press('Enter');
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  await focused(add);
  assert.equal(await page.evaluate(() => history.length), before);
});

test('Focus contains keyboard and accessibility navigation and returns to Start', async t => {
  const { page, cdp } = await phone(t, 375, 32);
  await nav(page, 'Life').tap();
  await button(page, 'Focus').tap();
  const start = button(page, 'Start focus session');
  await start.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Focus: Personal focus' });
  await dialog.waitFor();
  await screenshot(page, 'focus-375-large');
  assert.ok(await dialog.evaluate(el => el.matches(':modal') && el.contains(document.activeElement)));
  const { nodes } = await cdp.send('Accessibility.getFullAXTree');
  assert.ok(!nodes.some(n => !n.ignored && n.role.value === 'navigation'));
  await button(dialog, 'Pause').focus();
  for (const [key, name] of [['Shift+Tab', 'Stop and save'], ['Tab', 'Pause'], ['Tab', 'Restart'], ['Tab', 'Stop and save'], ['Tab', 'Pause']]) {
    await page.keyboard.press(key);
    await focused(button(dialog, name));
  }
  await page.keyboard.press('Enter');
  await button(dialog, 'Resume').waitFor();
  await page.keyboard.press('Escape');
  assert.ok(await dialog.isVisible());
  await button(dialog, 'Stop and save').press('Enter');
  await focused(start);
});

test('closing the habit sheet restores its keyboard or touch opener', async t => {
  const { page } = await phone(t);
  await nav(page, 'Settings').tap();
  const add = button(page, 'Add habit');
  for (const input of ['keyboard', 'touch']) {
    if (input === 'touch') await add.tap();
    else await add.press('Enter');
    await page.getByRole('dialog').waitFor();
    await page.keyboard.press('Escape');
    await focused(add);
  }
});

async function readableLabels(page) {
  for (const el of await page.locator('.segments:visible button, nav button').all()) {
    const fits = await el.evaluate(button => {
      const label = button.lastElementChild || button;
      const range = document.createRange();
      range.selectNodeContents(label);
      const box = button.getBoundingClientRect();
      return [...range.getClientRects()].every(r => r.left >= box.left - 1 && r.right <= box.right + 1) &&
        (!button.closest('nav') || range.getClientRects().length === 1);
    });
    assert.ok(fits, await el.innerText());
  }
}

// Inspect the text actually laid out by Chromium, including its native form control internals.
async function controlText(cdp, selector, value) {
  const { root } = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  const { node } = await cdp.send('DOM.describeNode', { nodeId, depth: -1, pierce: true });
  const queue = [node];
  while (queue.length) {
    const child = queue.shift();
    queue.push(...child.children || [], ...child.shadowRoots || []);
    if (child.nodeType !== 3 || child.nodeValue.trim() !== value) continue;
    const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: child.backendNodeId });
    const { result } = await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, returnByValue: true,
      functionDeclaration: `function() {
        const range = document.createRange();
        range.selectNodeContents(this);
        const rects = [...range.getClientRects()];
        if (!rects.length) return false;
        let el = this.parentElement;
        while (el) {
          if (el.matches('input, select') || getComputedStyle(el).overflowX !== 'visible') {
            const box = el.getBoundingClientRect();
            if (rects.some(r => r.width === 0 || r.left < box.left - 1 || r.right > box.right + 1)) return false;
          }
          el = el.parentElement || el.getRootNode().host;
        }
        return true;
      }` });
    if (result.value) return true;
  }
  return false;
}

for (const [width, size, theme] of [[375, 16, 'Light'], [375, 32, 'Light'], [375, 32, 'Dark'], [320, 32, 'Light']]) {
  test(`labels, selected values and dates fit at ${width}px, ${size}px text, ${theme}`, async t => {
    const { page, cdp } = await phone(t, width, size);
    if (theme === 'Dark') {
      await nav(page, 'Settings').tap();
      await button(page, 'Dark').tap();
      await page.locator('html[data-theme="dark"]').waitFor();
      await nav(page, 'Today').tap();
    }
    await readableLabels(page);
    await nav(page, 'Life').tap();
    await readableLabels(page);
    if (size === 32 && width === 375) await screenshot(page, 'life-375-large-' + theme.toLowerCase());
    await nav(page, 'History').tap();
    await button(page, 'Previous week').tap();
    await readableLabels(page);
    // The date bar title is the visible date now; it must fit without being cut off.
    assert.ok(await page.locator('.period-title-text').evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && el.getBoundingClientRect().right <= innerWidth), 'date title fits');
    for (const ring of await page.locator('.day-ring').all()) {
      assert.ok(await ring.evaluate(el => {
        const box = el.getBoundingClientRect();
        const text = el.querySelector('strong').getBoundingClientRect();
        return text.width < box.width * 0.72 && box.left >= 0 && box.right <= innerWidth;
      }), 'date fits inside ring');
    }
    if (width === 320) {
      await page.locator('.history-days').evaluate(el => el.scrollIntoView({ block: 'center' }));
      await screenshot(page, 'history-320-large');
    }
    await nav(page, 'Settings').tap();
    await button(page, 'Add habit').tap();
    const selector = 'dialog select[name="category"]';
    const tracking = 'dialog .form-grid select:not([name])';
    await page.locator(selector).evaluate(el => el.scrollIntoView({ block: 'center' }));
    if (width === 320) await screenshot(page, 'add-habit-320-large');
    assert.ok(await controlText(cdp, selector, 'Physical health & performance'), 'visible selected life area');
    assert.ok(await controlText(cdp, tracking, 'Checkbox'), 'visible selected tracking type');
    await page.locator(tracking).selectOption('measurement');
    assert.ok(await controlText(cdp, tracking, 'Measurement'), 'visible changed tracking type');
  });
}

test('the day ring beside the count grows with enlarged text', async t => {
  for (const size of [16, 32]) {
    const { page } = await phone(t, 375, size);
    const ring = await page.locator('.daybook-feature .day-count .today-ring').boundingBox();
    // 1.125rem: 18 px at normal text, 36 px at 200%, so it keeps pace with the "x of y done today" text.
    assert.ok(Math.abs(ring.width - size * 1.125) < 1, `ring is ${ring.width}px at ${size}px text`);
  }
});
