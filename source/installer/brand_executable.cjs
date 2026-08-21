'use strict';

const fs = require('node:fs');
const path = require('node:path');

const [inputPath, outputPath, iconPath, modulesPath] = process.argv.slice(2);
if (!inputPath || !outputPath || !iconPath) {
  throw new Error('Usage: node brand_executable.cjs INPUT.exe OUTPUT.exe ICON.ico [NODE_MODULES]');
}
const ResEdit = modulesPath
  ? require(path.join(path.resolve(modulesPath), '@shockpkg', 'resedit'))
  : require('@shockpkg/resedit');

const input = fs.readFileSync(inputPath);
const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(iconPath));
const icons = iconFile.icons.map(item => item.data);
const executable = ResEdit.NtExecutable.from(input, { ignoreCert: true });
const resources = ResEdit.NtExecutableResource.from(executable, true);
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries);

if (groups.length) {
  for (const group of groups) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(resources.entries, group.id, group.lang, icons);
  }
} else {
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(resources.entries, 1, 1049, icons);
}

resources.outputResource(executable);
fs.writeFileSync(outputPath, Buffer.from(executable.generate()));
