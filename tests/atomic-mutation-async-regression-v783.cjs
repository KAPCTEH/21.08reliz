'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'..','source','application','web','assets','js','99-stability-v595.js'),'utf8');
const start=source.indexOf('function atomicMutation(kind,action)');
const end=source.indexOf('\nwindow.commitRouteClosure',start);
assert(start>=0&&end>start,'atomicMutation не найден');

const classes=new Set();
const journal=[];
const alerts=[];
const context={
  activeTransaction:null,
  state:{value:1},
  runtimeCriticalError(){return ''},
  writeJournal(kind,status='started'){journal.push([kind,status])},
  clearJournal(){journal.push(['clear'])},
  renderAll(){},
  console:{error(){}},
  document:{documentElement:{classList:{add:value=>classes.add(value),remove:value=>classes.delete(value)}}},
  window:{alert:value=>alerts.push(String(value))},
  Promise,
  Error,
};
context.takeMemorySnapshot=()=>({value:context.state.value});
context.takeRawStorageSnapshot=()=>({value:context.state.value});
context.restoreMemorySnapshot=snapshot=>{context.state.value=snapshot.value};
context.restoreRawStorageSnapshot=()=>{};
vm.createContext(context);
vm.runInContext(`${source.slice(start,end)}\nthis.atomicMutation=atomicMutation;`,context);

(async()=>{
  const pending=context.atomicMutation('async-success',async()=>{await Promise.resolve();context.state.value=2;return 'done'});
  assert.equal(classes.has('v595-transaction-lock'),true,'транзакция снята до завершения Promise');
  assert.equal(await pending,'done');
  assert.equal(context.state.value,2);
  assert.equal(classes.has('v595-transaction-lock'),false);

  context.state.value=3;
  const failed=context.atomicMutation('async-failure',async()=>{context.state.value=4;throw new Error('failure')});
  assert.equal(await failed,false);
  assert.equal(context.state.value,3,'состояние не восстановлено после отклонённого Promise');
  assert.equal(classes.has('v595-transaction-lock'),false);
  assert.equal(alerts.length,1);
  assert(journal.some(([,status])=>status==='committed'));
  process.stdout.write(`${JSON.stringify({ok:true,asyncCommit:true,asyncRollback:true,lockLifetime:true})}\n`);
})().catch(error=>{console.error(error);process.exitCode=1});
