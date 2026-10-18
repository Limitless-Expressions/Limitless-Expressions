let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(process.env.PLAYWRIGHT_MODULE || `${process.env.USERPROFILE}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`); }
const {chromium} = playwright;
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const root = process.cwd();
  const server = http.createServer((req,res) => {
    const file = path.join(root, decodeURIComponent(new URL(req.url,'http://localhost').pathname));
    try { res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream'); res.end(fs.readFileSync(file)); }
    catch { res.statusCode=404; res.end(); }
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser = await chromium.launch({headless:true,channel:'msedge'});
    for (const entry of ['index.html']) {
      const page = await browser.newPage();
      let submitted;
      await page.route('https://limitless-expressions-api.argon-ecomm.workers.dev/**', async route => {
        const url=new URL(route.request().url());
        if(url.pathname==='/api/config') return route.fulfill({json:{submissionsEnabled:true,checkoutEnabled:false,environment:'test'}});
        if(route.request().method()==='POST') {
          const body=route.request().postData();
          submitted=JSON.parse(body.match(/name="details"\r\n\r\n([^\r]+)/)[1]);
          return route.fulfill({status:201,json:{id:'LE-neon-browser'}});
        }
        return route.fulfill({json:{id:'LE-neon-browser',status:'submitted',checkoutEligible:false,paymentVerified:false}});
      });
      const errors=[]; page.on('pageerror',error=>errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/${entry}`);
      await page.evaluate(()=>openProduct(products.findIndex(p=>p.name==='Custom 3D Printed Neon Name Sign')));
      await page.locator('#neonFonts button:not(:disabled)').first().waitFor();
      await page.waitForFunction(()=>document.querySelector('#f_Font_style').value==='Sacramento');
      assert.equal(await page.locator('#neonFonts button').count(),3);
      assert.match(await page.locator('#f_Mounting_preference').inputValue(),/^Integrated Keyhole/);
      await page.locator('#f_Name_text_optional_if_uploading_logo_').fill('Alex <3');
      assert.equal(await page.locator('#neonPreview').textContent(),'Alex <3');
      await page.locator('input[value="Double-Stroke Neon"]').check();
      await page.waitForFunction(()=>document.querySelector('#f_Font_style').value==='Dancing Script Bold');
      assert.equal(await page.locator('#neonFonts button').count(),8);
      assert.equal(await page.locator('#neonFonts button:disabled').count(),0);
      await page.getByRole('button',{name:'Pacifico',exact:false}).click();
      assert.equal(await page.locator('#f_Font_style').inputValue(),'Pacifico');
      await page.locator('#f_Mounting_preference').selectOption({label:'Wall Standoffs (Request Quote)'});
      assert.match(await page.locator('#summary').textContent(),/Neon channel style: Double-Stroke Neon/);
      assert.match(await page.locator('#summary').textContent(),/Font style: Pacifico/);
      assert.match(await page.locator('#summary').textContent(),/Mounting preference: Wall Standoffs/);
      for (const width of [390,1280]) {
        await page.setViewportSize({width,height:1000});
        assert.equal(await page.evaluate(()=>document.querySelector('#form').scrollWidth>document.querySelector('#form').clientWidth),false);
        if (process.env.NEON_SCREENSHOT_DIR) {
          fs.mkdirSync(process.env.NEON_SCREENSHOT_DIR,{recursive:true});
          await page.screenshot({path:path.join(process.env.NEON_SCREENSHOT_DIR,`neon-${width}.png`)});
        }
      }
      await page.locator('#orderName').fill('Test Customer');
      await page.locator('#orderEmail').fill('customer@example.com');
      await page.locator('#addCart').click();
      await page.waitForFunction(()=>document.querySelector('#f_Font_style').disabled);
      assert.equal(submitted.customization['Neon channel style'],'Double-Stroke Neon');
      assert.equal(submitted.customization['Font style'],'Pacifico');
      assert.equal(submitted.customization['Mounting preference'],'Wall Standoffs (Request Quote)');
      await page.getByRole('button',{name:'Lobster',exact:false}).click();
      assert.equal(await page.locator('#f_Font_style').inputValue(),'Pacifico');
      await page.evaluate(()=>openProduct(products.findIndex(p=>p.name==='Custom 3D Printed Neon Name Sign')));
      await page.waitForFunction(()=>document.querySelector('#f_Font_style').value==='Sacramento');
      await page.locator('input[value="Double-Stroke Neon"]').check();
      await page.waitForFunction(()=>document.querySelector('#f_Font_style').value==='Dancing Script Bold');
      await page.locator('input[value="Single-Stroke Neon"]').check();
      await page.waitForFunction(()=>document.querySelector('#f_Font_style').value==='Sacramento');
      await page.evaluate(()=>openProduct(products.findIndex(p=>p.name==='Custom 3D Printed Name Light Box')));
      assert.equal(await page.locator('#neonFonts').count(),0);
      await page.route('**/*.ttf',route=>route.abort());
      await page.reload();
      await page.evaluate(()=>openProduct(products.findIndex(p=>p.name==='Custom 3D Printed Neon Name Sign')));
      await page.waitForFunction(()=>document.querySelector('#neonPreview').textContent.includes('No font preview available'));
      assert.equal(await page.locator('#f_Font_style').inputValue(),'');
      assert.match(await page.locator('#neonFonts').textContent(),/Unavailable — font could not load/);
      await page.goto(`http://127.0.0.1:${server.address().port}/index.html?product=nfc-keytag`);
      assert.equal(await page.locator('body.nfc-product-page').count(),1);
      assert.equal(await page.locator('#neonFonts').count(),0);
      await page.locator('#f_Quantity').fill('5');
      assert.equal(await page.locator('#nfcProductPrice').textContent(),'$50.00');
      assert.deepEqual(errors,[]);
      await page.close();
      console.log(entry+': channel groups, fonts, live preview, resets, summary, mounting, unavailable assets and responsive layout passed');
    }
  } finally { await browser?.close(); server.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
