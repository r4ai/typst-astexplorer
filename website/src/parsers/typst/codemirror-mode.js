// Ported from the TextMate grammar for Typst:
// https://github.com/shikijs/textmate-grammars-themes/blob/38aad25a1e81c71336dcd3b6fb5061064906c302/packages/tm-grammars/grammars/typst.json

import CodeMirror from 'codemirror';

CodeMirror.defineMode('typst', function () {
  const keywords = new Set([
    'let', 'as', 'in', 'set', 'show',
  ]);
  const controlKeywords = new Set([
    'if', 'else', 'for', 'while', 'break', 'continue',
    'import', 'include', 'export', 'return',
  ]);
  const constants = new Set(['none', 'auto', 'true', 'false']);

  function makeState() {
    return {
      // stack of tokenizer functions
      stack: [],
      // for raw block: fence string that closes the block
      rawFence: null,
      // block comment nesting depth
      commentDepth: 0,
      // tracks whether a function call argument list is expected
      expectArgs: false,
      // tracks a possible `show` target name
      afterShow: false,
      // tracks control context endings after block closures
      justClosedBlock: false,
    };
  }

  function currentTokenize(state) {
    return state.stack.length
      ? state.stack[state.stack.length - 1]
      : tokenizeMarkup;
  }

  function push(state, fn) {
    state.stack.push(fn);
  }

  function pop(state) {
    state.stack.pop();
  }

  // -----------------------------------------------------------------------
  // Block comment tokenizer (handles /* ... */ with nesting)
  // -----------------------------------------------------------------------
  function tokenizeBlockComment(stream, state) {
    while (!stream.eol()) {
      if (stream.match('/*')) {
        state.commentDepth++;
      } else if (stream.match('*/')) {
        state.commentDepth--;
        if (state.commentDepth === 0) {
          pop(state);
          return 'comment';
        }
      } else {
        stream.next();
      }
    }
    return 'comment';
  }

  // -----------------------------------------------------------------------
  // Math tokenizer ($...$)
  // -----------------------------------------------------------------------
  function tokenizeMath(stream, state) {
    while (!stream.eol()) {
      if (stream.eat('$')) {
        pop(state);
        return 'string-2';
      }
      stream.next();
    }
    return 'string-2';
  }

  // -----------------------------------------------------------------------
  // Raw inline tokenizer (`...`)
  // -----------------------------------------------------------------------
  function tokenizeRawInline(stream, state) {
    while (!stream.eol()) {
      if (stream.eat('`')) {
        pop(state);
        return 'string';
      }
      stream.next();
    }
    return 'string';
  }

  // -----------------------------------------------------------------------
  // Raw block tokenizer (```...```)
  // -----------------------------------------------------------------------
  function tokenizeRawBlock(stream, state) {
    if (stream.match(state.rawFence)) {
      state.rawFence = null;
      pop(state);
      return 'string';
    }
    stream.skipToEnd();
    return 'string';
  }

  // -----------------------------------------------------------------------
  // String tokenizer ("...")
  // -----------------------------------------------------------------------
  function tokenizeString(stream, state) {
    while (!stream.eol()) {
      const ch = stream.next();
      if (ch === '\\') {
        stream.next(); // consume escape
      } else if (ch === '"') {
        pop(state);
        return 'string';
      }
    }
    return 'string';
  }

  // -----------------------------------------------------------------------
  // Shared utility: try to tokenize things common to both markup and code
  // Returns a token style string or null if nothing matched.
  // -----------------------------------------------------------------------
  function tokenizeCommon(stream, state) {
    // Block comment
    if (stream.match('/*')) {
      state.commentDepth = 1;
      push(state, tokenizeBlockComment);
      return 'comment';
    }
    // Line comment
    if (stream.match('//')) {
      const prev = stream.pos >= 2 ? stream.string.charAt(stream.pos - 3) : '';
      if (prev === ':') return null;
      stream.skipToEnd();
      return 'comment';
    }
    return null;
  }

  // -----------------------------------------------------------------------
  // Code tokenizer
  // Handles expressions, let/set/show, function calls, etc.
  // Used when inside #{...} or after # keywords.
  // -----------------------------------------------------------------------
  function tokenizeCode(stream, state) {
    if (stream.eatSpace()) return null;

    const common = tokenizeCommon(stream, state);
    if (common !== null) return common;

    // Opening brace → push another code context
    if (stream.eat('{')) {
      state.justClosedBlock = false;
      state.afterShow = false;
      push(state, tokenizeCode);
      return 'bracket';
    }

    // Closing brace → pop code context
    if (stream.eat('}')) {
      state.justClosedBlock = true;
      state.afterShow = false;
      pop(state);
      return 'bracket';
    }

    // Opening bracket → enter markup context
    if (stream.eat('[')) {
      state.justClosedBlock = false;
      state.afterShow = false;
      push(state, tokenizeMarkupBlock);
      return 'bracket';
    }

    // Math
    if (stream.eat('$')) {
      push(state, tokenizeMath);
      return 'string-2';
    }

    // String
    if (stream.eat('"')) {
      push(state, tokenizeString);
      return 'string';
    }

    // Raw inline
    if (stream.match(/^`{3,}/)) {
      state.rawFence = stream.current();
      push(state, tokenizeRawBlock);
      return 'string';
    }
    if (stream.eat('`')) {
      push(state, tokenizeRawInline);
      return 'string';
    }

    // Numbers with units
    if (stream.match(/^(\d*)?\.?\d+([eE][+-]?\d+)?(mm|pt|cm|in|em|rad|deg|fr|%)\b/)) {
      return 'number';
    }
    if (stream.match(/^\d+\b/)) return 'number';
    if (stream.match(/^(\d*)?\.?\d+([eE][+-]?\d+)?\b/)) return 'number';

    // Operators
    if (stream.match(/^(=>|\.\.)/)) return 'operator';
    if (stream.match(/^(==|!=|<=|>=|<|>)/)) return 'operator';
    if (stream.match(/^(\+=|-=|\*=|\/=|=)/)) return 'operator';
    if (stream.match(/^(\+|\*|\/)/)) return 'operator';
    if (stream.eat('-')) return 'operator';

    // Punctuation
    if (stream.eat(':')) return 'punctuation';
    if (stream.eat(',')) return 'punctuation';
    if (stream.eat(';')) {
      state.afterShow = false;
      // Semicolons end code-line contexts (e.g., #let ... ;)
      if (state.stack.length > 0 && state.stack[state.stack.length - 1] === tokenizeCodeLine) {
        pop(state);
      }
      return 'punctuation';
    }
    if (stream.eat('(')) {
      if (state.expectArgs) {
        push(state, tokenizeArguments);
        state.expectArgs = false;
      }
      state.afterShow = false;
      return 'bracket';
    }
    if (stream.eat(')')) {
      state.afterShow = false;
      return 'bracket';
    }
    if (stream.eat('.')) return 'punctuation';

    // Identifier
    if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_-]*/)) {
      const word = stream.current();

      // Handle 'and', 'or', 'not' as operators
      if (word === 'and' || word === 'or' || word === 'not') return 'keyword';

      if (keywords.has(word)) {
        state.afterShow = word === 'show';
        return 'keyword';
      }
      if (controlKeywords.has(word)) return 'keyword';
      if (constants.has(word)) return 'atom';

      if (state.afterShow && stream.match(/^\s*[:.]/, false)) {
        state.afterShow = false;
        return 'def';
      }
      state.afterShow = false;

      // Function name if followed by ( or [
      if (stream.match(/^\s*[([]/, false)) {
        state.expectArgs = true;
        return 'def';
      }

      return 'variable';
    }

    state.afterShow = false;
    stream.next();
    return null;
  }

  // A code tokenizer that pops when it reaches a newline or ] or ;
  // Used for #let / #set / #show / #import / #include on a single line
  function tokenizeCodeLine(stream, state) {
    if (stream.eol()) {
      pop(state); // end of line ends this context
      return null;
    }
    // ] ends this context (because we're in a markup content block)
    if (stream.peek() === ']') {
      pop(state);
      return null;
    }
    return tokenizeCode(stream, state);
  }

  // Control-flow code context: ends at newline, ] or after a closed block.
  function tokenizeCodeControl(stream, state) {
    if (stream.eol()) {
      pop(state);
      return null;
    }
    if (stream.peek() === ']') {
      pop(state);
      return null;
    }
    if (state.justClosedBlock) {
      state.justClosedBlock = false;
      pop(state);
      return null;
    }
    return tokenizeCode(stream, state);
  }

  // Generic #code context that ends at whitespace.
  function tokenizeCodeUntilSpace(stream, state) {
    if (stream.eol()) {
      pop(state);
      return null;
    }
    if (/\s/.test(stream.peek())) {
      pop(state);
      return null;
    }
    return tokenizeCode(stream, state);
  }

  // Function argument tokenizer used for func(...)
  function tokenizeArguments(stream, state) {
    if (stream.eol()) return null;
    if (stream.eat(')')) {
      pop(state);
      return 'bracket';
    }
    if (stream.eatSpace()) return null;

    const common = tokenizeCommon(stream, state);
    if (common !== null) return common;

    if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_-]*(?=\s*:)/)) return 'variable-2';
    return tokenizeCode(stream, state);
  }

  function isWord(ch) {
    return /[A-Za-z0-9_]/.test(ch);
  }

  function isEmphasisMarker(stream) {
    const prev = stream.pos > 0 ? stream.string.charAt(stream.pos - 1) : '';
    const next = stream.pos + 1 < stream.string.length ? stream.string.charAt(stream.pos + 1) : '';
    return stream.sol() || stream.pos === stream.string.length - 1 || !isWord(prev) || !isWord(next);
  }

  function makeEmphasisTokenizer(marker, style) {
    return function tokenizeEmphasis(stream, state) {
      if (stream.eol() || stream.peek() === ']') {
        pop(state);
        return style;
      }
      if (stream.peek() === marker && isEmphasisMarker(stream)) {
        stream.next();
        pop(state);
        return style;
      }
      stream.next();
      return style;
    };
  }

  // Markup block tokenizer: inside [...] within code
  function tokenizeMarkupBlock(stream, state) {
    if (stream.eat(']')) {
      pop(state);
      return 'bracket';
    }
    return tokenizeMarkupCore(stream, state);
  }

  // -----------------------------------------------------------------------
  // Markup tokenizer (default mode)
  // -----------------------------------------------------------------------
  function tokenizeMarkupCore(stream, state) {
    if (stream.eatSpace()) return null;

    const common = tokenizeCommon(stream, state);
    if (common !== null) return common;

    // Escape sequences
    if (stream.match(/^\\([\\/[\]{}#*_=~`$.,-]|u\{[0-9a-zA-Z]*\}?)/)) {
      return 'string-2';
    }
    if (stream.eat('\\')) return 'meta'; // line break escape

    // Math
    if (stream.eat('$')) {
      push(state, tokenizeMath);
      return 'string-2';
    }

    // Raw block
    if (stream.match(/^`{3,}/)) {
      state.rawFence = stream.current();
      push(state, tokenizeRawBlock);
      return 'string';
    }
    if (stream.eat('`')) {
      push(state, tokenizeRawInline);
      return 'string';
    }

    // URL
    if (stream.match(/^https?:\/\/[0-9a-zA-Z~/%#&=',.;+?]*/)) {
      return 'link';
    }

    // Special punctuation
    if (stream.match('---')) return 'meta';
    if (stream.match('--')) return 'meta';
    if (stream.match('...')) return 'meta';
    if (stream.match('-?')) return 'meta';
    if (stream.eat('~')) return 'meta';

    // Symbol: :name:
    if (stream.match(/^:([a-zA-Z0-9]+:)+/)) return 'atom';

    // Bold / italic
    if (stream.peek() === '*' && isEmphasisMarker(stream)) {
      stream.next();
      push(state, makeEmphasisTokenizer('*', 'strong'));
      return 'strong';
    }
    if (stream.peek() === '_' && isEmphasisMarker(stream)) {
      stream.next();
      push(state, makeEmphasisTokenizer('_', 'em'));
      return 'em';
    }

    // Label  <identifier>
    if (stream.match(/^<[a-zA-Z_][a-zA-Z0-9_-]*>/)) return 'tag';

    // Reference @identifier
    if (stream.match(/^@[a-zA-Z_][a-zA-Z0-9_-]*/)) return 'tag';

    // Heading (start of line)
    if (stream.sol() && stream.match(/^\s*=+\s+/)) return 'header';

    // Unordered list
    if (stream.sol() && stream.match(/^\s*-\s+/)) return 'meta';

    // Ordered list or +
    if (stream.sol() && stream.match(/^\s*([0-9]*\.|\+)\s+/)) return 'meta';

    // Description list
    if (stream.sol() && stream.match(/^\s*\/\s+/)) return 'meta';

    // Code expressions starting with #
    if (stream.eat('#')) {
      // #{ block
      if (stream.eat('{')) {
        push(state, tokenizeCode);
        return 'bracket';
      }

      // #[ markup block
      if (stream.eat('[')) {
        push(state, tokenizeMarkupBlock);
        return 'bracket';
      }

      // # keywords that span to end of line / ;  / ]
      if (stream.match(/^(let|set|show)\b/)) {
        push(state, tokenizeCodeLine);
        return 'keyword';
      }
      if (stream.match(/^(as|in)\b/)) return 'keyword';
      if (stream.match(/^(if|else)\b/)) {
        push(state, tokenizeCodeControl);
        return 'keyword';
      }
      if (stream.match(/^(for|while)\b/)) {
        push(state, tokenizeCodeControl);
        return 'keyword';
      }
      if (stream.match(/^(break|continue)\b/)) return 'keyword';
      if (stream.match(/^(import|include|export)\b/)) {
        push(state, tokenizeCodeLine);
        return 'keyword';
      }
      if (stream.match(/^(return)\b/)) return 'keyword';

      // #funcname( or #funcname[
      if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_-]*!?(?=[([])/, false)) {
        stream.match(/^[a-zA-Z_][a-zA-Z0-9_-]*!?/);
        state.expectArgs = true;
        return 'def';
      }

      // #variable (possibly dotted, e.g., #state.value)
      if (stream.match(/^[a-zA-Z_][.a-zA-Z0-9_-]*/)) {
        return 'variable';
      }

      // Generic #code until whitespace.
      push(state, tokenizeCodeUntilSpace);
      return 'meta';
    }

    stream.next();
    return null;
  }

  function tokenizeMarkup(stream, state) {
    return tokenizeMarkupCore(stream, state);
  }

  return {
    startState: makeState,

    token: function (stream, state) {
      return currentTokenize(state)(stream, state);
    },

    copyState: function (state) {
      return {
        stack: state.stack.slice(),
        rawFence: state.rawFence,
        commentDepth: state.commentDepth,
        expectArgs: state.expectArgs,
        afterShow: state.afterShow,
        justClosedBlock: state.justClosedBlock,
      };
    },

    lineComment: '//',
    blockCommentStart: '/*',
    blockCommentEnd: '*/',
  };
});

CodeMirror.defineMIME('text/x-typst', 'typst');
