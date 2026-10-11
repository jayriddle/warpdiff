// Read-only review probe. Run from the repository root with port 8080 serving it.
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({headless:true});
const cases = [];
try {
  for (const [width,height,file] of [[320,736,'portrait.mp4'],[320,400,'portrait.mp4'],[736,400,'portrait.mp4'],[1280,720,'portrait.mp4'],[320,736,'tall.png']]) {
    const page = await browser.newPage({viewport:{width,height}});
    await page.addInitScript(()=>localStorage.setItem('lastSeenVersion','999.0.0'));
    await page.goto('http://localhost:8080');
    await page.locator('#infoEditorButton').click();
    await page.locator('#infoEditorType').selectOption(file.endsWith('.png')?'image':'video');
    await page.locator('#infoEditorPreset').selectOption('all');
    await page.locator('#infoEditorClose').click();
    await page.locator('#multiFileInput').setInputFiles(Array(4).fill('tests/fixtures/'+file));
    await page.locator('#comparisonView.active').waitFor();
    await page.waitForFunction(()=>document.querySelectorAll('.asset-info-bar.info-custom').length===4);
    await page.evaluate(async()=>{for(let frame=0;frame<8;frame++)await new Promise(resolve=>requestAnimationFrame(resolve));});
    const bars = await page.locator('.asset-info-bar.info-custom').evaluateAll(elements=>elements.map(element=>{
      const bar=element.getBoundingClientRect(), more=element.querySelector('.info-more'), button=more.getBoundingClientRect();
      return {barWidth:bar.width,barRight:bar.right,moreShown:!more.hidden,
        buttonLeft:button.left,buttonRight:button.right,buttonWidth:button.width,
        fullyWithinBar:button.left>=bar.left && button.right<=bar.right+1,
        fullyClipped:button.left>=bar.right};
    }));
    cases.push({width,height,file,bars});
    if(width===320 && file==='portrait.mp4')await page.screenshot({path:new URL(`review-portrait-${width}x${height}.png`,import.meta.url).pathname});
    await page.close();
  }
} finally {await browser.close();}
const result={date:'2026-10-09',browser:'Playwright Chromium',kind:'read-only release-readiness review',
  result:cases.every(item=>item.bars.every(bar=>bar.fullyWithinBar))?'pass':'confirmed clipping defect',cases};
await writeFile(new URL('review-portrait-grid.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({result:result.result,cases:cases.map(item=>({width:item.width,height:item.height,file:item.file,
  clipped:item.bars.filter(bar=>!bar.fullyWithinBar).length,fullyClipped:item.bars.filter(bar=>bar.fullyClipped).length}))}));
