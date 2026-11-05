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
    // Fit also runs after the dialog closes and after the grid measures.
    // The button's label and left edge keep moving through that settle
    // (More 3, then More 6 further left). A pointer click during the move
    // misses it. Click only after the same label and left edge survive two frames.
    const more=page.locator('.asset-layer .asset-info-bar.info-custom .info-more').filter({visible:true});
    await expect.poll(()=>page.evaluate(()=>new Promise(resolve=>{
      const signature=()=>[...document.querySelectorAll('.asset-layer .asset-info-bar.info-custom .info-more')].filter(button=>{
        const bar=button.closest('.asset-info-bar')!.getBoundingClientRect();
        return bar.width>0 && !(button as HTMLButtonElement).hidden && button.getClientRects().length>0;
      }).map(button=>button.textContent+'@'+Math.round(button.getBoundingClientRect().left)).join('|');
      requestAnimationFrame(()=>{
        const first=signature();
        requestAnimationFrame(()=>resolve(first && first===signature() ? first : ''));
      });
    }))).not.toBe('');
    // WebKit can shift the bar once more after two stable frames. A click that
    // lands beside More leaves the list closed, so try again until it opens.
    await expect(async()=>{
      if(await page.locator('#infoOverflowPanel').isHidden()) await more.first().click();
      await expect(page.locator('#infoOverflowPanel')).toBeVisible({timeout:1000});
    }).toPass({timeout:8000});
    let opener=button,activate=button;
    if(button==='preparedPackageBtn'){
      await page.locator('#helpBtn').focus();await page.keyboard.press('Enter');await expect(page.locator('#quickStartPopup')).toBeVisible();
      await page.locator('#helpAdvanced summary').focus();await page.keyboard.press('Enter');
    }else if(!(await page.locator('#'+button).isVisible())){
      await page.locator('#helpBtn').focus();await page.keyboard.press('Enter');await expect(page.locator('#quickStartPopup')).toBeVisible();
      if(button==='preparationBtn'){activate='helpPreparationBtn';opener='helpBtn';}
      else activate=opener='helpMediaStatusBtn';
      await expect(page.locator('#'+activate)).toBeVisible();
    }
    await page.locator('#'+activate).focus();await page.keyboard.press('Enter');await expect(page.locator('#'+dialog)).toBeVisible();
    await expect(page.locator('#infoOverflowPanel')).toBeHidden();
    for(const key of ['Tab','Shift+Tab']){await page.keyboard.press(key);expect(await page.evaluate(id=>document.getElementById(id)!.contains(document.activeElement),dialog)).toBe(true);}
    await page.keyboard.press('Escape');await expect(page.locator('#'+dialog)).not.toBeVisible();
    // A comparison that finishes loading must not pull focus off Settings.
    if(opener==='infoEditorButton') await page.evaluate(()=>_focusComparisonAfterLoad());
    await expect(page.locator('#'+opener)).toBeFocused();
  });
}
