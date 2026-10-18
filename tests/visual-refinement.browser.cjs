let playwright;try{playwright=require('playwright');}catch{playwright=require(process.env.PLAYWRIGHT_MODULE||`${process.env.USERPROFILE}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`);}
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
(async()=>{
 const root=process.cwd(),out=process.env.VISUAL_SCREENSHOT_DIR;
 const server=http.createServer((req,res)=>{let name=decodeURIComponent(new URL(req.url,'http://local').pathname);if(name.endsWith('/'))name+='index.html';const file=path.join(root,name);try{res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await playwright.chromium.launch({headless:true,channel:'msedge'});
  const routes=['','hype-chain','nfc-keytag','google-review-display','name-desk-plate','name-initial-sign','name-light-box','neon-name-sign','business-logo-sign'];
  for(const width of [320,390,768,1440]){
   const page=await browser.newPage({viewport:{width,height:1100},hasTouch:width<800,isMobile:width<600});page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('https://limitless-expressions-api.argon-ecomm.workers.dev/**',r=>r.fulfill({json:{submissionsEnabled:true,checkoutEnabled:false,environment:'test'}}));
   for(const slug of routes){
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html${slug?'?product='+slug:''}`);
    await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(img=>img.complete?Promise.resolve():new Promise(r=>{img.onload=r;img.onerror=r;})));});
    if(slug==='hype-chain')await page.locator('#f_Pendant_size').selectOption('4 in');
    if(slug==='neon-name-sign'){
     await page.locator('#f_Name_text_optional_if_uploading_logo_').fill('Armanie');
     await page.locator('input[value="Double-Stroke Neon"]').check();
     await page.waitForFunction(()=>document.querySelector('#f_Font_style').value==='Dancing Script Bold');
     await page.locator('#neonFonts button').filter({hasText:'Pacifico'}).click();
     await page.locator('#f_Neon_sign_size').selectOption('20 in');
    }
    const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,formOverflow:!!document.getElementById('f_Quantity')&&document.getElementById('form').scrollWidth>document.getElementById('form').clientWidth,broken:[...document.images].filter(img=>!img.naturalWidth).map(img=>img.src),photoFits:[...document.querySelectorAll('.art img,.product-photo-frame img')].map(img=>({fit:getComputedStyle(img).objectFit,transform:getComputedStyle(img).transform}))}));
    assert.equal(layout.overflow,false,`${slug||'home'}/${width}: viewport overflow`);assert.equal(layout.formOverflow,false,`${slug}/${width}: form overflow`);assert.deepEqual(layout.broken,[]);
    for(const photo of layout.photoFits){assert.equal(photo.fit,'contain');assert.equal(photo.transform,'none');}
    const clipped=await page.locator('.art img,.product-photo-frame img').evaluateAll(images=>images.filter(img=>{const box=img.getBoundingClientRect(),parent=img.parentElement.getBoundingClientRect();return parent.height>0&&parent.width>0&&(box.width>parent.width+1||box.height>parent.height+1);}).map(img=>img.src));
    assert.deepEqual(clipped,[],`${slug||'home'}/${width}: photo boxes stay inside their frames`);
    if(!slug){
     assert.equal(await page.locator('#products a.customize').count(),8);
     const heights=await page.locator('#products .art').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().height));assert.equal(new Set(heights.map(h=>Math.round(h))).size,1,'uniform photo containers');
     assert.equal(await page.locator('.hero .primary[href="#shop"]').count(),1);
    }else{
     assert.equal(await page.locator('body.nfc-product-page').count(),1);
     assert.ok(await page.locator('#addCart').evaluate(n=>n.getBoundingClientRect().height>=44));
     if(width<=600){const size=await page.locator('#f_Quantity').evaluate(n=>parseFloat(getComputedStyle(n).fontSize));assert.ok(size>=16,'mobile controls avoid input zoom');}
    }
    if(out){fs.mkdirSync(out,{recursive:true});await page.evaluate(async()=>{window.scrollTo(0,0);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});await page.screenshot({path:path.join(out,`${slug||'homepage'}-${width}.png`),fullPage:true});if(!slug){await page.screenshot({path:path.join(out,`homepage-hero-${width}.png`)});await page.locator('#shop').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,`homepage-catalog-${width}.png`)});}}
   }
   assert.deepEqual(errors,[]);await page.close();console.log(`${width}px: homepage and eight product pages passed; no clipping/overflow, broken photos or page errors`);
  }
 }finally{await browser?.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
