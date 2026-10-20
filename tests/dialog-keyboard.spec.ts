import {test,expect} from '@playwright/test';
import path from 'node:path';

test.use({serviceWorkers:'block',viewport:{width:640,height:760}});
for(const [button,dialog] of [['preparationBtn','localPreparationDialog'],['preparedPackageBtn','preparedImportDialog'],['infoEditorButton','infoEditorDialog'],['mediaStatusBtn','mediaStatusDialog']]) {
  test('keyboard modal '+dialog+' retires an open info-bar overflow',async({page})=>{
    await page.addInitScript(()=>localStorage.setItem('lastSeenVersion','999.0.0'));
    await page.goto('/');await page.locator('#multiFileInput').setInputFiles(['landscape_a.mp4','landscape_b.mp4'].map(n=>path.join(__dirname,'fixtures',n)));
    await expect(page.locator('#comparisonView')).toHaveClass(/active/);
    await page.locator('#infoEditorButton').click();await page.locator('#infoEditorPreset').selectOption('all');await page.locator('#infoEditorClose').click();
    await expect(page.locator('#infoEditorButton')).toHaveAttribute('aria-expanded','false');
    const more=page.locator('.asset-info-bar.info-custom .info-more').first();await expect(more).toBeVisible();await more.click();
    await expect(page.locator('#infoOverflowPanel')).toBeVisible();
    if(button==='preparedPackageBtn'){
      await page.locator('#helpBtn').focus();await page.keyboard.press('Enter');await expect(page.locator('#quickStartPopup')).toBeVisible();
      await page.locator('#helpAdvanced summary').focus();await page.keyboard.press('Enter');
    }
    await page.locator('#'+button).focus();await page.keyboard.press('Enter');await expect(page.locator('#'+dialog)).toBeVisible();
    await expect(page.locator('#infoOverflowPanel')).toBeHidden();
    for(const key of ['Tab','Shift+Tab']){await page.keyboard.press(key);expect(await page.evaluate(id=>document.getElementById(id)!.contains(document.activeElement),dialog)).toBe(true);}
    await page.keyboard.press('Escape');await expect(page.locator('#'+dialog)).not.toBeVisible();await expect(page.locator('#'+button)).toBeFocused();
  });
}
