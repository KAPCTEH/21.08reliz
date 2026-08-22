#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import * as asar from '../source/desktop-runtime/node_modules/@electron/asar/lib/asar.js';

const payload = path.resolve(process.argv[2] || '');
const archive = path.join(payload, 'resources', 'app.asar');
const helper = path.join(payload, 'JustFun-UpdateHelper.exe');
const failures = [];
function assert(condition, message) { if (!condition) failures.push(message); }
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

assert(fs.existsSync(archive) && fs.statSync(archive).isFile(), 'protected app.asar is missing');
assert(fs.existsSync(helper) && fs.statSync(helper).isFile(), 'payload Update Helper is missing');
let identity = null;
if (!failures.length) {
  try { identity = JSON.parse(asar.extractFile(archive, 'update/helper-identity.json').toString('utf8')); }
  catch (error) { failures.push(`protected helper identity cannot be read: ${error.message}`); }
}
assert(identity?.schema_version === 1, 'protected helper identity schema is invalid');
assert(identity?.file_name === 'JustFun-UpdateHelper.exe', 'protected helper file name is invalid');
if (fs.existsSync(helper)) {
  assert(identity?.bytes === fs.statSync(helper).size, 'protected helper byte count differs from payload');
  assert(identity?.sha256 === sha256(helper), 'protected helper SHA-256 differs from payload');
  assert(fs.readFileSync(helper).subarray(0, 2).toString('ascii') === 'MZ', 'payload helper is not a Windows PE executable');
}

const result = { schema_version: 1, helper: identity?.file_name || null, bytes: identity?.bytes || null, sha256: identity?.sha256 || null, failures, passed: failures.length === 0 };
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (failures.length) process.exitCode = 1;
