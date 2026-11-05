import {readFileSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const groups=JSON.parse(readFileSync(new URL('./e2e-suites.json',import.meta.url),'utf8'));
function specs(directory){return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?specs(path.join(directory,entry.name)):entry.name.endsWith('.spec.ts')?[path.relative(root,path.join(directory,entry.name)).replaceAll('\\','/')]:[])}
const actual=specs(path.join(root,'tests/e2e')).sort(),declared=[...groups.offline,...groups.optIn.map(item=>item.file)];
const unknown=actual.filter(name=>!declared.includes(name)),missing=declared.filter(name=>!actual.includes(name));
if(unknown.length||missing.length||new Set(declared).size!==declared.length||groups.optIn.some(item=>!item.reason)){
  console.error(JSON.stringify({message:'Every browser spec must belong to the offline suite or an explicitly documented opt-in group.',unknown,missing}));process.exit(1);
}
if(process.argv.includes('--check')){console.log(JSON.stringify({offline:groups.offline.length,optIn:groups.optIn.length,total:actual.length}));process.exit(0)}
const result=spawnSync(process.execPath,[path.join(root,'node_modules/@playwright/test/cli.js'),'test',...groups.offline,...process.argv.slice(2)],{cwd:root,stdio:'inherit',env:process.env});
if(result.error)throw result.error;
process.exit(result.status??1);
