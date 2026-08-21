const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');

const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'source/application/web/assets/js/03-icon-system-v783.js'),'utf8');
const index=fs.readFileSync(path.join(root,'source/application/web/index.html'),'utf8');

assert(index.includes('assets/js/03-icon-system-v783.js'));
assert(index.includes('assets/css/03-icon-system-v783.css'));

(async()=>{
  const dom=new JSDOM('<!doctype html><html><body><button>📦 Оформить</button><div>⚠️ Ошибка</div><textarea>📦 данные</textarea></body></html>',{
    runScripts:'outside-only',
    url:'file:///justfun/index.html'
  });
  dom.window.eval(source);
  dom.window.JustFunIcons.normalize(dom.window.document.body);

  assert.equal(dom.window.document.querySelectorAll('svg.jf-ui-icon').length,2);
  assert.equal(dom.window.document.querySelector('button').textContent.trim(),'Оформить');
  assert.equal(dom.window.document.querySelector('textarea').value,'📦 данные');

  const dynamic=dom.window.document.createElement('div');
  dynamic.textContent='🚚 Рейс в пути';
  dom.window.document.body.append(dynamic);
  await Promise.resolve();
  await Promise.resolve();
  assert(dynamic.querySelector('svg.jf-ui-icon'));
  assert.equal(dynamic.textContent.trim(),'Рейс в пути');

  for(const svg of dom.window.document.querySelectorAll('svg.jf-ui-icon')){
    assert.equal(svg.getAttribute('aria-hidden'),'true');
    assert.equal(svg.getAttribute('focusable'),'false');
    assert(svg.querySelector('path,circle,rect'));
  }

  console.log(JSON.stringify({ok:true,localSvgIcons:true,dynamicNormalizer:true,editableTextPreserved:true}));
})().catch(error=>{
  console.error(error);
  process.exitCode=1;
});
