import rawTypstParser, {
  convertRawTypstAstObjectToTypstAst,
  parseRawTypstAst,
} from './typst-ts';

export default {
  ...rawTypstParser,

  id: 'typst-ts-ast',
  displayName: 'typst.ts (Formatted AST)',

  async parse(compiler, code) {
    const rawAst = await parseRawTypstAst(compiler, code);
    return convertRawTypstAstObjectToTypstAst(rawAst, code);
  },
};
