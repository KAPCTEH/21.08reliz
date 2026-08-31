'use strict';

const assert=require('node:assert/strict');
const outbox=require('../source/application/web/assets/js/05-local-outbox-v783.js');

function memoryStorage(seed={}){
  const values=new Map(Object.entries(seed));
  return{values,getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,String(value))};
}
function command(commandId='client:one'){
  return{
    commandId,companyId:'company-1',warehouseId:'warehouse-1',environment:'live',authorUserId:'user-1',deviceId:'device-1',
    changes:[{type:'orders',id:'order-1',baseVersion:4,deleted:false,payload:{id:'order-1',warehouseId:'warehouse-1',number:'001'},_fingerprint:'fp-1'}],
  };
}

{
  const storage=memoryStorage(),queue=outbox.create(storage,'company-1:live:warehouse-1');
  const saved=queue.enqueue(command());
  assert.equal(saved.state,'pending');
  assert.equal(queue.status().pending,1);
  assert.equal(queue.pendingOffset('orders','order-1'),1);
  assert.equal(queue.ready()?.commandId,'client:one');
  queue.markSending('client:one');
  assert.equal(queue.get('client:one').attempts,1);

  const afterRestart=outbox.create(storage,'company-1:live:warehouse-1');
  assert.equal(afterRestart.get('client:one').state,'pending','restart must recover an interrupted send');
  assert.equal(afterRestart.get('client:one').commandId,'client:one','restart retry must preserve command_id');
  assert.equal(afterRestart.get('client:one').attempts,1);

  afterRestart.markConflict('client:one',{code:'entity_version_conflict'});
  assert.deepEqual([...afterRestart.blockedEntityKeys()],['orders:order-1']);
  assert.equal(afterRestart.overlayEntries().length,1,'conflicting local intent must survive server bootstrap');
}

{
  const storage=memoryStorage(),first=outbox.create(storage,'company-1:live:warehouse-1');
  first.enqueue(command('client:stable'));
  assert.equal(first.enqueue(command('client:stable')).commandId,'client:stable','idempotent enqueue may reuse the exact command');
  assert.throws(()=>first.enqueue({...command('client:stable'),changes:[{...command().changes[0],payload:{id:'order-1',number:'different'}}]}),error=>error.code==='OUTBOX_COMMAND_COLLISION');
  first.markRejected('client:stable',{code:'permission_denied'},false);
  assert.equal(first.overlayEntries().length,0,'an immediately rolled-back rejection must not be overlaid');
}

{
  const storage=memoryStorage(),scope='company-1:live:warehouse-1',key=outbox.storageKey(scope);
  storage.values.set(key,'{broken json');
  const queue=outbox.create(storage,scope);
  assert.equal(queue.isCorrupt(),true);
  assert.throws(()=>queue.enqueue(command()),error=>error.code==='OUTBOX_CORRUPT','corrupt data must never be silently overwritten');
}

{
  const storage=memoryStorage(),queue=outbox.create(storage,'company-1:live:warehouse-1',{maxActive:1});
  queue.enqueue(command('client:first'));
  assert.throws(()=>queue.enqueue({...command('client:second'),changes:[{...command().changes[0],id:'order-2'}]}),error=>error.code==='OUTBOX_ACTIVE_LIMIT');
  assert.notEqual(outbox.storageKey('company-1:live:warehouse-1'),outbox.storageKey('company-1:live:warehouse-2'),'warehouse queues must be isolated');
}

process.stdout.write(`${JSON.stringify({ok:true,durableRestart:true,stableCommandId:true,scopeIsolation:true,corruptionFailClosed:true,conflictOverlay:true})}\n`);
