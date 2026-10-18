let playwright;
try {playwright=require('playwright');} catch {playwright=require(process.env.PLAYWRIGHT_MODULE||`${process.env.USERPROFILE}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`);}
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
(async()=>{
  const {fixedPriceQuote}=await import(pathToFileURL(path.join(process.cwd(),'backend/src/pricing.js')));
  const catalog=JSON.parse(fs.readFileSync('tests/fixtures/published-catalog.json'));
  const slugs=['hype-chain','nfc-keytag','google-review-display','name-desk-plate','name-initial-sign','name-light-box','neon-name-sign','business-logo-sign'];
  const server=http.createServer((req,res)=>{
    let pathname=decodeURIComponent(new URL(req.url,'http://local').pathname);
    if(pathname.endsWith('/'))pathname+='index.html';
    const file=path.join(process.cwd(),pathname);
    try {res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(file));} catch {res.statusCode=404;res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}/index.html`;
  let browser;
  try {
    browser=await playwright.chromium.launch({headless:true,channel:'msedge'});
    for(const width of [390,1280]) {
      const context=await browser.newContext({viewport:{width,height:1000},hasTouch:width===390,isMobile:width===390});
      for(const [i,slug] of slugs.entries()) {
        const page=await context.newPage();page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(10000);const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(slug+': '+e.message);});
        let submitted=null,posts=0;
        await page.addInitScript(()=>{let callback;window.turnstile={render(el,options){callback=options.callback;setTimeout(()=>callback('test-verification'),0);return 0;},reset(){setTimeout(()=>callback?.('test-verification'),0);}};});
        await page.route('https://challenges.cloudflare.com/**',r=>r.fulfill({contentType:'text/javascript',body:''}));
        await page.route('https://checkout.stripe.com/**',r=>r.fulfill({contentType:'text/html',body:'Mock Stripe checkout'}));
        await page.route('https://limitless-expressions-api.argon-ecomm.workers.dev/**',async route=>{
          const url=new URL(route.request().url());
          if(url.pathname==='/api/config')return route.fulfill({json:{submissionsEnabled:true,checkoutEnabled:true,environment:'test',turnstileSiteKey:'test-key'}});
          if(url.pathname.endsWith('/checkout'))return route.fulfill({json:{url:'https://checkout.stripe.com/c/pay/mock-product'}});
          if(route.request().method()==='POST') {
            submitted=JSON.parse(route.request().postData().match(/name="details"\r\n\r\n([^\r]+)/)[1]);posts++;
            return route.fulfill({status:201,json:{id:'LE-test-'+slug}});
          }
          return route.fulfill({json:{id:'LE-test-'+slug,status:'submitted',checkoutEligible:!!(submitted&&fixedPriceQuote(submitted.product,submitted.quantity,submitted.customization)),paymentVerified:false}});
        });
        await page.goto(base+'?product='+slug);
        await page.waitForFunction(()=>document.getElementById('addCart')&&!document.getElementById('addCart').disabled);
        assert.equal(await page.locator('.product-details h1').textContent(),catalog[i].name);
        assert.equal(await page.locator('body.nfc-product-page').count(),1);
        await page.reload();
        await page.waitForFunction(()=>!document.getElementById('addCart').disabled);
        assert.equal(await page.locator('.product-details h1').textContent(),catalog[i].name);
        const images=await page.locator('#nfcProductPhotos img').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('src')));
        assert.deepEqual(images,catalog[i].images||[catalog[i].image]);
        if(i===1)assert.match(images.at(-1),/Broom/);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow: '+slug+'/'+width);
        if(images.length>1){
          await page.locator('#nfcProductPhotos .gallery-next').click();
          await page.waitForFunction(()=>document.querySelector('#nfcProductPhotos .gallery-track').scrollLeft>0);
          await page.locator('#nfcProductPhotos .gallery-prev').click();
        }
        for(const field of catalog[i].fields)assert.equal(await page.locator('#f_'+field.replace(/\W+/g,'_')).count(),1,slug+': '+field);
        await page.locator('#orderName').fill('Product Test');await page.locator('#orderEmail').fill('test@example.com');
        if([0,1,7].includes(i)){
          await page.locator('#addCart').click();assert.match(await page.locator('#orderStatus').textContent(),/Upload/);assert.equal(posts,0);
        }
        const inputs=page.locator('#form input:not([type=hidden]):not([type=radio]),#form textarea');
        for(const input of await inputs.all()) {
          const type=await input.getAttribute('type');
          if(type==='file'){await input.setInputFiles({name:'logo.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0H10V10Z"/></svg>')});continue;}
          if(type==='number')continue;
          const id=await input.getAttribute('id');await input.fill(id.includes('URL')?'https://example.com':'Product test');
        }
        if(i===0){
          await page.locator('#f_Pendant_size').selectOption('5 in');assert.equal(await page.locator('#nfcProductPrice').textContent(),'Custom quote');
          await page.locator('#f_Pendant_size').selectOption('4 in');assert.equal(await page.locator('#nfcProductPrice').textContent(),'$40');
        }
        if(i===1){
          for(const [q,total] of [['5','$50.00'],['10','$70.00'],['2','Custom quote'],['1','$15.00']]){await page.locator('#f_Quantity').fill(q);assert.equal(await page.locator('#nfcProductPrice').textContent(),total);}
          assert.match(await page.locator('#form').textContent(),/Maximum 4 colors/);
        }
        if(i===3)await page.locator('#f_Desk_plate_mounting').selectOption('Stand and mounting holes');
        if(i===5)await page.locator('#f_LED_color').selectOption('Warm white');
        if(i===7){await page.locator('#f_Neon_sign_size').selectOption('45 in');assert.equal(await page.locator('#nfcProductPrice').textContent(),'Est. $750–$1,000');await page.locator('#f_Material_preference').selectOption('ACM UV Printed');}
        if(i===6){
          await page.locator('#f_Neon_sign_size').selectOption('20 in');
          await page.locator('input[value="Double-Stroke Neon"]').check();
          await page.waitForFunction(()=>document.querySelector('#f_Font_style').value==='Dancing Script Bold');
          await page.locator('#neonFonts button').filter({hasText:'Pacifico'}).click();
          assert.equal(await page.locator('#neonPreview canvas').count(),1);
        }
        const expected=await page.evaluate(()=>Object.fromEntries(active.fields.filter(f=>f!=='Quantity'&&!/upload/i.test(f)).map(f=>[f,document.getElementById('f_'+f.replace(/\W+/g,'_')).value])));
        if(process.env.PRODUCT_SCREENSHOT_DIR){
          fs.mkdirSync(process.env.PRODUCT_SCREENSHOT_DIR,{recursive:true});
          await page.evaluate(async()=>{window.scrollTo(0,0);document.querySelector('#nfcProductPhotos .gallery-track')?.scrollTo({left:0,behavior:'instant'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
          await page.screenshot({path:path.join(process.env.PRODUCT_SCREENSHOT_DIR,`${slug}-${width}.png`),fullPage:true});
        }
        await page.locator('#addCart').click();
        const eligible=!!fixedPriceQuote(catalog[i].name,1,expected);
        if(eligible)await page.waitForURL('https://checkout.stripe.com/**');
        else {await page.waitForFunction(()=>document.getElementById('f_Quantity').disabled&&document.getElementById('orderStatus').textContent.includes('is saved'));assert.match(await page.locator('#orderStatus').textContent(),/saved/);}
        assert.equal(submitted.product,catalog[i].name);assert.deepEqual(submitted.customization,expected);
        assert.equal(submitted.turnstileToken,'test-verification');assert.equal(posts,1);
        assert.deepEqual(errors,[]);await page.close();
      }
      const page=await context.newPage();await page.route('https://limitless-expressions-api.argon-ecomm.workers.dev/**',r=>r.fulfill({json:{submissionsEnabled:false}}));
      await page.goto(base);assert.equal(await page.locator('#products .card').count(),11);
      assert.equal(await page.locator('#products a.customize').count(),8);
      for(const slug of slugs)assert.equal(await page.locator(`#products a[href="?product=${slug}"]`).count(),1);
      await page.locator('#products a[href="?product=hype-chain"]').click();await page.waitForURL(url=>url.searchParams.get('product')==='hype-chain');
      await page.goBack();assert.equal(await page.locator('body.nfc-product-page').count(),0);
      await page.goForward();assert.equal(await page.locator('.product-details h1').textContent(),catalog[0].name);
      await page.locator('.product-crumbs a').click();await page.waitForURL(url=>url.hash==='#shop');assert.equal(await page.locator('body.nfc-product-page').count(),0);
      for(const route of ['3d-printed-dogs','custom-parts','digital-stl-files','unknown']){await page.goto(base+'?product='+route);assert.equal(await page.locator('body.nfc-product-page').count(),0);}
      await context.close();console.log(width+'px: all eight product pages, uploads, galleries, prices, Turnstile, saved selections, checkout/quotes and navigation passed');
    }
  } finally {await browser?.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
