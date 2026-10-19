import { readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Vercel builds api/*.ts itself, as its build log shows: it reads the nearest tsconfig.json
// (the root file, not tsconfig.api.json), fills in defaults for options the file leaves out
// and compiles each file on its own. This test repeats that build for the function and the
// files it imports, so a config change that would crash the deployed API fails here (#18).
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENTRY = 'api/analyze.ts';
const RELATIVE_SPECIFIER = /\b(?:from|import|require)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g;
const COMMONJS_SYNTAX = /\b(?:require\(|exports\.)/;

interface CompiledFile {
  readonly source: string;
  readonly output: string;
  readonly specifiers: readonly string[];
}

function vercelCompilerOptions(): ts.CompilerOptions {
  const configPath = join(ROOT, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, (path) => ts.sys.readFile(path)).config as unknown;
  const { options } = ts.parseJsonConfigFileContent(config, ts.sys, ROOT, undefined, configPath);
  // The defaults the builder applies when the config leaves these options out.
  return {
    ...options,
    noEmit: false,
    target: options.target ?? ts.ScriptTarget.ES2018,
    module: options.module ?? ts.ModuleKind.CommonJS,
  };
}

/** Compiles the entry and every file it imports, one file at a time. */
function compileFunction(): CompiledFile[] {
  const compilerOptions = vercelCompilerOptions();
  const compiled: CompiledFile[] = [];
  const pending = [ENTRY];
  const seen = new Set(pending);

  for (let source = pending.pop(); source !== undefined; source = pending.pop()) {
    const { outputText: output } = ts.transpileModule(readFileSync(join(ROOT, source), 'utf8'), {
      fileName: source,
      compilerOptions,
    });
    const specifiers = [...output.matchAll(RELATIVE_SPECIFIER)].flatMap((match) =>
      match[1] === undefined ? [] : [match[1]],
    );
    compiled.push({ source, output, specifiers });

    for (const specifier of specifiers) {
      const next = normalize(join(dirname(source), specifier.replace(/\.js$/, '.ts'))).replaceAll(
        '\\',
        '/',
      );
      if (!seen.has(next)) {
        seen.add(next);
        pending.push(next);
      }
    }
  }
  return compiled;
}

describe('Vercel build of the API function', () => {
  const files = compileFunction();

  it('follows the imports into the server modules and the shared schema', () => {
    expect(files.map((file) => file.source)).toEqual(
      expect.arrayContaining(['server/handleRequest.ts', 'src/types/schema.ts']),
    );
  });

  it('emits ES modules, as "type": "module" in package.json requires', () => {
    const commonJsFiles = files
      .filter((file) => COMMONJS_SYNTAX.test(file.output))
      .map((file) => file.source);

    expect(commonJsFiles).toEqual([]);
  });

  it('imports the compiled .js files, not the .ts sources', () => {
    const nonJsImports = files.flatMap((file) =>
      file.specifiers
        .filter((specifier) => !specifier.endsWith('.js'))
        .map((specifier) => `${file.source}: ${specifier}`),
    );

    expect(nonJsImports).toEqual([]);
  });
});
