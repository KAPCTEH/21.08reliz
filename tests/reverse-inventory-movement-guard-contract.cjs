'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const application=fs.readFileSync(path.join(root,'source/application/web/assets/js/00-app-bundle-v595.js'),'utf8');
const platform=fs.readFileSync(path.join(root,'source/application/web/assets/js/110-desktop-platform-v750.js'),'utf8');

assert.match(application,/function reverseInventoryMovement\(id\)\{/,'inventory reversal must accept the movement id');
assert.match(application,/reverseInventoryMovement\('\$\{m\.id\}'\)/,'the reversal control must pass the exact movement id');
assert.match(platform,/reverseInventoryMovement:'inventory\.stock'/,'inventory reversal must require inventory.stock');
assert.match(platform,/reverseInventoryMovement:\{kind:'inventory_movement_reverse',critical:false,target:args=>args\[0\]\}/,'inventory reversal must use the ordinary durable guard with the movement id as its target');

console.log(JSON.stringify({ok:true,permission:'inventory.stock',kind:'inventory_movement_reverse',target:'movement-id'}));
