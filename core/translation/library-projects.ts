import {withDocumentStorageLock} from './document-storage-lock';

export const LIBRARY_PROJECTS_KEY='piLibraryProjectsV1';
export interface LibraryProject {name:string;updatedAt:number;deleted?:true}
export interface ProjectMembership {projects:string[];updatedAt:number}
export interface LibraryProjects {projects:Record<string,LibraryProject>;members:Record<string,ProjectMembership>}
const invalid=()=>new Error('项目资料无效，原资料未改变。');
export function normalizeLibraryProjects(value:unknown):LibraryProjects{
  if(value===undefined)return {projects:{},members:{}};
  if(!value||typeof value!=='object'||Array.isArray(value))throw invalid();
  const source=value as LibraryProjects,result:LibraryProjects={projects:{},members:{}};
  if(!source.projects||typeof source.projects!=='object'||Array.isArray(source.projects)||Object.keys(source.projects).length>200||!source.members||typeof source.members!=='object'||Array.isArray(source.members)||Object.keys(source.members).length>4000)throw invalid();
  for(const [id,item] of Object.entries(source.projects)){
    if(!/^[a-zA-Z0-9-]{1,80}$/u.test(id)||!item||typeof item.name!=='string'||!item.name.trim()||item.name!==item.name.trim()||item.name.length>80||!Number.isSafeInteger(item.updatedAt)||item.updatedAt<0||(item.deleted!==undefined&&item.deleted!==true))throw invalid();
    Object.defineProperty(result.projects,id,{value:{name:item.name,updatedAt:item.updatedAt,...(item.deleted?{deleted:true}:{})},enumerable:true,writable:true,configurable:true});
  }
  for(const [id,item] of Object.entries(source.members)){
    if(!id||id.length>9000||!item||!Number.isSafeInteger(item.updatedAt)||item.updatedAt<0||!Array.isArray(item.projects)||item.projects.length>50||new Set(item.projects).size!==item.projects.length||item.projects.some(project=>typeof project!=='string'||!Object.hasOwn(result.projects,project)))throw invalid();
    Object.defineProperty(result.members,id,{value:{projects:[...item.projects],updatedAt:item.updatedAt},enumerable:true,writable:true,configurable:true});
  }
  if(new TextEncoder().encode(JSON.stringify(result)).length>1_000_000)throw invalid();return result;
}
export function mergeLibraryProjects(local:unknown,incoming:unknown):LibraryProjects{
  const a=normalizeLibraryProjects(local),b=normalizeLibraryProjects(incoming);
  for(const key of ['projects','members'] as const)for(const [id,item] of Object.entries(b[key])){
    const map=a[key] as Record<string,LibraryProject|ProjectMembership>,old=map[id];
    if(old&&old.updatedAt===item.updatedAt&&JSON.stringify(old)!==JSON.stringify(item))throw new Error('项目资料存在同版本冲突，请保留两份备份。');
    if(!old||item.updatedAt>old.updatedAt)Object.defineProperty(map,id,{value:item,enumerable:true,writable:true,configurable:true});
  }
  return normalizeLibraryProjects(a);
}
export async function readLibraryProjects():Promise<LibraryProjects>{return normalizeLibraryProjects((await browser.storage.local.get(LIBRARY_PROJECTS_KEY))[LIBRARY_PROJECTS_KEY])}
export function changeLibraryProject(id:string,value:LibraryProject,expected:LibraryProject|undefined):Promise<void>{return withDocumentStorageLock(async()=>{
  const state=await readLibraryProjects();if(JSON.stringify(state.projects[id])!==JSON.stringify(expected))throw new Error('项目已在其他窗口变化，请重新核对。');
  Object.defineProperty(state.projects,id,{value,enumerable:true,writable:true,configurable:true});await browser.storage.local.set({[LIBRARY_PROJECTS_KEY]:normalizeLibraryProjects(state)});
})}
export function changeProjectMembership(id:string,projects:string[],expected:ProjectMembership|undefined):Promise<void>{return withDocumentStorageLock(async()=>{
  const state=await readLibraryProjects();if(JSON.stringify(state.members[id])!==JSON.stringify(expected))throw new Error('项目归属已在其他窗口变化，请重新核对。');
  if(projects.some(project=>!state.projects[project]||state.projects[project].deleted))throw new Error('项目已移除，请重新选择。');
  Object.defineProperty(state.members,id,{value:{projects:[...new Set(projects)],updatedAt:Math.max(Date.now(),(expected?.updatedAt??0)+1)},enumerable:true,writable:true,configurable:true});await browser.storage.local.set({[LIBRARY_PROJECTS_KEY]:normalizeLibraryProjects(state)});
})}
export function addDocumentToProject(id:string,projectId:string):Promise<string>{return withDocumentStorageLock(async()=>{
  const state=await readLibraryProjects(),project=state.projects[projectId];if(!project||project.deleted)throw new Error('项目已移除，请重新选择。');
  const old=state.members[id];if(old?.projects.includes(projectId))return project.name;
  Object.defineProperty(state.members,id,{value:{projects:[...(old?.projects??[]),projectId],updatedAt:Math.max(Date.now(),(old?.updatedAt??0)+1)},enumerable:true,writable:true,configurable:true});
  await browser.storage.local.set({[LIBRARY_PROJECTS_KEY]:normalizeLibraryProjects(state)});return project.name;
})}
