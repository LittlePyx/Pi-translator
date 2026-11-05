import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {LIBRARY_PROJECTS_KEY,normalizeLibraryProjects,mergeLibraryProjects,readLibraryProjects,changeLibraryProject,changeProjectMembership,addDocumentToProject} from '../core/translation/library-projects';
import {exportDocumentLibraryBackup,previewDocumentLibraryBackup,importDocumentLibraryBackup} from '../core/translation/document-library-backup';

const local:Record<string,unknown>={};
beforeEach(()=>{for(const key of Object.keys(local))delete local[key];vi.stubGlobal('browser',{storage:{local:{get:vi.fn(async(keys:string|string[]|null)=>keys===null?structuredClone(local):Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(key=>key in local).map(key=>[key,structuredClone(local[key])]))),set:vi.fn(async values=>Object.assign(local,structuredClone(values))),remove:vi.fn(async key=>{delete local[key]})}}})});
afterEach(()=>vi.unstubAllGlobals());
it('adds a document to multiple projects and removes a project without removing its materials',async()=>{
  await changeLibraryProject('project-a',{name:'课题 A',updatedAt:1},undefined);await changeLibraryProject('project-b',{name:'课题 B',updatedAt:2},undefined);
  await addDocumentToProject('doc-1','project-a');await addDocumentToProject('doc-1','project-b');const before=await readLibraryProjects();expect(before.members['doc-1']?.projects).toEqual(['project-a','project-b']);
  await changeLibraryProject('project-a',{name:'课题 A',updatedAt:3,deleted:true},before.projects['project-a']);const after=await readLibraryProjects();expect(after.members['doc-1']).toEqual(before.members['doc-1']);expect(after.projects['project-a']?.deleted).toBe(true);
});
it('rejects stale membership and invalid projects without changing stored data',async()=>{
  await changeLibraryProject('one',{name:'One',updatedAt:1},undefined);await changeProjectMembership('doc',['one'],undefined);const before=structuredClone(local);
  await expect(changeProjectMembership('doc',[],undefined)).rejects.toThrow('其他窗口');await expect(addDocumentToProject('doc','missing')).rejects.toThrow('移除');expect(local).toEqual(before);
});
it('round trips projects and memberships in version 9 without losing old tags or materials',async()=>{
  local.piLibraryOrganizationV1={tags:{doc:{tags:['旧标签'],updatedAt:1}},views:{}};await changeLibraryProject('one',{name:'课题',updatedAt:1},undefined);await addDocumentToProject('doc','one');const before=structuredClone(local);
  const text=await exportDocumentLibraryBackup(),data=JSON.parse(text);expect(data.version).toBe(9);expect(data.libraryProjects.members.doc.projects).toEqual(['one']);
  const preview=await previewDocumentLibraryBackup(text);expect(local).toEqual(before);for(const key of Object.keys(local))delete local[key];await importDocumentLibraryBackup(text);expect((await readLibraryProjects()).members.doc?.projects).toEqual(['one']);expect((local.piLibraryOrganizationV1 as any).tags.doc.tags).toEqual(['旧标签']);
  expect(preview.token).toBeTruthy();
});
it('rejects contradictory same-version project records and malformed membership',()=>{
  const a={projects:{one:{name:'One',updatedAt:1}},members:{doc:{projects:['one'],updatedAt:1}}};
  expect(()=>mergeLibraryProjects(a,{...a,projects:{one:{name:'Different',updatedAt:1}}})).toThrow('冲突');
  expect(()=>normalizeLibraryProjects({projects:{},members:{doc:{projects:['missing'],updatedAt:1}}})).toThrow('无效');
});
it('rejects a stale backup preview after project membership changes',async()=>{
  await changeLibraryProject('one',{name:'One',updatedAt:1},undefined);const text=await exportDocumentLibraryBackup(),preview=await previewDocumentLibraryBackup(text);await addDocumentToProject('doc','one');const before=structuredClone(local);
  await expect(importDocumentLibraryBackup(text,preview.token)).rejects.toThrow('重新预览');expect(local).toEqual(before);expect(local[LIBRARY_PROJECTS_KEY]).toBeDefined();
});
it('preserves a saved project filter in backups and rejects it in an older format',async()=>{
  await changeLibraryProject('one',{name:'One',updatedAt:1},undefined);local.piLibraryOrganizationV1={tags:{},views:{v:{name:'课题筛选',query:'',kind:'all',tag:'',project:'one',updatedAt:1}}};
  const text=await exportDocumentLibraryBackup(),data=JSON.parse(text);expect(data.version).toBe(9);expect(data.libraryOrganization.views.v.project).toBe('one');
  const before=structuredClone(local);data.version=8;await expect(previewDocumentLibraryBackup(JSON.stringify(data))).rejects.toThrow('版本 9');expect(local).toEqual(before);
});
