import { readFile } from 'node:fs/promises';
import { runInThisContext } from 'node:vm';
import ts from 'typescript';

/** Execute actual application TypeScript with narrowly supplied native adapters. */
export async function loadTypeScript(relativePath, adapters = {}) {
  const source = await readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const module = { exports: {} };
  // Use Node's existing realm so await/Promise continuation ordering matches
  // the app, without artificial cross-realm promise-assimilation microtasks.
  const execute = runInThisContext(`(function(module, exports, require) {\n${outputText}\n})`,
    { filename: relativePath });
  execute(module, module.exports, (specifier) => {
    if (!(specifier in adapters)) throw new Error(`Missing test adapter: ${specifier}`);
    return adapters[specifier];
  });
  return module.exports;
}
