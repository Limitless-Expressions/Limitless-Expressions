import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

test('only explicit neon hooks change the published main storefront', () => {
  // origin/main c49eb1f: undo only the authorized hooks, then compare the entire page.
  const original = readFileSync(new URL('../index.html',import.meta.url),'utf8')
    .replace(/\r\n/g,'\n')
    .replace('<link rel="stylesheet" href="assets/neon-configurator.css">\n<script src="assets/neon-configurator.js"></script>\n','')
    .replace("'Neon channel style','Font style'", "'Font style'")
    .replace("if(active.name==='Custom 3D Printed Neon Name Sign'&&['Neon channel style','Font style','Mounting preference'].includes(name))return NeonConfigurator.field(name);",'')
    .replace("NeonConfigurator.init(document.getElementById('form'));",'');
  const bytes=Buffer.from(original);
  assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),'c0c51741c604b42a06765ea3065f6101f66677e7');
});
