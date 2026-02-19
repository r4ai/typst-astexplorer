import defaultParserInterface from '../utils/defaultParserInterface';
import pkg from '@myriaddreamin/typst.ts/package.json';
import wasmBin from '@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm';

const MAIN_FILE = '/main.typ';

export default {
  ...defaultParserInterface,

  id: 'typst-ts',
  displayName: 'typst.ts',
  version: pkg.version,
  homepage: 'https://github.com/Myriad-Dreamin/typst.ts',
  locationProps: new Set(['range']),

  async loadParser(callback) {
    require(['@myriaddreamin/typst.ts/dist/esm/compiler.mjs'], async (mod) => {
      const compiler = mod.createTypstCompiler();
      await compiler.init({ getModule: () => wasmBin });
      callback(compiler);
    });
  },

  async parse(compiler, code) {
    compiler.mapShadow(MAIN_FILE, new TextEncoder().encode(code));
    const astStr = await compiler.getAst(MAIN_FILE);
    return parseAstString(astStr);
  },

  getNodeName(node) {
    return node.kind;
  },

  nodeToRange(node) {
    if (node.range) {
      return node.range;
    }
  },
};

// Convert the indented text tree returned by getAst() into a JS object tree.
function parseAstString(str) {
  const lines = str.split('\n').filter(l => l.trim());
  const root = { kind: 'root', children: [] };
  const stack = [{ node: root, indent: -1 }];

  for (const line of lines) {
    const indent = line.search(/\S/);
    const content = line.trim();

    // "NodeKind [start..end]" or "NodeKind: text" format
    const rangeMatch = content.match(/^(\w+)\s+\[(\d+)\.\.(\d+)\](.*)$/);
    const textMatch  = content.match(/^(\w+):\s*(.+)$/);

    let node;
    if (rangeMatch) {
      node = {
        kind: rangeMatch[1],
        range: [parseInt(rangeMatch[2]), parseInt(rangeMatch[3])],
        children: [],
      };
      if (rangeMatch[4].trim()) node.text = rangeMatch[4].trim();
    } else if (textMatch) {
      node = { kind: textMatch[1], text: textMatch[2], children: [] };
    } else {
      node = { kind: content, children: [] };
    }

    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    stack[stack.length - 1].node.children.push(node);
    stack.push({ node, indent });
  }

  return root.children.length === 1 ? root.children[0] : root;
}
