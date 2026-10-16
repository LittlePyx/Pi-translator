/** Offline review of recorded actual model replies. Never loads credentials or
 * calls a provider. Recognition-based findings do not prove PDF crop coverage. */
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseImageTranslation } from '../core/translation/openai-compatible-translator';
import { pdfTranslationProseIssues } from '../core/pdf/translation-completeness';
import { formulaDocumentIssues, formulaDocumentText } from '../core/translation/formula-document';
import { reconcileImageFormulaResult, validateImageFormulaResult, validateImageFigureResult } from '../core/translation/formula-output-validation';
import { readLocalPdfLayout } from '../tests/support/local-pdf-layout';
import { pdfDocumentTranslationSessionBlockSignature, pdfDocumentTranslationSessionBehaviorKey } from '../core/pdf/document-translation-session';

const cnp = 'output/pdf/live-workflow-2026-10-15';
const hatnet = 'output/pdf/formula-reliability-2026-10-14';
const destination = process.env.PI_RELIABILITY_AUDIT_OUTPUT ?? 'output/pdf/reliability-audit-2026-10-15';
const load = async (file: string) => JSON.parse(await readFile(file, 'utf8'));
async function files(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => entry.isDirectory() ? files(path.join(root, entry.name)) : [path.join(root, entry.name)]));
  return nested.flat();
}
function contentFromReply(body: string): { content: string; finish: string[] } {
  if (body.trim().startsWith('{')) {
    const value = JSON.parse(body).choices?.[0];
    return { content: value?.message?.content ?? '', finish: [value?.finish_reason].filter(Boolean) };
  }
  let content = ''; const finish: string[] = [];
  for (const line of body.split('\n')) {
    if (!line.startsWith('data:') || line.slice(5).trim() === '[DONE]') continue;
    const choice = JSON.parse(line.slice(5)).choices?.[0];
    content += choice?.delta?.content ?? choice?.message?.content ?? '';
    if (choice?.finish_reason) finish.push(choice.finish_reason);
  }
  return { content, finish };
}
const records: Array<Record<string, unknown>> = [];
function audit(content: string, provenance: Record<string, unknown>, finish: string[]) {
  try {
    const parsed = parseImageTranslation(content);
    const result = parsed.formulaDocument ? parsed : reconcileImageFormulaResult(parsed);
    const mathIssues = result.formulaDocument ? formulaDocumentIssues(result.formulaDocument)
      : /^Figure\s+\d+[.:]/iu.test(result.recognizedText) ? validateImageFigureResult(result).issues : validateImageFormulaResult(result).issues;
    const proseIssues = pdfTranslationProseIssues(result.recognizedText, result.translatedText, 'zh-CN');
    records.push({ ...provenance, finish, proseIssues, mathIssues, modelUncertainty: result.uncertainSpans,
      sourcePreview: result.recognizedText.slice(0, 180), targetPreview: result.translatedText.slice(0, 180) });
  } catch (error) { records.push({ ...provenance, finish, parseError: (error as Error).message }); }
}
for (const stage of ['actual-first', 'actual-v2', 'actual-v3', 'actual-final', 'actual-accepted']) {
  for (const file of (await files(path.join(cnp, stage))).filter(file => file.endsWith('actual-workflow-report.json'))) {
    const report = await load(file);
    for (const reply of report.replies) {
      const decoded = contentFromReply(reply.body);
      audit(decoded.content, { paper: 'CNP', stage, file, replyId: reply.id, http: reply.status }, decoded.finish);
    }
  }
}
for (const file of (await files(hatnet)).filter(file => file.endsWith('parsed-replies.json'))) {
  const replies = await load(file);
  replies.forEach((reply: any, index: number) => {
    if (reply.record) audit(JSON.stringify(reply.record), { paper: 'HATNet', file, replyId: index + 1, blockId: reply.block,
      http: reply.http ?? 'see original raw response' }, [reply.finish].filter(Boolean));
  });
}

// Exact final CNP PDF-source scopes and signatures, not model recognition alone.
const source = await load(`${cnp}/prepared-source.json`);
const checkpoint = await load(`${cnp}/final-artifacts/pdf-actual-export-review-r-fc727-ions-and-mathematical-fonts/proofread-checkpoint.json`);
const session = checkpoint.sessions[0];
if (session.documentSignatures.length !== source.blocks.length) throw new Error('Final PDF scope mismatch');
const saved = new Map<string, any>(session.blocks.map((block: any) => [block.signature, block]));
function sourceSignatures(blocks: Array<{ pageNumber: number; text: string }>) {
  const occurrences = new Map<string, number>();
  return blocks.map(block => {
    const key = `${block.pageNumber}\u0000${block.text}`, occurrence = occurrences.get(key) ?? 0;
    occurrences.set(key, occurrence + 1);
    return pdfDocumentTranslationSessionBlockSignature(block.pageNumber, block.text, occurrence);
  });
}
if (sourceSignatures(source.blocks).some((signature, index) => signature !== session.documentSignatures[index])) throw new Error('Final CNP PDF source signature mismatch');
const finalSourceReview = source.blocks.flatMap((block: any, index: number) => {
  const translated = saved.get(session.documentSignatures[index]);
  if (!translated) return [];
  const text = translated.formulaDocument ? formulaDocumentText(translated.formulaDocument) : translated.translatedText;
  return [{ blockId: block.id, kind: block.kind ?? 'text', sourceRegions: block.sourceRegions ?? [block.sourceAnchor],
    proseIssues: pdfTranslationProseIssues(block.text, text, session.targetLanguage),
    savedReview: translated.formulaReviewMessage ?? translated.visualFallbackMessage,
    sourcePreview: block.text.slice(0, 180), targetPreview: text.slice(0, 180) }];
});
const byPaper = Object.fromEntries(['CNP', 'HATNet'].map(paper => {
  const rows = records.filter(row => row.paper === paper);
  return [paper, { actualRepliesReplayed: rows.length, parseErrors: rows.filter(row => row.parseError).length,
    proseFindings: rows.filter(row => (row.proseIssues as string[] | undefined)?.length).length,
    mathFindings: rows.filter(row => (row.mathIssues as string[] | undefined)?.length).length,
    unfinished: rows.filter(row => (row.finish as string[]).some(reason => reason !== 'stop')).length }];
}));
let finalHatnetSourceReview: Array<{ blockId: string; proseIssues: string[]; savedReview?: string;
  sourcePreview: string; targetPreview: string }> | undefined = undefined;
let finalHatnetChangedSources: Array<Record<string, unknown>> | undefined = undefined;
const equivalentScopes: Array<Record<string, unknown>> = [];
if (process.env.PI_PDF_REGRESSION_SOURCE) {
  const prepared = await readLocalPdfLayout(process.env.PI_PDF_REGRESSION_SOURCE);
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, 'hatnet-current-source.json'), JSON.stringify(prepared, null, 2));
  const recorded = await load(`${hatnet}/completed-continuation-snapshot.json`);
  const snapshot = recorded.sessions[0];
  if (snapshot.documentSignatures.length !== prepared.blocks.length) throw new Error('Final HATNet PDF scope mismatch');
  const currentSignatures = sourceSignatures(prepared.blocks);
  finalHatnetChangedSources = prepared.blocks.flatMap((block, index) => currentSignatures[index] !== snapshot.documentSignatures[index]
    ? [{ blockId: block.id, kind: block.kind, sourcePreview: block.text.slice(0, 350), previousSignature: snapshot.documentSignatures[index], currentSignature: currentSignatures[index] }] : []);
  const bySignature = new Map<string, any>(snapshot.blocks.map((block: any) => [block.signature, block]));
  const earlierSource = await load(`${hatnet}/source-before-continuation.json`);
  const remapped = new Map<string, string>();
  for (const [index, block] of prepared.blocks.entries()) {
    const previousSignature = snapshot.documentSignatures[index];
    if (currentSignatures[index] === previousSignature) continue;
    const previous = earlierSource.blocks.find((candidate: any) => pdfDocumentTranslationSessionBlockSignature(candidate.pageNumber, candidate.text, 0) === previousSignature);
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    const proof = { blockId: block.id, previousSignature, currentSignature: currentSignatures[index],
      whitespaceOnly: Boolean(previous && previous.text.replace(/\s/gu, '') === block.text.replace(/\s/gu, '')),
      sameAnchor: Boolean(previous && same(previous.sourceAnchor, block.sourceAnchor)),
      sameRegions: Boolean(previous && same(previous.sourceRegions, block.sourceRegions)),
      sameEquations: Boolean(previous && same(previous.sourceEquations, block.sourceEquations)) };
    equivalentScopes.push(proof);
    if (proof.whitespaceOnly && proof.sameAnchor && proof.sameRegions && proof.sameEquations) remapped.set(previousSignature, currentSignatures[index]!);
  }
  if (remapped.size === finalHatnetChangedSources.length) {
    // Acceptance fixture only. Production user history and original evidence
    // remain untouched; every source change is explicitly proved above.
    await writeFile(path.join(destination, 'hatnet-equivalent-acceptance-checkpoint.json'), JSON.stringify({ ...recorded,
      provenance: 'Offline acceptance fixture: original actual translations; one proven whitespace-only source identity update, no model calls or production-history rewrite.',
      changes: [...(Array.isArray(recorded.changes) ? recorded.changes : [recorded.changes].filter(Boolean)), ...equivalentScopes],
      sessions: [{ ...snapshot, documentSignatures: currentSignatures,
        behaviorKey: pdfDocumentTranslationSessionBehaviorKey(['pdf-semantic-visual-objects-v10', 'unified-vision',
          'default', recorded.model, 'vision-e2e', recorded.model].join('\n')),
        blocks: snapshot.blocks.map((block: any) => ({ ...block, signature: remapped.get(block.signature) ?? block.signature })) }],
    }, null, 2));
  }
  finalHatnetSourceReview = prepared.blocks.flatMap((block, index) => {
    const saved = bySignature.get(currentSignatures[index]!); if (!saved) return [];
    const text = saved.formulaDocument ? formulaDocumentText(saved.formulaDocument) : saved.translatedText;
    return [{ blockId: block.id, proseIssues: pdfTranslationProseIssues(block.text, text, snapshot.targetLanguage),
      savedReview: saved.formulaReviewMessage ?? saved.visualFallbackMessage,
      sourcePreview: block.text.slice(0, 180), targetPreview: text.slice(0, 180) }];
  });
}
const report = { evidence: 'Offline analysis of saved actual replies; zero new model calls. Raw math findings include exact-recovery candidates and superseded source scopes; they are not final unresolved counts.',
  byPaper, finalCnpSourceBlocks: source.blocks.length, finalCnpSavedBlocks: finalSourceReview.length,
  finalCnpProseFindings: finalSourceReview.filter((row: any) => row.proseIssues.length), finalSourceReview,
  finalHatnetSourceReview, finalHatnetChangedSources, equivalentScopes, rawReplies: records };
await mkdir(destination, { recursive: true });
await writeFile(path.join(destination, 'recorded-response-audit.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ byPaper, finalCnpSourceBlocks: report.finalCnpSourceBlocks, finalCnpSavedBlocks: report.finalCnpSavedBlocks,
  finalCnpProseFindings: report.finalCnpProseFindings,
  finalHatnetSavedBlocks: finalHatnetSourceReview?.length,
  finalHatnetProseFindings: finalHatnetSourceReview?.filter(row => row.proseIssues.length),
  finalHatnetChangedSources,
  equivalentScopes,
  rawProseFindings: records.filter(row => (row.proseIssues as string[] | undefined)?.length).map(({ paper, stage, replyId, blockId, proseIssues, sourcePreview, targetPreview }) =>
    ({ paper, stage, replyId, blockId, proseIssues, sourcePreview, targetPreview })) }, null, 2));
