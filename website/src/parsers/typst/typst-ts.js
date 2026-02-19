import defaultParserInterface from '../utils/defaultParserInterface';
import pkg from '@myriaddreamin/typst.ts/package.json';
import wasmBin from '@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm';
import { parse as parseYaml } from 'yaml';

export const MAIN_FILE = '/main.typ';

export default {
  ...defaultParserInterface,

  id: 'typst-ts',
  displayName: 'typst.ts',
  version: pkg.version,
  homepage: 'https://github.com/Myriad-Dreamin/typst.ts',
  locationProps: new Set(['range', 'loc']),

  async loadParser(callback) {
    loadTypstCompiler(callback);
  },

  async parse(compiler, code) {
    return parseRawTypstAst(compiler, code);
  },

  getNodeName(node) {
    if (node && typeof node.type !== 'object') {
      return node.type;
    }

    if (node && typeof node.s === 'string') {
      return parseRawTypstAstSProperty(node.s).type;
    }

    return node.type;
  },

  nodeToRange(node) {
    if (node.range) {
      return node.range;
    }
  },
};

export function loadTypstCompiler(callback) {
  require(['@myriaddreamin/typst.ts/dist/esm/compiler.mjs'], async (mod) => {
    const compiler = mod.createTypstCompiler();
    await compiler.init({ getModule: () => wasmBin });
    callback(compiler);
  });
}

export async function parseRawTypstAst(compiler, code) {
  compiler.mapShadow(MAIN_FILE, new TextEncoder().encode(code));
  const astStr = await compiler.getAst(MAIN_FILE);
  return convertRawTypstAstStringToObject(astStr);
}

export function convertRawTypstAstStringToObject(rawTypstAstString) {
  const removeFirstLine = (input) => {
    const lines = input.split('\n');
    lines.shift();
    return lines.join('\n');
  };

  const escapeYamlValues = (yamlString) => {
    return yamlString
      .split('\n')
      .reduce((acc, line) => {
        if (!/^\s*(path:|ast:|- s: |s: |c:)/.test(line)) {
          if (acc.length > 0) {
            acc[acc.length - 1] = `${acc[acc.length - 1].slice(0, -1)}\\n${line}"`;
          }
          return acc;
        }
        const [key, ...rest] = line.split(':');
        if (rest[0] === '') {
          acc.push(line);
          return acc;
        }
        const value = rest.join(':').trim();
        acc.push(`${key}: "${value}"`);
        return acc;
      }, [])
      .join('\n');
  };

  const escapedRawTypstAstYamlString = escapeYamlValues(
    removeFirstLine(rawTypstAstString),
  );

  const parsed = parseYaml(escapedRawTypstAstYamlString);

  if (parsed.ast.c === null) {
    parsed.ast.c = [];
  }

  return parsed.ast;
}

function extractRawSourceByLocation(typstSource, location) {
  const { start, end } = location;
  const lines = typstSource.split('\n');

  const targetLines = lines.slice(start.line - 1, end.line);
  const targetLinesFirst = targetLines[0].slice(start.column);
  const targetLinesMiddle = targetLines.slice(1, -1);
  const targetLinesLast = targetLines[targetLines.length - 1].slice(0, end.column);

  let result;
  if (start.line === end.line) {
    result = targetLinesFirst.slice(0, end.column - start.column);
  } else {
    result = targetLinesFirst;
    if (targetLinesMiddle.length > 0) {
      result += `\n${targetLinesMiddle.join('\n')}`;
    }
    result += `\n${targetLinesLast}`;
  }

  return result;
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

export function parseRawTypstAstSProperty(s) {
  const spanMatch = s.match(/<span[^>]*>([\s\S]+?)<\/span>/);
  if (!spanMatch) {
    throw new Error(`Failed to parse Typst AST node type from: ${s}`);
  }
  const type = decodeHtmlEntities(spanMatch[1]);

  const locMatch = s.match(/&lt;(\d+):(\d+)~(\d+):(\d+)&gt;/);
  if (!locMatch) {
    return { type };
  }

  return {
    type,
    loc: {
      start: {
        line: parseInt(locMatch[1], 10),
        column: parseInt(locMatch[2], 10),
      },
      end: {
        line: parseInt(locMatch[3], 10),
        column: parseInt(locMatch[4], 10),
      },
    },
  };
}

function calcOffsetFromLoc(loc, source) {
  const lines = source.split('\n');
  let offset = 0;
  for (let i = 0; i < loc.start.line - 1; i++) {
    offset += lines[i].length + 1;
  }
  offset += loc.start.column;
  return offset;
}

export function convertRawTypstAstObjectToTypstAst(rawTypstAstObject, typstSource) {
  if (rawTypstAstObject.s === undefined) {
    throw new Error("Invalid raw Typst AST object: missing 's' property");
  }

  const sProperty = parseRawTypstAstSProperty(rawTypstAstObject.s);
  const raw = sProperty.loc
    ? extractRawSourceByLocation(typstSource, sProperty.loc)
    : undefined;
  const startOffset = sProperty.loc
    ? calcOffsetFromLoc(sProperty.loc, typstSource)
    : undefined;

  return {
    type: sProperty.type,
    raw,
    range:
      startOffset !== undefined && raw !== undefined
        ? [startOffset, startOffset + raw.length]
        : undefined,
    loc: sProperty.loc,
    children: (rawTypstAstObject.c || []).map((child) =>
      convertRawTypstAstObjectToTypstAst(child, typstSource),
    ),
  };
}
