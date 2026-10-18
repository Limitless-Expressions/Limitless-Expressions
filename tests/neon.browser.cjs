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
      // Retain the original filled geometry for independent transparency checks.
      await page.addInitScript(() => {
        const original = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function(text,x,y,...rest) {
          (this.canvas.__glyphs ||= []).push({text,x,y,font:this.font,align:this.textAlign,kerning:this.fontKerning,color:this.fillStyle});
          return original.call(this,text,x,y,...rest);
        };
      });
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
      for (const width of [390,1280]) {
        await page.setViewportSize({width,height:1000});
        for (const word of ['ABOPR','Armanie','Yalla']) {
          await page.locator('#f_Name_text_optional_if_uploading_logo_').fill(word);
          const names=await page.locator('#neonFonts button').evaluateAll(buttons=>buttons.map(b=>b.dataset.font));
          for (const name of names) {
            await page.locator('#neonFonts button').filter({hasText:name}).click();
            const pixels=await page.evaluate(() => {
              return [...document.querySelectorAll('#neonFonts canvas,#neonPreview canvas')].map(canvas=>{
                const ctx=canvas.getContext('2d');
                const original=document.createElement('canvas'); original.width=canvas.width;original.height=canvas.height;
                const fill=original.getContext('2d');
                for(const glyph of canvas.__glyphs) {
                  fill.font=glyph.font;fill.textAlign=glyph.align;fill.fontKerning=glyph.kerning;fill.fillStyle=glyph.color;
                  fill.fillText(glyph.text,glyph.x,glyph.y);
                }
                const before=fill.getImageData(0,0,canvas.width,canvas.height).data;
                const after=ctx.getImageData(0,0,canvas.width,canvas.height).data;
                let ink=0,cleared=0,outline=0,gold=0,visible=0;
                for(let i=3;i<after.length;i+=4){
                  if(before[i]>240){ink++;if(after[i]===0)cleared++;}
                  if(after[i]>0)outline++;
                  if(after[i]>32){visible++;if(after[i-3]>after[i-1]&&after[i-2]>after[i-1])gold++;}
                }
                return {ink,cleared,outline,gold,visible};
              });
            });
            assert.equal(pixels.length,9);
            for(const [index,result] of pixels.entries()) {
              assert.ok(result.ink>0&&result.outline>0,`${name}/${word}/${width}: glyph contours present`);
              assert.ok(result.cleared>0,`${name}/${word}/${width}/canvas${index}: solid glyph interiors removed ${JSON.stringify(result)}`);
              assert.equal(result.gold,result.visible,'visible outlines use gold/yellow pixels');
            }
          }
          if(process.env.NEON_SCREENSHOT_DIR){
            fs.mkdirSync(process.env.NEON_SCREENSHOT_DIR,{recursive:true});
            await page.locator('#neonFonts').screenshot({path:path.join(process.env.NEON_SCREENSHOT_DIR,`fonts-${word}-${width}.png`)});
            await page.locator('#neonPreview').screenshot({path:path.join(process.env.NEON_SCREENSHOT_DIR,`live-${word}-${width}.png`)});
          }
          assert.equal(await page.evaluate(()=>document.querySelector('#form').scrollWidth>document.querySelector('#form').clientWidth),false);
        }
      }
      await page.locator('#f_Name_text_optional_if_uploading_logo_').fill('Alex <3');
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
      assert.equal(await page.locator('#neonFonts canvas,#neonPreview canvas').count(),0,'single-stroke remains ordinary font text');
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
      console.log(entry+': 48 hollow font/text/viewport combinations passed; single-stroke, saved selections, mounting, unavailable fonts and published NFC checks passed');
    }
  } finally { await browser?.close(); server.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
