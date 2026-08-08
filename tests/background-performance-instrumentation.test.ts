import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const backgroundPath = fileURLToPath(
  new URL('../entrypoints/background.ts', import.meta.url),
);
const backgroundSource = readFileSync(backgroundPath, 'utf8');
const sourceFile = ts.createSourceFile(
  backgroundPath,
  backgroundSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);

function descendants<T extends ts.Node>(
  root: ts.Node,
  predicate: (node: ts.Node) => node is T,
): T[] {
  const matches: T[] = [];
  const visit = (node: ts.Node): void => {
    if (predicate(node)) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return matches;
}

function backgroundFunction(name: string): ts.FunctionDeclaration {
  const declaration = sourceFile.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  );
  expect(declaration, `missing background function ${name}`).toBeDefined();
  return declaration!;
}

function callsNamed(root: ts.Node, name: string): ts.CallExpression[] {
  return descendants(
    root,
    (node): node is ts.CallExpression =>
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name,
  );
}

function performancePhaseAssignments(root: ts.Node): ts.BinaryExpression[] {
  return descendants(
    root,
    (node): node is ts.BinaryExpression =>
      ts.isBinaryExpression(node) &&
      ts.isPropertyAccessExpression(node.left) &&
      ts.isIdentifier(node.left.expression) &&
      node.left.expression.text === 'performanceTimings' &&
      (
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken ||
        node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionEqualsToken
      ),
  );
}

function assignedPhaseNames(root: ts.Node): Set<string> {
  return new Set(
    performancePhaseAssignments(root).map((assignment) =>
      (assignment.left as ts.PropertyAccessExpression).name.text),
  );
}

function expectRecordedOperation(
  declaration: ts.FunctionDeclaration,
  operation: string,
): void {
  const recordCalls = callsNamed(declaration, 'recordLocalPerformanceSample');
  expect(recordCalls, `${operation} should have one performance recorder`).toHaveLength(1);

  const payload = recordCalls[0]!.arguments[0];
  expect(
    Boolean(payload && ts.isObjectLiteralExpression(payload)),
    `${operation} recorder payload`,
  ).toBe(true);
  if (!payload || !ts.isObjectLiteralExpression(payload)) return;

  const operationProperty = payload.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) && property.name.getText(sourceFile) === 'operation',
  );
  expect(operationProperty, `${operation} recorder operation`).toBeDefined();
  expect(
    operationProperty && ts.isStringLiteral(operationProperty.initializer)
      ? operationProperty.initializer.text
      : undefined,
  ).toBe(operation);

  const timingsProperty = payload.properties.find((property) =>
    property.name?.getText(sourceFile) === 'timings');
  expect(timingsProperty, `${operation} recorder timings`).toBeDefined();
  expect(
    timingsProperty && ts.isShorthandPropertyAssignment(timingsProperty)
      ? timingsProperty.name.text
      : timingsProperty &&
          ts.isPropertyAssignment(timingsProperty) &&
          ts.isIdentifier(timingsProperty.initializer)
        ? timingsProperty.initializer.text
      : undefined,
  ).toBe('performanceTimings');
}

function expectPhases(
  declaration: ts.FunctionDeclaration,
  operation: string,
  expectedPhases: readonly string[],
): void {
  const phases = assignedPhaseNames(declaration);
  for (const phase of expectedPhases) {
    expect(phases.has(phase), `${operation} should measure ${phase}`).toBe(true);
  }
}

function finallyBlocks(declaration: ts.FunctionDeclaration): ts.Block[] {
  return descendants(
    declaration,
    (node): node is ts.TryStatement => ts.isTryStatement(node) && Boolean(node.finallyBlock),
  ).map((statement) => statement.finallyBlock!);
}

function declaredCallable(
  declaration: ts.FunctionDeclaration,
  name: string,
): ts.ArrowFunction | ts.FunctionExpression {
  const variable = descendants(
    declaration,
    (node): node is ts.VariableDeclaration =>
      ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name,
  ).find((candidate) =>
    Boolean(candidate.initializer &&
      (ts.isArrowFunction(candidate.initializer) || ts.isFunctionExpression(candidate.initializer))));
  expect(variable, `missing ${name} helper`).toBeDefined();
  return variable!.initializer as ts.ArrowFunction | ts.FunctionExpression;
}

function expectHelperSettledInFinally(declaration: ts.FunctionDeclaration): void {
  const finisher = declaredCallable(declaration, 'finishPerformance');
  expect(callsNamed(finisher, 'recordLocalPerformanceSample')).toHaveLength(1);
  expect(assignedPhaseNames(finisher).has('totalMs')).toBe(true);

  const settlements = finallyBlocks(declaration)
    .flatMap((block) => callsNamed(block, 'finishPerformance'));
  expect(settlements, 'performance helper should be called once from finally').toHaveLength(1);
}

function expectDirectlySettledInFinally(declaration: ts.FunctionDeclaration): void {
  const settlementBlocks = finallyBlocks(declaration).filter(
    (block) => callsNamed(block, 'recordLocalPerformanceSample').length > 0,
  );
  expect(
    settlementBlocks,
    'instrumented operation should have one diagnostic settlement block',
  ).toHaveLength(1);
  expect(callsNamed(settlementBlocks[0]!, 'recordLocalPerformanceSample')).toHaveLength(1);
  expect(assignedPhaseNames(settlementBlocks[0]!).has('totalMs')).toBe(true);
}

function expectFirstProviderOutputAssignedOnce(
  declaration: ts.FunctionDeclaration,
  operation: string,
): void {
  const firstOutputAssignments = performancePhaseAssignments(declaration).filter(
    (assignment) =>
      (assignment.left as ts.PropertyAccessExpression).name.text === 'providerFirstOutputMs',
  );
  expect(
    firstOutputAssignments,
    `${operation} should have one first-output assignment`,
  ).toHaveLength(1);
  expect(firstOutputAssignments[0]!.operatorToken.kind).toBe(
    ts.SyntaxKind.QuestionQuestionEqualsToken,
  );
  let ancestor: ts.Node | undefined = firstOutputAssignments[0]!.parent;
  while (ancestor && !ts.isPropertyAssignment(ancestor)) ancestor = ancestor.parent;
  expect(
    ancestor?.name.getText(sourceFile),
    `${operation} should capture first output from the streaming callback`,
  ).toBe('onPartialText');
}

function expectProviderTimingSettledOnFailure(
  declaration: ts.FunctionDeclaration,
  operation: string,
): void {
  const providerFinalizers = finallyBlocks(declaration).filter(
    (block) => assignedPhaseNames(block).has('providerMs'),
  );
  expect(
    providerFinalizers,
    `${operation} should settle providerMs from a finally block`,
  ).toHaveLength(1);
}

describe('background performance instrumentation', () => {
  it('records text translation totals and provider, validation, and persistence phases', () => {
    const declaration = backgroundFunction('translate');

    expectRecordedOperation(declaration, 'translate-text');
    expectPhases(declaration, 'translate-text', [
      'totalMs',
      'captureMs',
      'queueMs',
      'preflightMs',
      'providerFirstOutputMs',
      'providerMs',
      'latexValidationMs',
      'commitMs',
      'maintenanceMs',
    ]);
    expectFirstProviderOutputAssignedOnce(declaration, 'translate-text');
    expectProviderTimingSettledOnFailure(declaration, 'translate-text');
    expectHelperSettledInFinally(declaration);
  });

  it('records image translation totals and provider and persistence phases', () => {
    const declaration = backgroundFunction('translateImageRegion');

    expectRecordedOperation(declaration, 'translate-image-region');
    expectPhases(declaration, 'translate-image-region', [
      'totalMs',
      'captureMs',
      'queueMs',
      'preflightMs',
      'providerFirstOutputMs',
      'providerMs',
      'commitMs',
      'maintenanceMs',
    ]);
    expectFirstProviderOutputAssignedOnce(declaration, 'translate-image-region');
    expectProviderTimingSettledOnFailure(declaration, 'translate-image-region');
    expectHelperSettledInFinally(declaration);
  });

  it('records PDF recognition totals and capture, preflight, and provider phases', () => {
    const declaration = backgroundFunction('recognizePdfPage');

    expectRecordedOperation(declaration, 'recognize-pdf-page');
    expectPhases(declaration, 'recognize-pdf-page', [
      'totalMs',
      'captureMs',
      'preflightMs',
      'providerMs',
    ]);
    expectProviderTimingSettledOnFailure(declaration, 'recognize-pdf-page');
    expectDirectlySettledInFinally(declaration);
  });
});
