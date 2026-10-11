// Local, reproducible visual/geometry evidence. Run from the repository root
// with its static server on port 8080. Uses no remote media or reporting.
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const output = new URL('./',import.meta.url);
const browser = await chromium.launch({headless:true});
const results = {date:'2026-10-09',browser:'Playwright Chromium',cases:[],errors:[]};
try {
  for (const [name,width,height,touch] of [['desktop',1280,820,false],['narrow',320,736,true],['tablet',736,820,true]]) {
    const context = await browser.newContext({viewport:{width,height},hasTouch:touch,isMobile:touch});
    const page = await context.newPage();
    page.on('pageerror',error => results.errors.push({case:name,message:error.message}));
    await page.addInitScript(() => localStorage.setItem('lastSeenVersion','999.0.0'));
    await page.goto('http://localhost:8080');
    await page.locator('#multiFileInput').setInputFiles(['tests/fixtures/landscape_a.mp4','tests/fixtures/landscape_b.mp4']);
    await page.locator('#comparisonView.active').waitFor();
    await page.locator('#infoEditorButton').click();
    await page.locator('#infoEditorPreset').selectOption('visual');
    await page.locator('[data-info-select="resolution"]').click();
    await page.locator('#infoEditorSize').selectOption('14');
    await page.locator('#infoEditorBold').check();
    await page.locator('#infoEditorColor').evaluate(input => {input.value='#8fc9e8';input.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.locator('[data-info-select="gap-1"]').click();
    await page.locator('#infoEditorSpacerWidth').fill('32');
    await page.screenshot({path:new URL(name+'-editor.png',output).pathname});
    const geometry = await page.evaluate(() => {
      const dialog = document.getElementById('infoEditorDialog'), rect = dialog.getBoundingClientRect();
      return {viewport:[innerWidth,innerHeight],dialog:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},
        documentWidth:document.documentElement.scrollWidth,dialogWidth:dialog.clientWidth,contentWidth:dialog.scrollWidth,
        profile:JSON.parse(localStorage.getItem('pref_infoBarProfiles')).profiles.video};
    });
    assert(geometry.dialog.x >= 11 && geometry.dialog.y >= 15);
    assert(geometry.contentWidth <= geometry.dialogWidth+1,'Dialog content must not overflow sideways');
    assert.equal(geometry.documentWidth,width,'Document must not overflow sideways');
    await page.locator('#infoEditorClose').click();
    await page.screenshot({path:new URL(name+'-grid.png',output).pathname});
    await page.locator('#stackIconBtn').click();
    await page.locator('#stackInfoStrip.info-custom').waitFor();
    const stack = await page.locator('#stackInfoStrip').evaluate(root => {
      const bar = root.getBoundingClientRect(), more = root.querySelector('.info-more');
      return {width:bar.width,moreShown:!more.hidden,moreWithinBar:more.hidden || more.getBoundingClientRect().right <= bar.right+1};
    });
    assert(stack.width > 100 && stack.moreWithinBar,'Narrow Stack metadata/More must remain reachable');
    await page.screenshot({path:new URL(name+'-stack.png',output).pathname});
    // A settled static review must not acquire a self-perpetuating refresh loop.
    const idleRefreshes = await page.evaluate(async () => {
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      let count=0;const owner=window._refreshInfoBars;
      window._refreshInfoBars=function(){count++;return owner();};
      for(let frame=0;frame<45;frame++) await new Promise(resolve=>requestAnimationFrame(resolve));
      window._refreshInfoBars=owner;return count;
    });
    assert(idleRefreshes <= 2,'Info bars must settle after resize/metadata publication');
    results.cases.push({name,...geometry,stack,idleRefreshes});
    await context.close();
  }
  assert.equal(results.errors.length,0,'No browser runtime errors');
  results.passed=true;
} catch(error) { results.passed=false;results.failure=error.stack; }
finally {
  await writeFile(new URL('ui-verification.json',output),JSON.stringify(results,null,2)+'\n');
  await browser.close();
}
console.log(JSON.stringify({passed:results.passed,cases:results.cases.map(({name,idleRefreshes})=>({name,idleRefreshes})),errors:results.errors,failure:results.failure}));
if(!results.passed) process.exitCode=1;
