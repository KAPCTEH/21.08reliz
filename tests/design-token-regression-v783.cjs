const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const cssDir=path.join(root,'source/application/web/assets/css');
const index=fs.readFileSync(path.join(root,'source/application/web/index.html'),'utf8');
const tokens=fs.readFileSync(path.join(cssDir,'01-design-tokens-v783.css'),'utf8');
const base=fs.readFileSync(path.join(cssDir,'00-base.css'),'utf8');
const desktop=fs.readFileSync(path.join(cssDir,'110-desktop-platform-v750.css'),'utf8');
const premium=fs.readFileSync(path.join(cssDir,'120-premium-release-v783.css'),'utf8');

assert.match(index,/00-base\.css[^>]*>[\s\S]*01-design-tokens-v783\.css/);
assert.equal((tokens.match(/:root\s*\{/g)||[]).length,1);
assert(!desktop.includes(':root{'));
assert(!premium.includes(':root{'));

for(const token of [
  '--jf-color-brand-500',
  '--jf-color-canvas',
  '--jf-color-surface',
  '--jf-color-text',
  '--jf-color-line',
  '--jf-color-info',
  '--jf-color-warning',
  '--jf-color-danger',
  '--jf-radius-control',
  '--jf-radius-card',
  '--jf-radius-dialog',
  '--jf-shadow-control',
  '--jf-shadow-card',
  '--jf-shadow-dialog',
  '--jf-focus-ring',
  '--jf-motion-base',
]) assert(tokens.includes(`${token}:`),token);

for(const alias of ['--main:var(','--text:var(','--line:var(','--jf-emerald-950:var(','--jf-green:var(']){
  assert(tokens.includes(alias),alias);
}

for(const semanticUse of [
  'border-radius:var(--jf-radius-control)',
  'transition:var(--jf-motion-base)',
  'background:var(--jf-color-brand-500)',
  'border:1px solid var(--jf-color-line)',
  'border-radius:var(--jf-radius-card)',
  'box-shadow:var(--jf-shadow-card)',
  'box-shadow:var(--jf-focus-ring)',
]) assert(base.includes(semanticUse),semanticUse);

const files=fs.readdirSync(cssDir).filter(name=>name.endsWith('.css')).sort();
const css=files.map(name=>fs.readFileSync(path.join(cssDir,name),'utf8')).join('\n');
const componentCss=files
  .filter(name=>name!=='01-design-tokens-v783.css')
  .map(name=>fs.readFileSync(path.join(cssDir,name),'utf8'))
  .join('\n');
for(const [literal,token] of [
  ['#fff','--jf-color-surface'],
  ['#041813','--jf-color-brand-950'],
  ['#082c23','--jf-color-brand-900'],
  ['#0b4937','--jf-color-brand-800'],
  ['#0d684d','--jf-color-brand-700'],
  ['#10945c','--jf-color-brand-600'],
  ['#168a55','--jf-color-brand-500'],
  ['#20b66d','--jf-color-brand-400'],
  ['#68d999','--jf-color-brand-300'],
  ['#d5aa54','--jf-color-gold-500'],
  ['#efd28c','--jf-color-gold-300'],
  ['#edf4f0','--jf-color-canvas'],
  ['#ffffff','--jf-color-surface'],
  ['#f5f9f7','--jf-color-surface-soft'],
  ['#eef5f2','--jf-color-surface-muted'],
  ['#10241d','--jf-color-text'],
  ['#5c7067','--jf-color-text-soft'],
  ['#d5e2dc','--jf-color-line'],
  ['#1769aa','--jf-color-info'],
  ['#b76100','--jf-color-warning'],
  ['#b72b38','--jf-color-danger'],
]){
  assert(!new RegExp(`${literal}\\b`,'i').test(componentCss),`${literal} must use var(${token})`);
}
const unique=regex=>new Set([...css.matchAll(regex)].map(match=>match[0].toLowerCase())).size;
const metrics={
  files:files.length,
  important:(css.match(/!important/g)||[]).length,
  hexOccurrences:(css.match(/#[0-9a-f]{3,8}\b/gi)||[]).length,
  uniqueHex:unique(/#[0-9a-f]{3,8}\b/gi),
  uniqueRgb:unique(/rgba?\([^)]*\)/gi),
  uniqueFontSize:unique(/font-size\s*:\s*[^;}]+/gi),
  uniqueRadius:unique(/border-radius\s*:\s*[^;}]+/gi),
  uniqueShadow:unique(/box-shadow\s*:\s*[^;}]+/gi),
};

// Ratchet: existing debt may decrease, but a change must not add new literals.
assert(metrics.files<=24,JSON.stringify(metrics));
assert(metrics.important<=885,JSON.stringify(metrics));
assert(metrics.hexOccurrences<=1779,JSON.stringify(metrics));
assert(metrics.uniqueHex<=1191,JSON.stringify(metrics));
assert(metrics.uniqueRgb<=171,JSON.stringify(metrics));
assert(metrics.uniqueFontSize<=62,JSON.stringify(metrics));
assert(metrics.uniqueRadius<=52,JSON.stringify(metrics));
assert(metrics.uniqueShadow<=130,JSON.stringify(metrics));

console.log(JSON.stringify({ok:true,canonicalTokens:true,legacyAliases:true,coreComponentsMigrated:true,ratchet:metrics}));
