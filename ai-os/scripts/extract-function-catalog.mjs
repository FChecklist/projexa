// Mechanical extraction of every top-level function/arrow-const/class-method
// across src/**/*.{ts,tsx} via the TypeScript compiler's own AST (parse-only,
// no type-checker/Program needed -- fast, no project-wide resolution).
// Ground truth generated from the live code, not AI-written descriptions.
// Reusable across repos -- pass repo root as argv[2], output path as argv[3].
// Run: node extract-function-catalog.mjs /abs/repo/root /abs/output.json
import ts from 'typescript'
import { readFileSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'
import path from 'path'

const REPO_ROOT = process.argv[2]
const OUTPUT_PATH = process.argv[3] || '/tmp/function_catalog.json'
if (!REPO_ROOT) {
  console.error('Usage: extract-function-catalog.mjs /abs/repo/root [/abs/output.json]')
  process.exit(1)
}
const SRC_ROOT = path.join(REPO_ROOT, 'src')

const fileList = execSync(
  `find "${SRC_ROOT}" -type f \\( -name '*.ts' -o -name '*.tsx' \\) -not -name '*.d.ts' -not -name '*.test.ts' -not -name '*.test.tsx'`,
  { maxBuffer: 1024 * 1024 * 50 }
).toString().trim().split('\n').filter(Boolean)

function hasExportModifier(node) {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
  return !!mods?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
}
function hasAsyncModifier(node) {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
  return !!mods?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword)
}
function leadingJsDocSummary(node, sourceFile) {
  const jsDocs = ts.getJSDocCommentsAndTags ? ts.getJSDocCommentsAndTags(node) : []
  for (const doc of jsDocs) {
    if (ts.isJSDoc(doc) && doc.comment) {
      const text = typeof doc.comment === 'string' ? doc.comment : doc.comment.map(c => c.text).join('')
      const firstLine = text.split('\n')[0].trim()
      if (firstLine) return firstLine
    }
  }
  return null
}
function paramList(params, sourceFile) {
  return params.map(p => {
    const name = p.name.getText(sourceFile)
    const type = p.type ? p.type.getText(sourceFile) : null
    const optional = !!p.questionToken
    return { name, type, optional }
  })
}

const functions = []
let filesParsed = 0
let filesFailed = []

for (const absPath of fileList) {
  const relPath = path.relative(REPO_ROOT, absPath)
  let text
  try {
    text = readFileSync(absPath, 'utf8')
  } catch (e) {
    filesFailed.push({ file: relPath, reason: String(e) })
    continue
  }
  let sourceFile
  try {
    sourceFile = ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, true,
      absPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  } catch (e) {
    filesFailed.push({ file: relPath, reason: String(e) })
    continue
  }
  filesParsed++

  let currentClass = null

  function visit(node) {
    // top-level / nested function declaration: function foo(...) {}
    if (ts.isFunctionDeclaration(node) && node.name) {
      functions.push({
        name: node.name.text,
        file: relPath,
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        kind: 'function_declaration',
        exported: hasExportModifier(node),
        async: hasAsyncModifier(node),
        class_name: currentClass,
        params: paramList(node.parameters, sourceFile),
        jsdoc_summary: leadingJsDocSummary(node, sourceFile),
      })
    }
    // const foo = (...) => {} / const foo = async function(...) {}
    if (ts.isVariableStatement(node)) {
      const exported = hasExportModifier(node)
      for (const decl of node.declarationList.declarations) {
        if (!decl.name || !ts.isIdentifier(decl.name)) continue
        const init = decl.initializer
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          functions.push({
            name: decl.name.text,
            file: relPath,
            line: sourceFile.getLineAndCharacterOfPosition(decl.getStart()).line + 1,
            kind: ts.isArrowFunction(init) ? 'arrow_const' : 'function_expression_const',
            exported,
            async: hasAsyncModifier(init),
            class_name: currentClass,
            params: paramList(init.parameters, sourceFile),
            jsdoc_summary: leadingJsDocSummary(node, sourceFile),
          })
        }
      }
    }
    // class methods
    if (ts.isClassDeclaration(node)) {
      const prevClass = currentClass
      currentClass = node.name ? node.name.text : '(anonymous class)'
      ts.forEachChild(node, visit)
      currentClass = prevClass
      return
    }
    if (ts.isMethodDeclaration(node) && node.name) {
      const methodName = ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : node.name.getText(sourceFile)
      functions.push({
        name: methodName,
        file: relPath,
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        kind: 'class_method',
        exported: null, // method visibility is a class-membership concept, not export
        async: hasAsyncModifier(node),
        class_name: currentClass,
        params: paramList(node.parameters, sourceFile),
        jsdoc_summary: leadingJsDocSummary(node, sourceFile),
      })
    }
    // constructors -- confirmed real gap 2026-07-20: custom Error subclasses
    // across the codebase (MissingInformationError, InvalidRoleError, etc.)
    // use constructor(...) and were silently missed by the first version
    // (only ts.isMethodDeclaration was handled, not ts.isConstructorDeclaration).
    if (ts.isConstructorDeclaration(node)) {
      functions.push({
        name: 'constructor',
        file: relPath,
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        kind: 'class_constructor',
        exported: null,
        async: false,
        class_name: currentClass,
        params: paramList(node.parameters, sourceFile),
        jsdoc_summary: leadingJsDocSummary(node, sourceFile),
      })
    }
    // get/set accessors -- not confirmed present in this codebase (spot-check
    // found none), included for completeness/future-proofing at zero cost.
    if ((ts.isGetAccessor(node) || ts.isSetAccessor(node)) && node.name) {
      const accName = ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : node.name.getText(sourceFile)
      functions.push({
        name: accName,
        file: relPath,
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        kind: ts.isGetAccessor(node) ? 'class_getter' : 'class_setter',
        exported: null,
        async: false,
        class_name: currentClass,
        params: paramList(node.parameters, sourceFile),
        jsdoc_summary: leadingJsDocSummary(node, sourceFile),
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
}

const result = {
  generated_by: 'extract-function-catalog.mjs (TypeScript compiler AST, parse-only, not AI-written)',
  source_root: SRC_ROOT,
  files_scanned: fileList.length,
  files_parsed: filesParsed,
  files_failed: filesFailed,
  function_count: functions.length,
  by_kind: functions.reduce((acc, f) => { acc[f.kind] = (acc[f.kind] || 0) + 1; return acc }, {}),
  functions,
}

writeFileSync(OUTPUT_PATH, JSON.stringify(result))
console.log(JSON.stringify({
  files_scanned: fileList.length,
  files_parsed: filesParsed,
  files_failed_count: filesFailed.length,
  function_count: functions.length,
  by_kind: result.by_kind,
}, null, 2))
