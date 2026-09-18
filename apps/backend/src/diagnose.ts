import * as ts from 'typescript';

function getDiagnostics() {
  const fileName = 'c:/Users/PC/Desktop/Kiosco/apps/frontend/src/components/pos/CierreCajaModal.tsx';
  const program = ts.createProgram([fileName], {
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.Latest,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
  });
  
  const diagnostics = ts.getPreEmitDiagnostics(program);
  for (const diag of diagnostics) {
    if (diag.file && diag.start !== undefined) {
      const { line, character } = diag.file.getLineAndCharacterOfPosition(diag.start);
      console.log(`${diag.file.fileName} (${line + 1},${character + 1}): ${ts.flattenDiagnosticMessageText(diag.messageText, '\n')}`);
    } else {
      console.log(ts.flattenDiagnosticMessageText(diag.messageText, '\n'));
    }
  }
}

getDiagnostics();
