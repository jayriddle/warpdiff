import {test,expect} from '@playwright/test';
import path from 'node:path';

test.use({serviceWorkers:'block',viewport:{width:420,height:760}});
for(const [button,dialog] of [['preparationBtn','localPreparationDialog'],['preparedPackageBtn','preparedImportDialog'],['infoEditorButton','infoEditorDialog'],['mediaStatusBtn','mediaStatusDialog']]) {
  test('keyboard modal '+dialog+' retires an open info-bar overflow',async({page})=>{
    await page.addInitScript(()=>localStorage.setItem('lastSeenVersion','999.0.0'));
    await page.goto('/');await page.locator('#multiFileInput').setInputFiles(['landscape_a.mp4','landscape_b.mp4'].map(n=>path.join(__dirname,'fixtures',n)));
    await expect(page.locator('#comparisonView')).toHaveClass(/active/);
    await page.locator('#infoEditorButton').click();await page.locator('#infoEditorPreset').selectOption('all');await page.locator('#infoEditorClose').click();
    await expect(page.locator('#infoEditorButton')).toHaveAttribute('aria-expanded','false');
    // Two landscape clips in a wide window often stack, and a full-width bar
    // can hold every field, so More stays hidden on purpose. 420px cannot.
    // Fit also runs after the dialog closes and after the grid measures, so
    // wait until a laid-out bar is actually overflowing before clicking.
    const more=page.locator('.asset-layer .asset-info-bar.info-custom .info-more').filter({visible:true});
    await expect.poll(()=>page.evaluate(()=>[...document.querySelectorAll('.asset-layer .asset-info-bar.info-custom .info-more')].filter(button=>{
      const bar=button.closest('.asset-info-bar')!.getBoundingClientRect();
      return bar.width>0 && !(button as HTMLButtonElement).hidden && button.getClientRects().length>0;
    }).length)).toBeGreaterThan(0);
    await more.first().click();
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
