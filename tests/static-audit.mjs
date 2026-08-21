import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'acorn';
import * as walk from 'acorn-walk';
import { parse as parseHtml } from 'parse5';

const appRoot = path.resolve(process.argv[2]);
const webRoot = path.join(appRoot, 'web');

function filesUnder(root, predicate) {
  const result = [];
  const excludedDirectories = new Set(['node_modules', '.git', 'output', '__pycache__']);
  const visit = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && !excludedDirectories.has(entry.name)) visit(full);
      else if (predicate(full)) result.push(full);
    }
  };
  visit(root);
  return result.sort();
}

function relative(file) {
  return path.relative(appRoot, file).replaceAll(path.sep, '/');
}

function attr(node, name) {
  return node.attrs?.find(item => item.name === name)?.value ?? null;
}

function textContent(node) {
  if (node.nodeName === '#text') return node.value;
  return (node.childNodes || []).map(textContent).join('');
}

function walkHtml(node, visitor) {
  visitor(node);
  for (const child of node.childNodes || []) walkHtml(child, visitor);
  if (node.content) walkHtml(node.content, visitor);
}

const htmlFiles = filesUnder(appRoot, file => file.endsWith('.html'));
const jsFiles = filesUnder(appRoot, file => /\.(?:js|cjs)$/.test(file));
const htmlIds = new Map();
const duplicateHtmlIds = [];
const buttons = [];
const inlineScripts = [];
const scriptSources = [];
const invalidVoidClosingTags = [];

for (const file of htmlFiles) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/<\/(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\s*>/gi)) {
    invalidVoidClosingTags.push({
      file: relative(file),
      line: source.slice(0, match.index).split('\n').length,
      tag: match[1].toLowerCase()
    });
  }
  const document = parseHtml(source, { sourceCodeLocationInfo: true });
  const perFileIds = new Map();
  walkHtml(document, node => {
    const id = attr(node, 'id');
    if (id) {
      const item = {
        file: relative(file),
        line: node.sourceCodeLocation?.startLine ?? null,
        tag: node.tagName
      };
      if (perFileIds.has(id)) duplicateHtmlIds.push({ id, first: perFileIds.get(id), duplicate: item });
      else perFileIds.set(id, item);
      if (!htmlIds.has(id)) htmlIds.set(id, []);
      htmlIds.get(id).push(item);
    }
    if (node.tagName === 'button') {
      buttons.push({
        file: relative(file),
        line: node.sourceCodeLocation?.startLine ?? null,
        id,
        text: textContent(node).replace(/\s+/g, ' ').trim(),
        // Production markup uses inert data actions so CSP can keep
        // script-src-attr disabled. Retain the report field name for
        // compatibility with earlier audit artifacts.
        onclick: attr(node, 'data-jf-onclick') || attr(node, 'onclick')
      });
    }
    if (node.tagName === 'script') {
      const src = attr(node, 'src');
      if (src) {
        if (!/^(?:https?:|data:)/i.test(src)) {
          scriptSources.push({
            html: relative(file),
            src,
            resolved: relative(path.resolve(path.dirname(file), src)),
            exists: fs.existsSync(path.resolve(path.dirname(file), src))
          });
        }
      } else {
        const code = textContent(node);
        if (code.trim()) {
          inlineScripts.push({
            file: `${relative(file)}#inline-${inlineScripts.length + 1}`,
            source: code
          });
        }
      }
    }
  });
}

const parseErrors = [];
const declarations = new Map();
const references = new Map();
const literalIdReferences = [];
const listenerBindings = [];
const ipcMainChannels = new Map();
const ipcRendererChannels = new Map();

function add(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function scopedKey(scope, name) {
  return `${scope}\u0000${name}`;
}

function literalString(node) {
  return node?.type === 'Literal' && typeof node.value === 'string' ? node.value : null;
}

function memberName(node) {
  if (node?.type !== 'MemberExpression') return null;
  if (!node.computed && node.property.type === 'Identifier') return node.property.name;
  return literalString(node.property);
}

function location(file, node) {
  return { file, line: node.loc?.start.line ?? null };
}

function recordDeclaration(file, node, name, kind, scope) {
  if (!name) return;
  const item = { ...location(file, node), kind, scope };
  const key = scopedKey(scope, name);
  const existing = declarations.get(key) || [];
  if (!existing.some(value => value.file === item.file && value.line === item.line && value.kind === item.kind)) {
    add(declarations, key, item);
  }
}

function inspectAst(file, ast, scope) {
  for (const node of ast.body) {
    if (node.type === 'FunctionDeclaration') recordDeclaration(file, node, node.id?.name, 'function', scope);
    if (node.type === 'ClassDeclaration') recordDeclaration(file, node, node.id?.name, 'class', scope);
    if (node.type === 'VariableDeclaration') {
      for (const declaration of node.declarations) {
        if (declaration.id.type === 'Identifier') {
          recordDeclaration(file, declaration, declaration.id.name,
            ['FunctionExpression', 'ArrowFunctionExpression'].includes(declaration.init?.type) ? 'function-variable' : 'variable', scope);
        }
      }
    }
    if (node.type === 'ExpressionStatement' && node.expression.type === 'AssignmentExpression') {
      const left = node.expression.left;
      if (left.type === 'Identifier' &&
          ['FunctionExpression', 'ArrowFunctionExpression'].includes(node.expression.right.type)) {
        recordDeclaration(file, node, left.name, 'function-assignment', scope);
      }
      if (left.type === 'MemberExpression' && left.object.type === 'Identifier' &&
          left.object.name === 'window' && ['FunctionExpression', 'ArrowFunctionExpression'].includes(node.expression.right.type)) {
        recordDeclaration(file, node, memberName(left), 'window-function', scope);
      }
    }
  }

  walk.full(ast, node => {
    if (node.type === 'Identifier') add(references, scopedKey(scope, node.name), location(file, node));
    if (node.type === 'AssignmentExpression' &&
        node.left?.type === 'MemberExpression' &&
        node.left.object?.type === 'Identifier' &&
        node.left.object.name === 'window' &&
        ['FunctionExpression', 'ArrowFunctionExpression'].includes(node.right?.type)) {
      recordDeclaration(file, node, memberName(node.left), 'window-function', scope);
    }
    if (node.type !== 'CallExpression') return;
    const calleeName = memberName(node.callee);
    if (calleeName === 'getElementById') {
      const id = literalString(node.arguments[0]);
      if (id) literalIdReferences.push({ id, ...location(file, node), kind: 'getElementById' });
    }
    if (['querySelector', 'querySelectorAll'].includes(calleeName)) {
      const selector = literalString(node.arguments[0]);
      if (selector?.startsWith('#') && /^#[A-Za-z][\w:.-]*$/.test(selector)) {
        literalIdReferences.push({ id: selector.slice(1), ...location(file, node), kind: calleeName });
      }
    }
    if (calleeName === 'addEventListener' && literalString(node.arguments[0]) === 'click') {
      listenerBindings.push({ ...location(file, node), kind: 'addEventListener' });
    }
    if (node.callee.type === 'Identifier' && ['$','q','byId'].includes(node.callee.name)) {
      let id = literalString(node.arguments[0]);
      if (node.callee.name === 'q' && id?.startsWith('#')) id = id.slice(1);
      if (id && /^[A-Za-z][\w:.-]*$/.test(id)) {
        literalIdReferences.push({ id, ...location(file, node), kind: node.callee.name });
      }
    }
    if (node.callee.type === 'MemberExpression') {
      const objectName = node.callee.object?.name;
      const method = memberName(node.callee);
      const channel = literalString(node.arguments[0]);
      if (channel && objectName === 'ipcMain' && ['handle', 'on'].includes(method)) {
        add(ipcMainChannels, channel, { ...location(file, node), method });
      }
      if (channel && objectName === 'ipcRenderer' && ['invoke', 'send', 'on'].includes(method)) {
        add(ipcRendererChannels, channel, { ...location(file, node), method });
      }
    }
  });
}

const browserScopesByScript = new Map();
for (const item of scriptSources) {
  if (!item.exists || !item.resolved) continue;
  if (!browserScopesByScript.has(item.resolved)) browserScopesByScript.set(item.resolved, new Set());
  browserScopesByScript.get(item.resolved).add(`browser:${item.html}`);
}

for (const file of jsFiles) {
  const source = fs.readFileSync(file, 'utf8');
  try {
    const moduleSource = file.split(path.sep).includes('worker') && fs.existsSync(path.join(path.dirname(file), 'package.json'));
    const ast = parse(source, {
      ecmaVersion: 'latest',
      sourceType: moduleSource ? 'module' : 'script',
      allowHashBang: true,
      locations: true
    });
    const relativeFile = relative(file);
    const browserScopes = [...(browserScopesByScript.get(relativeFile) || [])];
    const scopes = browserScopes.length ? browserScopes : [`module:${relativeFile}`];
    for (const scope of scopes) inspectAst(relativeFile, ast, scope);
  } catch (error) {
    parseErrors.push({ file: relative(file), error: error.message });
  }
}

for (const item of inlineScripts) {
  try {
    const ast = parse(item.source, { ecmaVersion: 'latest', sourceType: 'script', locations: true });
    inspectAst(item.file, ast, `browser:${item.file.split('#')[0]}`);
  } catch (error) {
    parseErrors.push({ file: item.file, error: error.message });
  }
}

for (const button of buttons) {
  if (!button.onclick) continue;
  const match = button.onclick.match(/^\s*(?:return\s+)?([A-Za-z_$][\w$]*)\s*\(/);
  if (match) add(references, scopedKey(`browser:${button.file}`, match[1]), { file: button.file, line: button.line, kind: 'delegated-action' });
}

const allDuplicateGlobals = [...declarations]
  .filter(([key, items]) => key.startsWith('browser:') && items.length > 1)
  .map(([key, items]) => ({ name: key.slice(key.indexOf('\u0000') + 1), scope: items[0]?.scope, declarations: items }))
  .sort((a, b) => b.declarations.length - a.declarations.length || a.name.localeCompare(b.name));
const implementationSymbols = allDuplicateGlobals.filter(item => /__implV595$/.test(item.name));
const implementationOverrides = implementationSymbols
  .map(item => ({
    ...item,
    assignments: item.declarations.filter(declaration =>
      ['function-assignment', 'window-function'].includes(declaration.kind)
    ).length
  }))
  .filter(item => item.assignments > 1);
const implementationBindings = implementationSymbols
  .filter(item => item.declarations.filter(declaration =>
    ['function-assignment', 'window-function'].includes(declaration.kind)
  ).length === 1);
const duplicateGlobals = allDuplicateGlobals.filter(item => !/__implV595$/.test(item.name));

const possibleDeadGlobals = [...declarations]
  .filter(([key, items]) =>
    key.startsWith('browser:') &&
    items.some(item => item.kind.includes('function')) &&
    (references.get(key)?.length || 0) <= items.length)
  .map(([key, items]) => ({
    name: key.slice(key.indexOf('\u0000') + 1),
    scope: items[0]?.scope,
    declarations: items,
    referenceCount: references.get(key)?.length || 0
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

const missingLiteralIds = literalIdReferences
  .filter(ref => !htmlIds.has(ref.id))
  .sort((a, b) => a.id.localeCompare(b.id) || a.file.localeCompare(b.file) || a.line - b.line);

const missingInlineHandlers = buttons
  .filter(button => button.onclick)
  .map(button => {
    const names = [...button.onclick.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)].map(match => match[1]);
    return {
      ...button,
      missing: names.filter(name => !declarations.has(scopedKey(`browser:${button.file}`, name)) &&
        !['alert', 'confirm', 'prompt', 'open', 'close', 'print', 'stopPropagation', 'preventDefault',
          'getElementById', 'closest', 'removeAttribute'].includes(name))
    };
  })
  .filter(item => item.missing.length);

const duplicateButtonActions = [];
const byOnclick = new Map();
for (const button of buttons.filter(item => item.onclick)) add(byOnclick, button.onclick.trim(), button);
for (const [onclick, items] of byOnclick) {
  if (items.length > 1) duplicateButtonActions.push({ onclick, buttons: items });
}

const unhandledButtons = buttons.filter(button => button.id && !button.onclick &&
  !literalIdReferences.some(ref => ref.id === button.id));

const mainProcessSource = fs.readFileSync(path.join(appRoot, 'main.js'), 'utf8');
const mainContainsChannel = channel =>
  mainProcessSource.includes(`'${channel}'`) || mainProcessSource.includes(`"${channel}"`) ||
  mainProcessSource.includes(`\`${channel}\``);
const missingIpcMain = [...ipcRendererChannels]
  .filter(([channel]) => !ipcMainChannels.has(channel) && !mainContainsChannel(channel))
  .map(([channel, renderers]) => ({ channel, renderers }));
const unusedIpcMain = [...ipcMainChannels]
  .filter(([channel]) => !ipcRendererChannels.has(channel))
  .map(([channel, main]) => ({ channel, main }));
const missingScriptSources = scriptSources.filter(item => !item.exists);

const result = {
  generatedAt: new Date().toISOString(),
  root: appRoot,
  summary: {
    htmlFiles: htmlFiles.length,
    javascriptFiles: jsFiles.length,
    inlineScripts: inlineScripts.length,
    buttons: buttons.length,
    htmlIds: htmlIds.size,
    parseErrors: parseErrors.length,
    invalidVoidClosingTags: invalidVoidClosingTags.length,
    missingScriptSources: missingScriptSources.length,
    duplicateHtmlIds: duplicateHtmlIds.length,
    duplicateGlobals: duplicateGlobals.length,
    implementationBindings: implementationBindings.length,
    implementationOverrides: implementationOverrides.length,
    possibleDeadGlobals: possibleDeadGlobals.length,
    missingLiteralIds: missingLiteralIds.length,
    missingInlineHandlers: missingInlineHandlers.length,
    duplicateButtonActions: duplicateButtonActions.length,
    unhandledButtons: unhandledButtons.length,
    missingIpcMain: missingIpcMain.length,
    unusedIpcMain: unusedIpcMain.length
  },
  parseErrors,
  scriptSources,
  invalidVoidClosingTags,
  missingScriptSources,
  duplicateHtmlIds,
  duplicateGlobals,
  implementationBindings,
  implementationOverrides,
  possibleDeadGlobals,
  missingLiteralIds,
  missingInlineHandlers,
  duplicateButtonActions,
  unhandledButtons,
  ipc: {
    missingIpcMain,
    unusedIpcMain,
    main: Object.fromEntries(ipcMainChannels),
    renderer: Object.fromEntries(ipcRendererChannels)
  },
  buttons
};

process.stdout.write(JSON.stringify(result, null, 2));
