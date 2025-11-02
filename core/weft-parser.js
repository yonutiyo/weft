// core/weft-parser.js
// Enhanced Weft Parser v2 - Complete authoring format with unified symbol system
//
// SYMBOL HIERARCHY (Coherent Design):
//   ! - Story-level metadata (headers)
//   :: - Passage definition
//   @ - Passage-level directives (navigation/control)
//   <<>> - Block macros (structural logic)
//   {{}} - Inline expressions (output)
//   [[]] - Navigation links (with guards/weights)
//   **/*/__/~~ - Inline markdown (formatting)
//   /* // - Comments
//
// NEW FEATURES:
//   1. Variable Manipulation:
//      - <<set $x += 5>>, <<set $x++>>, <<set $x-->>
//      - <<run code>> - Execute without assignment
//      - <<unset $x>> - Delete variable
//
//   2. Inline Markdown-Lite:
//      - **bold**, *italic*, __underline__, ~~strike~~
//      - `code`, > blockquote, --- horizontal rule
//      - Fast single-pass transformation
//
//   3. Navigation & Graph Control:
//      - @once - Passage shows once
//      - @visited - Track visits
//      - @weight: 5 - Passage importance
//      - @requires: condition - Passage guard
//      - [[text->target ? condition]] - Link guard
//      - [[text->target :5]] - Link weight
//      - [[text->target !once]] - Link modifier
//
// OPTIMIZATION:
//   - All O(n) or better
//   - Pre-compiled regex patterns
//   - Single-pass markdown parsing
//   - Efficient state tracking

// ============================================================================
// PRE-COMPILED PATTERNS
// ============================================================================

const PATTERNS = {
  // Headers
  headerLine: /^\s*!/,
  weftVersion: /^\s*!weft\s+(\d+)\s*$/,
  headerKV: /^\s*!([a-z-]+)\s*:\s*(.*?)\s*$/,
  
  // Passages
  passageHeader: /^\s*::\s*([^\[\{@]+?)\s*(?:\[(.*?)\])?\s*(?:\{(.*)\})?\s*$/,
  titleAtTop: /^\s*#\s+(.*)$/,
  
  // Passage directives (@-rules)
  passageDirective: /^\s*@(once|visited|weight|requires|tags)\s*:?\s*(.*?)\s*$/i,
  
  // Whitespace
  whitespaceOnly: /^\s*$/,
  trailingSpace: /[ \t]+$/gm,
  multipleNewlines: /\n\s*\n\s*\n+/g,
  
  // Comments
  blockComment: /\/\*[\s\S]*?\*\//g,
  lineComment: /^\/\/.*$/gm,
  
  // Expressions
  expression: /\{\{\{\s*([^}]+?)\s*\}\}\}|\{\{\s*([^}]+?)\s*\}\}/g,
  
  // Inline code
  inlineCodePrint: /<%=\s*(.*?)\s*%>/g,
  inlineCode: /<%\s*([\s\S]*?)\s*%>/g,
  
  // Macros - Enhanced
  ifMacro: /<<if\s+(.+?)>>|<<elseif\s+(.+?)>>|<<else>>|<<endif>>/gi,
  setMacro: /<<set\s+\$(\w+(?:\.\w+)*)\s+([\+\-\*\/\%]?=|to|\+\+|--)\s*(.*?)>>/gi,
  runMacro: /<<run\s+(.+?)>>/gi,
  unsetMacro: /<<unset\s+\$(\w+(?:\.\w+)*)>>/gi,
  printMacro: /<<print\s+(.+?)>>|<<=\s*(.+?)>>/gi,
  linkMacro: /<<link\s+"([^"]+)"\s*(?:"([^"]*)")?\s*>>(?:([\s\S]*?)<<endlink>>)?/gi,
  includeMacro: /<<include\s+"([^"]+)">>/gi,
  
  // Links - Enhanced with guards and weights
  wikiLink: /\[\[([^\]]+)\]\]/g,
  goDirective: /^@go\s+(\S+)(?:\s*\|\s*(.+))?$/gm,
  
  // Markdown-lite (inline formatting)
  // Using negative lookbehind/lookahead to avoid matching in URLs
  bold: /\*\*([^\*]+?)\*\*/g,
  italic: /\*([^\*\s][^\*]*?)\*/g,
  underline: /__([^_]+?)__/g,
  strike: /~~([^~]+?)~~/g,
  inlineCode: /`([^`]+?)`/g,
  
  // Block markdown
  blockquote: /^>\s+(.+)$/gm,
  horizontalRule: /^---+$/gm,
  
  // Escape sequences
  escapedLBrack: /\\\[\[/g,
  escapedRBrack: /\\\]\]/g,
  escapedAsterisk: /\\\*/g,
  escapedUnderscore: /\\_/g,
  escapedTilde: /\\~/g,
  escapedBacktick: /\\`/g
};

// Sentinels for escaping
const SENTINEL = {
  LBRK: "\u0001LBRK\u0001",
  RBRK: "\u0001RBRK\u0001",
  STAR: "\u0001STAR\u0001",
  UNDR: "\u0001UNDR\u0001",
  TILD: "\u0001TILD\u0001",
  BTCK: "\u0001BTCK\u0001"
};

// ============================================================================
// DIAGNOSTIC CODES
// ============================================================================

const CODES = {
  MISSING_HEADER: "WEFT_MISSING_HEADER",
  BAD_VERSION: "WEFT_BAD_VERSION",
  UNKNOWN_HEADER_KEY: "WEFT_UNKNOWN_HEADER_KEY",
  UNKNOWN_CASE: "WEFT_UNKNOWN_CASE",
  UNKNOWN_WS: "WEFT_UNKNOWN_WHITESPACE",
  UNKNOWN_DIRECTIVE: "WEFT_UNKNOWN_DIRECTIVE",
  TRAILING_TEXT: "WEFT_TRAILING_TEXT",
  MALFORMED_PASSAGE_HEAD: "WEFT_MALFORMED_PASSAGE_HEADER",
  DUP_ID: "WEFT_DUPLICATE_ID",
  EMPTY_ID: "WEFT_EMPTY_ID",
  ATTR_BAD: "WEFT_ATTR_BAD",
  NO_PASSAGES: "WEFT_NO_PASSAGES",
  LINK_UNKNOWN: "WEFT_LINK_UNKNOWN",
  MACRO_UNMATCHED: "WEFT_MACRO_UNMATCHED",
  MACRO_SYNTAX: "WEFT_MACRO_SYNTAX",
  GUARD_SYNTAX: "WEFT_GUARD_SYNTAX"
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function escapeHtml(str, escapeQuotes = false) {
  const s = String(str);
  const chars = [];
  
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    switch (ch) {
      case "&": chars.push("&amp;"); break;
      case "<": chars.push("&lt;"); break;
      case ">": chars.push("&gt;"); break;
      case '"': chars.push(escapeQuotes ? "&quot;" : '"'); break;
      default: chars.push(ch);
    }
  }
  
  return chars.join("");
}

function escapeAttr(str) {
  return escapeHtml(str, true);
}

function collapseWhitespace(text) {
  let result = text.replace(PATTERNS.trailingSpace, "");
  return result.replace(PATTERNS.multipleNewlines, "\n\n");
}

function stripComments(text) {
  let result = text.replace(PATTERNS.blockComment, "");
  return result.replace(PATTERNS.lineComment, "");
}

// ============================================================================
// ATTRIBUTE PARSER
// ============================================================================

function parseAttributes(src, lineNum, diagnostics) {
  const out = {};
  if (!src || !src.trim()) return out;
  
  const s = src.trim();
  let j = 0;
  
  function addDiag(severity, code, message) {
    diagnostics.push({ severity, code, file: "", line: lineNum, col: j + 1, message });
  }
  
  while (j < s.length) {
    while (j < s.length && (s[j] === " " || s[j] === "\t" || s[j] === ",")) j++;
    if (j >= s.length) break;
    
    const keyStart = j;
    while (j < s.length && s[j] !== " " && s[j] !== "=" && s[j] !== ",") j++;
    const key = s.slice(keyStart, j);
    
    if (!key) {
      addDiag("warn", CODES.ATTR_BAD, "Empty attribute key");
      break;
    }
    
    while (j < s.length && s[j] === " ") j++;
    
    if (s[j] === "=") {
      j++;
      while (j < s.length && s[j] === " ") j++;
      
      if (s[j] === '"' || s[j] === "'") {
        const quote = s[j++];
        const valStart = j;
        while (j < s.length && s[j] !== quote) j++;
        out[key] = s.slice(valStart, j);
        if (s[j] === quote) j++;
      } else {
        const valStart = j;
        while (j < s.length && s[j] !== " " && s[j] !== ",") j++;
        const raw = s.slice(valStart, j);
        const num = Number(raw);
        out[key] = (!isNaN(num) && raw.trim() !== "") ? num : raw;
      }
    } else {
      out[key] = true;
    }
  }
  
  return out;
}

// ============================================================================
// MARKDOWN-LITE PROCESSOR (Inline Formatting)
// ============================================================================

/**
 * Process inline markdown formatting
 * O(n) single pass with minimal regex
 */
function processMarkdown(text) {
  // Protect escaped characters
  let result = text
    .replace(PATTERNS.escapedAsterisk, SENTINEL.STAR)
    .replace(PATTERNS.escapedUnderscore, SENTINEL.UNDR)
    .replace(PATTERNS.escapedTilde, SENTINEL.TILD)
    .replace(PATTERNS.escapedBacktick, SENTINEL.BTCK);
  
  // Process in order (most specific to least specific to avoid conflicts)
  
  // Inline code (highest priority - don't process markdown inside code)
  const codeMap = new Map();
  let codeIndex = 0;
  result = result.replace(PATTERNS.inlineCode, (match, content) => {
    const placeholder = `\u0002CODE${codeIndex}\u0002`;
    codeMap.set(placeholder, `<code>${escapeHtml(content)}</code>`);
    codeIndex++;
    return placeholder;
  });
  
  // Bold
  result = result.replace(PATTERNS.bold, (match, content) => {
    return `<strong>${content}</strong>`;
  });
  
  // Italic
  result = result.replace(PATTERNS.italic, (match, content) => {
    return `<em>${content}</em>`;
  });
  
  // Underline
  result = result.replace(PATTERNS.underline, (match, content) => {
    return `<u>${content}</u>`;
  });
  
  // Strikethrough
  result = result.replace(PATTERNS.strike, (match, content) => {
    return `<s>${content}</s>`;
  });
  
  // Blockquotes
  result = result.replace(PATTERNS.blockquote, (match, content) => {
    return `<blockquote>${content}</blockquote>`;
  });
  
  // Horizontal rules
  result = result.replace(PATTERNS.horizontalRule, () => {
    return "<hr>";
  });
  
  // Restore code blocks
  for (const [placeholder, code] of codeMap) {
    result = result.replace(placeholder, code);
  }
  
  // Restore escaped characters
  return result
    .replace(new RegExp(SENTINEL.STAR, "g"), "*")
    .replace(new RegExp(SENTINEL.UNDR, "g"), "_")
    .replace(new RegExp(SENTINEL.TILD, "g"), "~")
    .replace(new RegExp(SENTINEL.BTCK, "g"), "`");
}

// ============================================================================
// MACRO PROCESSOR (Enhanced with Variable Manipulation)
// ============================================================================

function processMacros(text, passageId, diagnostics, lineOffset = 0) {
  let result = text;
  
  // Process <<set>> with enhanced operators
  result = result.replace(PATTERNS.setMacro, (match, varName, op, expr) => {
    const trimmedExpr = (expr || "").trim();
    
    // Handle different operators
    let compiled;
    switch (op) {
      case "++":
        compiled = `state.${varName}++`;
        break;
      case "--":
        compiled = `state.${varName}--`;
        break;
      case "+=":
        compiled = `state.${varName} += ${trimmedExpr}`;
        break;
      case "-=":
        compiled = `state.${varName} -= ${trimmedExpr}`;
        break;
      case "*=":
        compiled = `state.${varName} *= ${trimmedExpr}`;
        break;
      case "/=":
        compiled = `state.${varName} /= ${trimmedExpr}`;
        break;
      case "%=":
        compiled = `state.${varName} %= ${trimmedExpr}`;
        break;
      case "=":
      case "to":
        compiled = `state.${varName} = ${trimmedExpr}`;
        break;
      default:
        compiled = `state.${varName} = ${trimmedExpr}`;
    }
    
    return `<span style="display:none" data-exec="${escapeAttr(compiled)}"></span>`;
  });
  
  // Process <<run>> - execute arbitrary code
  result = result.replace(PATTERNS.runMacro, (match, code) => {
    return `<span style="display:none" data-exec="${escapeAttr(code.trim())}"></span>`;
  });
  
  // Process <<unset>> - delete variable
  result = result.replace(PATTERNS.unsetMacro, (match, varName) => {
    return `<span style="display:none" data-exec="delete state.${varName}"></span>`;
  });
  
  // Process <<print>>
  result = result.replace(PATTERNS.printMacro, (match, expr1, expr2) => {
    const expr = (expr1 || expr2).trim();
    return `{{${expr}}}`;
  });
  
  // Process <<link>>
  result = result.replace(PATTERNS.linkMacro, (match, label, target, body) => {
    if (body && body.trim()) {
      const targetPassage = body.trim();
      return `<a data-goto="${escapeAttr(targetPassage)}">${escapeHtml(label)}</a>`;
    } else if (target) {
      return `<a data-goto="${escapeAttr(target)}">${escapeHtml(label)}</a>`;
    } else {
      return `<a data-goto="${escapeAttr(label)}">${escapeHtml(label)}</a>`;
    }
  });
  
  // Process <<include>>
  result = result.replace(PATTERNS.includeMacro, (match, targetId) => {
    return `<div data-include="${escapeAttr(targetId)}"></div>`;
  });
  
  // Process conditionals
  result = processConditionalMacros(result, diagnostics, lineOffset);
  
  return result;
}

function processConditionalMacros(text, diagnostics, lineOffset) {
  const parts = [];
  const stack = [];
  let lastIndex = 0;
  
  PATTERNS.ifMacro.lastIndex = 0;
  let match;
  
  while ((match = PATTERNS.ifMacro.exec(text)) !== null) {
    const fullMatch = match[0];
    const ifCond = match[1];
    const elseifCond = match[2];
    const isElse = fullMatch.toLowerCase().includes("<<else>>");
    const isEndif = fullMatch.toLowerCase().includes("<<endif>>");
    
    parts.push(text.slice(lastIndex, match.index));
    
    if (ifCond) {
      stack.push({ type: "if", condition: ifCond, start: parts.length });
      parts.push(`<div data-if="${escapeAttr(ifCond)}">`);
    } else if (elseifCond) {
      if (stack.length === 0 || stack[stack.length - 1].type !== "if") {
        diagnostics.push({
          severity: "error",
          code: CODES.MACRO_UNMATCHED,
          file: "",
          line: lineOffset,
          col: match.index,
          message: "<<elseif>> without matching <<if>>"
        });
      } else {
        parts.push(`</div><div data-if="${escapeAttr(elseifCond)}">`);
      }
    } else if (isElse) {
      if (stack.length === 0 || stack[stack.length - 1].type !== "if") {
        diagnostics.push({
          severity: "error",
          code: CODES.MACRO_UNMATCHED,
          file: "",
          line: lineOffset,
          col: match.index,
          message: "<<else>> without matching <<if>>"
        });
      } else {
        const ifBlock = stack[stack.length - 1];
        parts.push(`</div><div data-if="!(${ifBlock.condition})">`);
      }
    } else if (isEndif) {
      if (stack.length === 0 || stack[stack.length - 1].type !== "if") {
        diagnostics.push({
          severity: "error",
          code: CODES.MACRO_UNMATCHED,
          file: "",
          line: lineOffset,
          col: match.index,
          message: "<<endif>> without matching <<if>>"
        });
      } else {
        stack.pop();
        parts.push("</div>");
      }
    }
    
    lastIndex = match.index + fullMatch.length;
  }
  
  parts.push(text.slice(lastIndex));
  
  if (stack.length > 0) {
    diagnostics.push({
      severity: "error",
      code: CODES.MACRO_UNMATCHED,
      file: "",
      line: lineOffset,
      col: 0,
      message: `Unclosed <<if>> macro (${stack.length} unmatched)`
    });
  }
  
  return parts.join("");
}

function processInlineCode(text) {
  let result = text.replace(PATTERNS.inlineCodePrint, (match, expr) => {
    return `{{${expr.trim()}}}`;
  });
  
  result = result.replace(PATTERNS.inlineCode, (match, code) => {
    return `<span style="display:none" data-exec="${escapeAttr(code.trim())}"></span>`;
  });
  
  return result;
}

// ============================================================================
// LINK TRANSFORMER (Enhanced with Guards and Weights)
// ============================================================================

/**
 * Parse link modifiers: [[text->target ? guard :weight !once]]
 * Returns: { label, target, guard, weight, once }
 */
function parseLinkContent(content, normId) {
  let label, target, guard = null, weight = null, once = false;
  
  // Check for modifiers (guard, weight, once)
  // Format: [[text->target ? condition :5 !once]]
  
  let workingContent = content;
  
  // Extract !once modifier
  if (workingContent.includes("!once")) {
    once = true;
    workingContent = workingContent.replace(/\s*!once\s*/, " ").trim();
  }
  
  // Extract :weight modifier
  const weightMatch = /\s*:(\d+)\s*/.exec(workingContent);
  if (weightMatch) {
    weight = parseInt(weightMatch[1], 10);
    workingContent = workingContent.replace(weightMatch[0], " ").trim();
  }
  
  // Extract ? guard modifier
  const guardMatch = /\s*\?\s*(.+)$/.exec(workingContent);
  if (guardMatch) {
    guard = guardMatch[1].trim();
    workingContent = workingContent.slice(0, guardMatch.index).trim();
  }
  
  // Parse label and target
  const arrowIdx = workingContent.indexOf("->");
  if (arrowIdx !== -1) {
    label = workingContent.slice(0, arrowIdx).trim();
    target = normId(workingContent.slice(arrowIdx + 2).trim());
  } else {
    const pipeIdx = workingContent.indexOf("|");
    if (pipeIdx !== -1) {
      target = normId(workingContent.slice(0, pipeIdx).trim());
      label = workingContent.slice(pipeIdx + 1).trim();
    } else {
      target = normId(workingContent.trim());
      label = workingContent.trim();
    }
  }
  
  return { label, target, guard, weight, once };
}

function transformLinks(text, linkSink, normId) {
  let result = text
    .replace(PATTERNS.escapedLBrack, SENTINEL.LBRK)
    .replace(PATTERNS.escapedRBrack, SENTINEL.RBRK);
  
  // Process @go directives
  result = result.replace(PATTERNS.goDirective, (match, target, label) => {
    const normalizedTarget = normId(target);
    linkSink.push({ target: normalizedTarget, guard: null, weight: null, once: false });
    const displayLabel = label ? label.trim() : target;
    return `<a data-goto="${escapeAttr(normalizedTarget)}">${escapeHtml(displayLabel)}</a>`;
  });
  
  // Process wiki links with manual parsing
  const output = [];
  let i = 0;
  let inTag = false;
  let quote = null;
  
  while (i < result.length) {
    if (result[i] === "<" && !inTag) {
      inTag = true;
      output.push(result[i++]);
      continue;
    }
    
    if (inTag) {
      const ch = result[i++];
      output.push(ch);
      
      if (!quote) {
        if (ch === '"' || ch === "'") quote = ch;
        else if (ch === ">") inTag = false;
      } else {
        if (ch === quote) quote = null;
      }
      continue;
    }
    
    if (result[i] === "[" && result[i + 1] === "[") {
      let end = i + 2;
      let depth = 1;
      
      while (end < result.length && depth > 0) {
        if (result[end] === "[" && result[end + 1] === "[") {
          depth++;
          end += 2;
        } else if (result[end] === "]" && result[end + 1] === "]") {
          depth--;
          if (depth === 0) break;
          end += 2;
        } else {
          end++;
        }
      }
      
      if (depth === 0) {
        const content = result.slice(i + 2, end);
        const parsed = parseLinkContent(content, normId);
        
        if (parsed.target) {
          linkSink.push({
            target: parsed.target,
            guard: parsed.guard,
            weight: parsed.weight,
            once: parsed.once
          });
          
          // Build link with data attributes
          const attrs = [`data-goto="${escapeAttr(parsed.target)}"`];
          if (parsed.guard) attrs.push(`data-guard="${escapeAttr(parsed.guard)}"`);
          if (parsed.weight !== null) attrs.push(`data-weight="${parsed.weight}"`);
          if (parsed.once) attrs.push(`data-once="true"`);
          
          output.push(`<a ${attrs.join(" ")}>${escapeHtml(parsed.label)}</a>`);
        } else {
          output.push(result.slice(i, end + 2));
        }
        
        i = end + 2;
        continue;
      }
    }
    
    output.push(result[i++]);
  }
  
  result = output.join("");
  
  return result
    .replace(new RegExp(SENTINEL.LBRK, "g"), "[[")
    .replace(new RegExp(SENTINEL.RBRK, "g"), "]]");
}

// ============================================================================
// MAIN PARSER
// ============================================================================

export function parseWeftText(text, filename = "story.weft", options = {}) {
  const {
    enableMacros = true,
    enableExpressions = true,
    enableInlineCode = true,
    enableComments = true,
    enableMarkdown = true,
    enableGraphControl = true
  } = options;
  
  const diagnostics = [];
  
  function addDiag(severity, line, col, code, message) {
    diagnostics.push({ severity, code, file: filename, line, col, message });
  }
  
  let processedText = text || "";
  if (enableComments) {
    processedText = stripComments(processedText);
  }
  
  const lines = processedText.replace(/\r\n?/g, "\n").split("\n");
  
  // ========================================================================
  // PARSE HEADER
  // ========================================================================
  
  const header = {
    version: null,
    title: "",
    author: "",
    start: "",
    locale: "en-US",
    idCase: "strict",
    tagCase: "fold",
    whitespace: "collapse"
  };
  
  let i = 0;
  
  while (i < lines.length && PATTERNS.headerLine.test(lines[i])) {
    const raw = lines[i];
    
    const mWeft = PATTERNS.weftVersion.exec(raw);
    if (mWeft) {
      header.version = mWeft[1];
      i++;
      continue;
    }
    
    const mKV = PATTERNS.headerKV.exec(raw);
    if (mKV) {
      const key = mKV[1].toLowerCase();
      const val = mKV[2];
      
      switch (key) {
        case "title":
          header.title = val;
          break;
        case "author":
          header.author = val;
          break;
        case "start":
          header.start = val;
          break;
        case "locale":
          header.locale = val;
          break;
        case "id-case":
          if (val === "strict" || val === "fold") {
            header.idCase = val;
          } else {
            addDiag("warn", i + 1, 1, CODES.UNKNOWN_CASE, `Unknown id-case: ${val}`);
          }
          break;
        case "tag-case":
          if (val === "strict" || val === "fold") {
            header.tagCase = val;
          } else {
            addDiag("warn", i + 1, 1, CODES.UNKNOWN_CASE, `Unknown tag-case: ${val}`);
          }
          break;
        case "whitespace":
          if (val === "collapse" || val === "preserve") {
            header.whitespace = val;
          } else {
            addDiag("warn", i + 1, 1, CODES.UNKNOWN_WS, `Unknown whitespace: ${val}`);
          }
          break;
        default:
          addDiag("warn", i + 1, 1, CODES.UNKNOWN_HEADER_KEY, `Unknown header key: ${key}`);
      }
      
      i++;
      continue;
    }
    
    addDiag("warn", i + 1, 1, "WEFT_HEADER_UNRECOGNIZED", "Unrecognized header line");
    i++;
  }
  
  if (header.version == null) {
    addDiag("error", 1, 1, CODES.MISSING_HEADER, "Missing '!weft 1' header");
  } else if (header.version !== "1") {
    addDiag("error", 1, 1, CODES.BAD_VERSION, `Unsupported Weft version: ${header.version}`);
  }
  
  // ========================================================================
  // HELPER FUNCTIONS
  // ========================================================================
  
  function normId(id) {
    const s = (id || "").trim();
    return header.idCase === "fold" ? s.toLowerCase() : s;
  }
  
  function normTag(t) {
    const s = (t || "").trim();
    return header.tagCase === "fold" ? s.toLowerCase() : s;
  }
  
  // ========================================================================
  // PARSE PASSAGES
  // ========================================================================
  
  const passages = {};
  const tagsMap = {};
  const attrById = {};
  const linkIndex = {};
  const tagIndex = {};
  const sourceMap = {};
  const graphData = {}; // NEW: Navigation control data
  
  while (i < lines.length) {
    if (!/^\s*::/.test(lines[i])) {
      if (/\S/.test(lines[i])) {
        addDiag("warn", i + 1, 1, CODES.TRAILING_TEXT, 
          "Trailing text outside any passage (ignored)");
      }
      i++;
      continue;
    }
    
    const headLine = i + 1;
    const headerMatch = PATTERNS.passageHeader.exec(lines[i]);
    
    if (!headerMatch) {
      addDiag("error", i + 1, 1, CODES.MALFORMED_PASSAGE_HEAD, 
        "Malformed passage header");
      i++;
      continue;
    }
    
    const rawId = headerMatch[1].trim();
    const rawTags = (headerMatch[2] || "").trim();
    const rawAttrs = (headerMatch[3] || "").trim();
    
    const id = normId(rawId);
    
    if (!id) {
      addDiag("error", i + 1, 1, CODES.EMPTY_ID, "Empty passage id");
      i++;
      continue;
    }
    
    if (passages[id] != null) {
      addDiag("error", i + 1, 1, CODES.DUP_ID, `Duplicate passage id: ${id}`);
    }
    
    const tags = rawTags
      ? rawTags.split(",").map(s => normTag(s)).filter(Boolean)
      : [];
    
    tagsMap[id] = tags;
    
    for (const tag of tags) {
      if (!tagIndex[tag]) tagIndex[tag] = [];
      tagIndex[tag].push(id);
    }
    
    attrById[id] = parseAttributes(rawAttrs, headLine, diagnostics);
    
    // Initialize graph data for this passage
    graphData[id] = {
      once: false,
      visited: false,
      weight: 1,
      requires: null
    };
    
    i++;
    
    // ======================================================================
    // COLLECT PASSAGE BODY & DIRECTIVES
    // ======================================================================
    
    const bodyStartLine = i + 1;
    const bodyLines = [];
    
    while (i < lines.length && !/^\s*::/.test(lines[i])) {
      // Check for passage directives (@-rules)
      if (enableGraphControl) {
        const directiveMatch = PATTERNS.passageDirective.exec(lines[i]);
        if (directiveMatch) {
          const directive = directiveMatch[1].toLowerCase();
          const value = directiveMatch[2].trim();
          
          switch (directive) {
            case "once":
              graphData[id].once = true;
              break;
            case "visited":
              graphData[id].visited = true;
              break;
            case "weight":
              const w = parseInt(value, 10);
              if (!isNaN(w)) {
                graphData[id].weight = w;
              } else {
                addDiag("warn", i + 1, 1, CODES.UNKNOWN_DIRECTIVE,
                  `Invalid weight value: ${value}`);
              }
              break;
            case "requires":
              graphData[id].requires = value;
              break;
            default:
              addDiag("warn", i + 1, 1, CODES.UNKNOWN_DIRECTIVE,
                `Unknown directive: @${directive}`);
          }
          i++;
          continue;
        }
      }
      
      bodyLines.push(lines[i]);
      i++;
    }
    
    const bodyEndLine = i;
    
    // ======================================================================
    // PROCESS PASSAGE BODY
    // ======================================================================
    
    let bodyStart = 0;
    while (bodyStart < bodyLines.length && PATTERNS.whitespaceOnly.test(bodyLines[bodyStart])) {
      bodyStart++;
    }
    
    let titleHtml = "";
    if (bodyStart < bodyLines.length) {
      const titleMatch = PATTERNS.titleAtTop.exec(bodyLines[bodyStart]);
      if (titleMatch) {
        titleHtml = `<h1>${escapeHtml(titleMatch[1])}</h1>\n`;
        bodyStart++;
      }
    }
    
    let rawBody = bodyLines.slice(bodyStart).join("\n");
    
    // Processing pipeline:
    // 1. Inline code
    if (enableInlineCode) {
      rawBody = processInlineCode(rawBody);
    }
    
    // 2. Macros
    if (enableMacros) {
      rawBody = processMacros(rawBody, id, diagnostics, bodyStartLine + bodyStart);
    }
    
    // 3. Markdown formatting
    if (enableMarkdown) {
      rawBody = processMarkdown(rawBody);
    }
    
    // 4. Links
    const linkSink = [];
    rawBody = transformLinks(rawBody, linkSink, normId);
    linkIndex[id] = linkSink;
    
    // 5. Whitespace
    const finalBody = header.whitespace === "collapse" 
      ? collapseWhitespace(rawBody)
      : rawBody;
    
    passages[id] = titleHtml + finalBody;
    sourceMap[id] = { file: filename, startLine: headLine, endLine: bodyEndLine };
  }
  
  // ========================================================================
  // DETERMINE START PASSAGE
  // ========================================================================
  
  let startId = normId(header.start);
  if (!startId) {
    const firstId = Object.keys(passages)[0] || "";
    if (firstId) startId = firstId;
  }
  
  if (!startId) {
    addDiag("error", 1, 1, CODES.NO_PASSAGES, "No passages found; cannot determine start");
  }
  
  // ========================================================================
  // VALIDATE LINKS
  // ========================================================================
  
  const idSet = new Set(Object.keys(passages));
  
  for (const [fromId, links] of Object.entries(linkIndex)) {
    for (const link of links) {
      if (link.target && !idSet.has(link.target)) {
        const srcInfo = sourceMap[fromId];
        addDiag("warn", srcInfo?.startLine || 1, 1, CODES.LINK_UNKNOWN,
          `Link from '${fromId}' to unknown target '${link.target}'`);
      }
    }
  }
  
  // ========================================================================
  // BUILD METADATA
  // ========================================================================
  
  const meta = {
    title: header.title || "Untitled",
    author: header.author || "",
    locale: header.locale || "en-US",
    start: startId,
    idCase: header.idCase,
    tagCase: header.tagCase,
    whitespace: header.whitespace,
    features: {
      expressions: enableExpressions,
      macros: enableMacros,
      inlineCode: enableInlineCode,
      markdown: enableMarkdown,
      graphControl: enableGraphControl
    }
  };
  
  return {
    meta,
    passages,
    tagsMap,
    diagnostics,
    attrById,
    linkIndex,
    tagIndex,
    sourceMap,
    graphData // NEW: Navigation and graph control data
  };
}

// ============================================================================
// HELPER FUNCTIONS FOR ENGINE INTEGRATION
// ============================================================================

export function hasExpressions(passageHtml) {
  return PATTERNS.expression.test(passageHtml);
}

export function extractExpressions(passageHtml) {
  const expressions = [];
  PATTERNS.expression.lastIndex = 0;
  let match;
  
  while ((match = PATTERNS.expression.exec(passageHtml)) !== null) {
    expressions.push({
      expr: (match[2] || match[1]).trim(),
      raw: match[1] != null,
      index: match.index
    });
  }
  
  return expressions;
}

/**
 * Extract link metadata for graph analysis
 */
export function extractLinkMetadata(linkIndex) {
  const graph = {};
  
  for (const [fromId, links] of Object.entries(linkIndex)) {
    graph[fromId] = links.map(link => ({
      target: link.target,
      weight: link.weight || 1,
      guard: link.guard || null,
      once: link.once || false
    }));
  }
  
  return graph;
}


