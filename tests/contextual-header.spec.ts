import {test, expect} from '@playwright/test';
import path from 'node:path';

test.use({serviceWorkers: 'block'});
const fixture = (name: string) => path.join(__dirname, 'fixtures', name);

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('lastSeenVersion', '999.0.0'));
  await page.goto('/');
});

test('Preparation and Media status stay hidden until they are needed', async ({page}) => {
  await expect(page.locator('#preparationBtn')).toBeHidden();
  await expect(page.locator('#mediaStatusBtn')).toBeHidden();
  await page.locator('#helpBtn').click();
  await expect(page.locator('#helpPreparationBtn')).toBeVisible();
  await expect(page.locator('#helpMediaStatusBtn')).toBeHidden();
  await page.locator('#helpPreparationBtn').click();
  await expect(page.locator('#localPreparationDialog')).toBeVisible();
  await expect(page.locator('#preparationBtn')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#localPreparationDialog')).toBeHidden();
  await expect(page.locator('#quickStartPopup')).toBeHidden();
  await expect(page.locator('#preparationBtn')).toBeHidden();
  await expect(page.locator('#helpBtn')).toBeFocused();
});

test('a preparation link opens the dialog directly and keeps the header button', async ({page}) => {
  await page.goto('/?kept=1#preparation=' + encodeURIComponent('http://127.0.0.1:9'));
  await expect(page.locator('#localPreparationDialog')).toBeVisible();
  await expect(page.locator('#localPreparationAddress')).toHaveValue('http://127.0.0.1:9');
  await expect(page.locator('#preparationBtn')).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  expect(new URL(page.url()).search).toBe('?kept=1');
});

test('an ordinary image leaves both header buttons hidden and Help can still open Media status', async ({page}) => {
  await page.locator('#multiFileInput').setInputFiles(fixture('green.png'));
  await expect(page.locator('#comparisonView')).toHaveClass(/active/);
  await expect.poll(async () => page.evaluate(() => (window as any).WarpDiffHostAPI.readMediaInputReports().editA?.capabilities.picture.state)).toBe('available');
  await expect(page.locator('#preparationBtn')).toBeHidden();
  await expect(page.locator('#mediaStatusBtn')).toBeHidden();
  await page.locator('#helpBtn').click();
  const help = page.locator('#helpMediaStatusBtn');
  await expect(help).toBeVisible();
  await help.click();
  const dialog = page.locator('#mediaStatusDialog');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#mediaStatusContent')).toContainText('green.png');
  await expect(page.locator('#mediaStatusRefresh')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#mediaStatusClose')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#mediaStatusRefresh')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(help).toBeFocused();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.getElementById('quickStartPopup')!.contains(document.activeElement))).toBe(true);
});

test('Media status appears for a failed picture, hides after a later success, and returns focus to Help', async ({page}) => {
  await page.locator('#multiFileInput').setInputFiles(fixture('green.png'));
  await expect(page.locator('#comparisonView')).toHaveClass(/active/);
  await page.evaluate(() => {
    const token = (window as any).eval('_loadingProgressToken');
    (window as any)._mediaInputObserve('editA', token, {mediaFailed: true});
  });
  const header = page.locator('#mediaStatusBtn');
  await expect(header).toBeVisible();
  await header.click();
  await expect(page.locator('#mediaStatusDialog')).toBeVisible();
  await expect(page.locator('#mediaStatusContent')).toContainText('could not be decoded');
  await page.evaluate(() => {
    const token = (window as any).eval('_loadingProgressToken');
    (window as any)._mediaInputObserve('editA', token, {mediaFailed: false, pictureDecoded: true, frameAccess: true});
  });
  await expect(header).toBeHidden();
  await expect(page.locator('#mediaStatusDialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#mediaStatusDialog')).toBeHidden();
  await expect(page.locator('#helpBtn')).toBeFocused();
  await page.locator('#helpBtn').click();
  await expect(page.locator('#helpMediaStatusBtn')).toBeVisible();
});

test('Preparation appears for a review copy that can be reopened and hides when that recovery is gone', async ({page}) => {
  await page.locator('#multiFileInput').setInputFiles(fixture('red.png'));
  await expect(page.locator('#comparisonView')).toHaveClass(/active/);
  await expect(page.locator('#preparationBtn')).toBeHidden();
  await page.evaluate(() => {
    const file = new File(['a'], 'review.mp4', {type: 'video/mp4'});
    const w = window as any;
    w.__recoveryProbe = {files: [file], preparedFiles: new Set([file]), announced: true, notices: []};
    w.eval('_localPreparationRecovery = window.__recoveryProbe; _localPreparationRecovery.token = _loadingProgressToken; _renderLocalPreparation()');
  });
  await expect(page.locator('#preparationBtn')).toBeVisible();
  await page.locator('#preparationBtn').click();
  await expect(page.locator('#localPreparationRestore')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#preparationBtn')).toBeFocused();
  await page.evaluate(() => {
    (window as any).eval('_releaseLocalPreparationRecovery(); _renderLocalPreparation()');
  });
  await expect(page.locator('#preparationBtn')).toBeHidden();
});

test('a file that needs preparation shows the header button', async ({page}) => {
  await page.locator('#multiFileInput').setInputFiles({name: 'corrupt.mp4', mimeType: 'video/mp4', buffer: Buffer.from('not a movie')});
  await expect(page.locator('#preparationBtn')).toHaveText('Preparation needed', {timeout: 15000});
  await expect(page.locator('#mediaStatusBtn')).toBeVisible();
  await expect(page.locator('#localPreparationDialog')).toBeHidden();
});
