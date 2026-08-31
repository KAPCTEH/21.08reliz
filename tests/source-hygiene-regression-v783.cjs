const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');

const root=path.resolve(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');
const forbidden=/(^|\/)(?:node_modules|bin|obj|__pycache__|\.wrangler|build|dist|output|stage|tmp|cache|generated)(?:\/|$)/i;
const ignore=read('.gitignore');
const packager=read('tools/package-owner-rc.ps1');

for(const rule of ['build/','**/node_modules/','**/bin/','**/obj/','**/__pycache__/','**/.wrangler/']){
  assert(ignore.includes(rule),`missing ignore rule ${rule}`);
}
assert(packager.includes('$sourceArchiveRelative = ([string]$manifest.source_archive.path).Trim()'));
assert(packager.includes('[IO.Path]::IsPathRooted($sourceArchiveRelative)'));
assert(packager.includes('$sourceArchiveInput = [IO.Path]::GetFullPath((Join-Path $output $sourceArchiveRelative))'));
assert(packager.includes('$sourceArchiveInput.StartsWith($outputPrefix, [StringComparison]::OrdinalIgnoreCase)'));
assert(packager.includes('$sourceArchiveHash = (Get-FileHash -LiteralPath $sourceArchiveInput -Algorithm SHA256).Hash.ToLowerInvariant()'));
assert(packager.includes('& git cat-file -e "$buildCommit^{commit}"'));
assert(packager.includes('Copy-Item -LiteralPath $sourceArchiveInput -Destination $sourceArchive -Force'));
assert(packager.includes("git status --porcelain --untracked-files=no"));

let paths=[];
if(fs.existsSync(path.join(root,'.git'))){
  paths=execFileSync('git',['ls-files'],{cwd:root,encoding:'utf8'}).split(/\r?\n/).filter(Boolean);
}else{
  const visit=directory=>{
    for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
      const full=path.join(directory,entry.name);
      const relative=path.relative(root,full).replaceAll(path.sep,'/');
      if(forbidden.test(relative))paths.push(relative);
      else if(entry.isDirectory())visit(full);
    }
  };
  visit(path.join(root,'source'));
}

assert.deepEqual(paths.filter(item=>forbidden.test(item)),[]);
console.log(JSON.stringify({ok:true,generatedFilesUntracked:true,archiveFromExactCommit:true,trackedFiles:paths.length}));
