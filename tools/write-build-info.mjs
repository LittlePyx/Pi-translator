import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
async function files(dir) {
  const result=[];
  for(const entry of await readdir(path.join(root,dir),{withFileTypes:true})) {
    const name=path.posix.join(dir,entry.name);
    if(entry.isDirectory()) result.push(...await files(name));
    else if(entry.isFile() && name!=='public/build-info.json') result.push(name);
  }
  return result;
}
const hash=createHash('sha256');
const sources=[...(await files('core')), ...(await files('entrypoints')), ...(await files('ui')),
  ...(await files('public')), 'package.json','package-lock.json','wxt.config.ts', 'tools/write-build-info.mjs'];
for(const name of sources.sort()) {
  const bytes=await readFile(path.join(root,name));
  hash.update(name).update('\0').update(String(bytes.length)).update('\0').update(bytes);
}
let commit;
try {commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();} catch { /* Archives need no Git installation. */ }
const info={schemaVersion:1,buildId:hash.digest('hex'),builtAt:new Date().toISOString(),
  ...(commit?{commit}:{}),version:JSON.parse(await readFile('package.json','utf8')).version};
await writeFile('public/build-info.json',JSON.stringify(info,null,2)+'\n');
console.log(`Build ${info.buildId.slice(0,12)} (${info.version})`);
