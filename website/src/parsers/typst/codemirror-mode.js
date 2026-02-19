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
      push(state, tokenizeCode);
      return 'bracket';
    }

    // Closing brace → pop code context
    if (stream.eat('}')) {
      pop(state);
      return 'bracket';
    }

    // Opening bracket → enter markup context
    if (stream.eat('[')) {
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
      // Semicolons end code-line contexts (e.g., #let ... ;)
      if (state.stack.length > 0 && state.stack[state.stack.length - 1] === tokenizeCodeLine) {
        pop(state);
      }
      return 'punctuation';
    }
    if (stream.eat('(')) return 'bracket';
    if (stream.eat(')')) return 'bracket';
    if (stream.eat('.')) return 'punctuation';

    // Identifier
    if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_-]*/)) {
      const word = stream.current();

      // Handle 'and', 'or', 'not' as operators
      if (word === 'and' || word === 'or' || word === 'not') return 'keyword';

      if (keywords.has(word)) return 'keyword';
      if (controlKeywords.has(word)) return 'keyword';
      if (constants.has(word)) return 'atom';

      // Function name if followed by ( or [
      if (stream.match(/^\s*[([]/,  false)) return 'def';

      return 'variable';
    }

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
    if (stream.match(/^\\([\\/\[\]{}#*_=~`$.,-]|u\{[0-9a-zA-Z]*\}?)/)) {
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
      if (stream.match(/^(if|else)\b/)) {
        push(state, tokenizeCode);
        return 'keyword';
      }
      if (stream.match(/^(for|while)\b/)) {
        push(state, tokenizeCode);
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
        return 'def';
      }

      // #variable (possibly dotted, e.g., #state.value)
      if (stream.match(/^[a-zA-Z_][.a-zA-Z0-9_-]*/)) {
        return 'variable';
      }

      // Bare #, fall through as meta
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
      };
    },

    lineComment: '//',
    blockCommentStart: '/*',
    blockCommentEnd: '*/',
  };
});

CodeMirror.defineMIME('text/x-typst', 'typst');
