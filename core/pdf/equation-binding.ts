import { isFormulaDocument, type FormulaDocument } from '../translation/formula-document';
import { normalizeFormula, structuralIssues } from '../translation/formula-output-validation';
import { validSourceEquations, type SourceEquation } from '../translation/source-equations';

// Only a simple outer equation group is splittable. Nested arrays, conditions,
// tags and optional row spacing require richer source evidence; never guess.
function independentRows(latex: string): string[] | undefined {
  const body = latex.trim().replace(/^\\left\s*\\?\{\s*/u, '').replace(/\s*\\right\s*\.$/u, '');
  const match = /^\\begin\{(cases|aligned|gathered)\}([\s\S]*)\\end\{\1\}$/u.exec(body);
  if (!match || /\\(?:begin|end|tag)\b/u.test(match[2]!)) return;
  const rows = match[2]!.split('\\\\').map((row) => row.replace(/&/gu, '').trim());
  if (rows.length < 2 || rows.some((row) => !row || row.startsWith('[') || structuralIssues(row).length)) return;
  return rows;
}

// This identifies a row, not the correctness of its RHS. Restrict to simple
// Latin left-hand variables and require a unique bijection within the group.
function rowIdentity(text: string): string | undefined {
  const equals = text.indexOf('=');
  if (equals < 0) return;
  // Font commands qualify a variable, not its row number. Strip only simple
  // wrappers for the identity comparison; keep the actual expression intact.
  const variable = text.slice(0, equals).replace(/\\(?:mathbf|boldsymbol|mathit|mathrm|mathsf)\s*\{([A-Za-z])\}/gu, '$1');
  const key = variable.replace(/[\s_{}^⎧⎨⎩⎪]/gu, '');
  return /^[A-Za-z][A-Za-z0-9]{1,12}$/u.test(key) ? key : undefined;
}

/** Some TeX extension fonts decode a large brace as "(" and omit its ink
 * bounds. With an explicit row claim, use adjacent local labels in one column
 * and a unique bijection of row identities; never formula counts alone. */
function adjacentIndependentGroup(sources: readonly SourceEquation[], source: SourceEquation, rows: readonly string[]): SourceEquation[] | undefined {
  const position = (entry: SourceEquation) => /^eq-p(\d+)-x(\d+)-y(\d+)$/u.exec(entry.id)!.slice(1).map(Number);
  const [page, x] = position(source);
  const column = sources.filter(entry => {const [p, left] = position(entry); return p === page && Math.abs(left! - x!) <= 1500})
    .sort((a, b) => position(a)[2]! - position(b)[2]!);
  const keys = rows.map(rowIdentity);
  const candidates = column.flatMap((_, index) => {
    const members = column.slice(index, index + rows.length);
    if (members.length !== rows.length || !members.includes(source) || members.some(entry => entry.groupId || entry.rowCount)) return [];
    const localKeys = members.map(entry => rowIdentity(entry.rowHint));
    return localKeys.every(Boolean) && new Set(localKeys).size === rows.length && keys.every(key => key && localKeys.includes(key)) &&
      members.slice(1).every((entry, i) => position(entry)[2]! - position(members[i]!)[2]! <= 4000) ? [members] : [];
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

/** Resolve identity, never array position. Existing unique tags are accepted
 * for compatibility. A row identity only establishes numbering, not symbols. */
export function bindPdfEquationNumbers(doc: FormulaDocument, sources: readonly SourceEquation[] | undefined): FormulaDocument {
  if (!sources || !validSourceEquations(sources)) return doc;
  const result: FormulaDocument = { ...doc, issues: [...doc.issues], formulas: doc.formulas.map((entry) => ({ ...entry })) };
  for (const entry of result.formulas) {
    const tags = [...entry.latex.matchAll(/\\tag\*?\s*\{(\d{1,4}[a-z]?)\}/giu)].map(match => match[1]!);
    const source = entry.sourceEquationId ? sources.find(candidate => candidate.id === entry.sourceEquationId)
      : tags.length === 1 ? sources.find(candidate => candidate.number === tags[0]) : undefined;
    const rows = independentRows(entry.latex.replace(/\\tag\*?\s*\{\d{1,4}[a-z]?\}/giu, ''));
    if (!source || source.rowCount || !rows) continue;
    const members = source.groupId ? sources.filter(candidate => candidate.groupId === source.groupId) : adjacentIndependentGroup(sources, source, rows);
    if (!members) continue;
    if (members.length < 2) continue;
    const keys = members.map((member) => rowIdentity(member.rowHint));
    const rowKeys = rows.map(rowIdentity);
    const uniqueReference = [result.sourceTemplate, result.translationTemplate]
      .every((template) => template.split(`{{${entry.id}}}`).length === 2);
    const safe = entry.display && !entry.review && uniqueReference && rows.length === members.length &&
      tags.length <= 1 && tags.every(tag => tag === source.number) &&
      keys.every(Boolean) && new Set(keys).size === keys.length &&
      rowKeys.every((key) => key && keys.includes(key)) && new Set(rowKeys).size === rows.length &&
      !result.formulas.some((other) => other !== entry && members.some((member) => member.id === other.sourceEquationId));
    if (!safe) {
      result.issues.push(`${entry.id}: 独立编号公式被合组，无法可靠逐行对应，请对照原图`);
      delete entry.sourceEquationId;
      continue;
    }
    const available = Array.from({ length: 999 }, (_, i) => `m${i + 1}`)
      .filter((id) => !result.formulas.some((formula) => formula.id === id) &&
        !result.sourceTemplate.includes(`{{${id}}}`) && !result.translationTemplate.includes(`{{${id}}}`));
    if (available.length < rows.length - 1 || result.formulas.length + rows.length - 1 > 96) continue;
    const split = rows.map((latex, index) => ({ ...entry, id: index ? available[index - 1]! : entry.id,
      latex, sourceEquationId: members[keys.indexOf(rowKeys[index])]!.id }));
    const refs = split.map((formula) => `{{${formula.id}}}`).join('\n');
    const candidate = { ...result,
      sourceTemplate: result.sourceTemplate.replace(`{{${entry.id}}}`, refs),
      translationTemplate: result.translationTemplate.replace(`{{${entry.id}}}`, refs),
      formulas: result.formulas.flatMap((formula) => formula === entry ? split : [formula]) };
    const groupedSources = source.groupId ? sources : sources.map(row => members.includes(row) ? {...row, groupId: members[0]!.id} : row);
    if (isFormulaDocument(candidate)) return bindPdfEquationNumbers(candidate, groupedSources);
  }
  const claims = result.formulas.map((entry) => {
    const tags = [...entry.latex.matchAll(/\\tag\*?\s*\{(\d{1,4}[a-z]?)\}/giu)].map((m) => m[1]!);
    const candidates = entry.sourceEquationId ? sources.filter((s) => s.id === entry.sourceEquationId)
      : tags.length === 1 ? sources.filter((s) => s.number === tags[0]) : [];
    return { entry, tags, source: candidates.length === 1 ? candidates[0] : undefined };
  });
  // A locally observed multirow equation may be transcribed as one item per
  // row. Join only adjacent, distinct rows in the same source/translation order.
  // Single-row collisions, repeated formulas and ambiguous layouts still fail.
  for (const source of sources) {
    if (!source.rowCount) continue;
    const members = claims.filter((claim) => claim.source?.id === source.id)
      .sort((a, b) => result.sourceTemplate.indexOf(`{{${a.entry.id}}}`) - result.sourceTemplate.indexOf(`{{${b.entry.id}}}`));
    if (members.length !== source.rowCount || members.some(({ entry, tags }) => !entry.display || entry.review ||
      structuralIssues(entry.latex).length || /\\begin\b|\\\\|&/u.test(entry.latex) ||
      tags.length > 1 || tags.some((tag) => tag !== source.number))) continue;
    const rows = members.map(({ entry }) => entry.latex.replace(/\\tag\*?\s*\{\d{1,4}[a-z]?\}/giu, '').trim());
    if (new Set(rows.map((row) => normalizeFormula(row).replace(/[,.;]+$/u, ''))).size !== rows.length) continue;
    const ids = members.map(({ entry }) => entry.id);
    const adjacent = new RegExp(ids.map((id) => `\\{\\{${id}\\}\\}`).join('\\s*'), 'u');
    if (![result.sourceTemplate, result.translationTemplate].every((template) => adjacent.test(template) &&
      ids.every((id) => template.split(`{{${id}}}`).length === 2))) continue;
    const first = members[0]!.entry;
    const combined = `\\begin{gathered}${rows.join('\\\\')}\\end{gathered}`;
    if (combined.length > 2048 || structuralIssues(combined).length) continue;
    first.latex = combined;
    first.sourceEquationId = source.id;
    result.sourceTemplate = result.sourceTemplate.replace(adjacent, `{{${first.id}}}`);
    result.translationTemplate = result.translationTemplate.replace(adjacent, `{{${first.id}}}`);
    result.formulas = result.formulas.filter((entry) => entry.id === first.id || !ids.includes(entry.id));
    return bindPdfEquationNumbers(result, sources);
  }
  for (const { entry, tags, source } of claims) {
    delete entry.equationNumber;
    delete entry.equationGroupId;
    if (!source) {
      if (entry.sourceEquationId) result.issues.push(`${entry.id}: 原文公式行无法对应，请对照原图`);
      continue;
    }
    const refs = (text: string) => [...text.matchAll(/\{\{(m[1-9]\d{0,2})\}\}/gu)].filter((m) => m[1] === entry.id).length;
    if (!entry.display || claims.filter((claim) => claim.source?.id === source.id).length !== 1 ||
      refs(result.sourceTemplate) !== 1 || refs(result.translationTemplate) !== 1 ||
      tags.length > 1 || tags.some((tag) => tag !== source.number)) {
      result.issues.push(`${entry.id}: 原文公式 (${source.number}) 的行绑定冲突，请对照原图`);
      continue;
    }
    if(source.rowCount && source.rowCount>1 && !/\\begin\{(?:aligned|gathered|array|cases)\}/u.test(entry.latex)) {
      result.issues.push(`${entry.id}: 原文公式 (${source.number}) 共用一个编号的多行推导未完整合组，请对照原图`);
      continue;
    }
    entry.sourceEquationId = source.id;
    entry.equationNumber = source.number;
    entry.latex = entry.latex.replace(/\\tag\*?\s*\{\d{1,4}[a-z]?\}/giu, '').trim();
  }
  for (const source of sources) {
    if (!source.groupId) continue;
    const members = sources.filter((s) => s.groupId === source.groupId);
    const entries = result.formulas.filter((entry) => members.some((s) => s.id === entry.sourceEquationId) && entry.equationNumber);
    if (entries.length === members.length && members.length > 1 &&
      entries.every((entry) => !entry.review && !/\\begin\{(?:cases|aligned|array)\}|\\left\s*\\?\{/u.test(entry.latex))) {
      for (const entry of entries) entry.equationGroupId = source.groupId;
    }
  }
  result.issues = [...new Set(result.issues)];
  return result;
}
