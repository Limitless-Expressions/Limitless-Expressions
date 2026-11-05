import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

const migration=name=>readFileSync(new URL('../backend/migrations/'+name,import.meta.url),'utf8');

test('alternate winner migration applies after giveaway foundation and is idempotent',()=>{
 const db=new DatabaseSync(':memory:');
 try {
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(migration('0004_giveaways.sql'));
  db.exec(migration('0005_giveaway_winner_rounds.sql'));
  db.exec(migration('0005_giveaway_winner_rounds.sql'));
  const now=Date.now();
  db.prepare('INSERT INTO giveaways(id,title,prize_description,prize_value_cents,status,opens_at,closes_at,created_at) VALUES (?,?,?,?,?,?,?,?)').run('001','Test','Chain',4000,'drawn',now-200000,now-100000,now-200000);
  db.prepare('INSERT INTO giveaway_entries(id,giveaway_id,email,email_hash,created_at) VALUES (?,?,?,?,?)').run('entry-1','001','test@example.com','hash-1',now-180000);
  const insert=db.prepare('INSERT INTO giveaway_winner_rounds(id,giveaway_id,round_number,entry_id,eligible_count,selected_at,selection_method,audit_hash) VALUES (?,?,?,?,?,?,?,?)');
  insert.run('round-1','001',1,'entry-1',1,now,'crypto','hash');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM giveaway_winner_rounds').get().n,1);
  assert.throws(()=>insert.run('round-2','001',1,'entry-1',1,now,'crypto','hash'),/UNIQUE/);
  assert.throws(()=>insert.run('round-3','001',2,'missing-entry',1,now,'crypto','hash'),/FOREIGN KEY/);
  assert.throws(()=>db.prepare("UPDATE giveaway_winner_rounds SET outcome='unknown' WHERE id='round-1'").run(),/CHECK/);
  assert.throws(()=>db.prepare("UPDATE giveaway_winner_rounds SET notified_at=? WHERE id='round-1'").run(now),/CHECK/);
 }finally{db.close();}
});
