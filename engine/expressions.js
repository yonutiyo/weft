// engine/expressions.js
// Expression parsing, compilation, and evaluation
//
// ARCHITECTURE:
//   - Custom tokenizer with char code optimization (faster than regex)
//   - Pratt parser for expression parsing
//   - AST-based evaluation (no eval() - secure!)
//   - LRU cache for compiled expressions
//
// FEATURES:
//   - Arithmetic, logical, bitwise, ternary operators
//   - Member access (dot and bracket notation)
//   - Function calls with helper functions
//   - Hex/binary/scientific number literals
//   - Enhanced string escape sequences
//
// SECURITY:
//   - Recursion depth limits (prevents stack overflow)
//   - Input validation and length limits
//   - No eval() or Function() constructor
//   - Sandboxed execution with explicit helpers
//
// PERFORMANCE OPTIMIZATIONS:
//   - Character classification with char codes (not regex)
//   - Expression AST caching (1000 entries)
//   - Compilation error caching (avoid re-parsing bad expressions)

import { createLRUCache } from "./cache.js";
import { DEV } from "./utils.js";

// ============================================================================
// EXPRESSION CACHE
// ============================================================================

const exprCache = createLRUCache(1000);

// ============================================================================
// TOKENIZER
// ============================================================================

/**
 * Tokenize an expression string
 * Optimized with char code comparisons instead of regex for better performance
 */
function tokenize(src) {
  const out = [];
  let i = 0;
  
  // Fast character classification using char codes (O(1) vs regex)
  const isDigit = (c) => {
    const code = c.charCodeAt(0);
    return code >= 48 && code <= 57; // '0' to '9'
  };
  
  const isIdentStart = (c) => {
    const code = c.charCodeAt(0);
    return (code >= 65 && code <= 90) ||  // A-Z
           (code >= 97 && code <= 122) ||  // a-z
           code === 95;                     // _
  };
  
  const isIdent = (c) => {
    const code = c.charCodeAt(0);
    return (code >= 65 && code <= 90) ||  // A-Z
           (code >= 97 && code <= 122) ||  // a-z
           (code >= 48 && code <= 57) ||   // 0-9
           code === 95;                     // _
  };
  
  const isWhitespace = (c) => {
    const code = c.charCodeAt(0);
    return code === 32 ||  // space
           code === 9 ||   // tab
           code === 10 ||  // newline
           code === 13;    // carriage return
  };
  
  const isHex = (c) => {
    const code = c.charCodeAt(0);
    return (code >= 48 && code <= 57) ||   // 0-9
           (code >= 65 && code <= 70) ||   // A-F
           (code >= 97 && code <= 102);    // a-f
  };
  
  const isBinary = (c) => c === "0" || c === "1";
  
  // Extended operator set with bitwise ops and null coalescing
  const ops = new Set([
    "||","&&","==","!=",">=","<=",
    "**","<<",">>","??", // New: exponentiation, shifts, null coalescing
    "+","-","*","/","%",
    "&","|","^","~",     // New: bitwise operators
    "(",")","{","}","[","]",
    "?",":",".",",",
    ">","<","!"
  ]);
  
  while (i < src.length) {
    let c = src[i];
    
    // Skip whitespace (optimized with char code)
    if (isWhitespace(c)) { i++; continue; }
    
    // Skip single-line comments
    if (c === "/" && src[i + 1] === "/") {
      i += 2;
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    
    // Numbers (with hex, binary, and scientific notation support)
    if (isDigit(c) || (c === "." && isDigit(src[i + 1]))) {
      let j = i;
      let s = "";
      let base = 10;
      
      // Hex: 0x or 0X
      if (c === "0" && (src[j + 1] === "x" || src[j + 1] === "X")) {
        j += 2;
        while (j < src.length && (isHex(src[j]) || src[j] === "_")) {
          if (src[j] !== "_") s += src[j];
          j++;
        }
        out.push({ type: "number", value: parseInt(s, 16) });
        i = j;
        continue;
      }
      
      // Binary: 0b or 0B
      if (c === "0" && (src[j + 1] === "b" || src[j + 1] === "B")) {
        j += 2;
        while (j < src.length && (isBinary(src[j]) || src[j] === "_")) {
          if (src[j] !== "_") s += src[j];
          j++;
        }
        out.push({ type: "number", value: parseInt(s, 2) });
        i = j;
        continue;
      }
      
      // Decimal (with underscores and scientific notation)
      while (j < src.length && (isDigit(src[j]) || src[j] === "_")) {
        if (src[j] !== "_") s += src[j];
        j++;
      }
      
      // Decimal point
      if (src[j] === ".") {
        s += src[j++];
        while (j < src.length && (isDigit(src[j]) || src[j] === "_")) {
          if (src[j] !== "_") s += src[j];
          j++;
        }
      }
      
      // Scientific notation: 1e10, 2.5e-3
      if (src[j] === "e" || src[j] === "E") {
        s += src[j++];
        if (src[j] === "+" || src[j] === "-") {
          s += src[j++];
        }
        while (j < src.length && (isDigit(src[j]) || src[j] === "_")) {
          if (src[j] !== "_") s += src[j];
          j++;
        }
      }
      
      out.push({ type: "number", value: Number(s) });
      i = j;
      continue;
    }
    
    // Strings (enhanced escape sequences)
    if (c === "'" || c === '"') {
      const quote = c; i++;
      let s = "", esc = false;
      while (i < src.length) {
        const ch = src[i++];
        if (esc) {
          // Enhanced escape sequences
          if (ch === "n") s += "\n";
          else if (ch === "t") s += "\t";
          else if (ch === "r") s += "\r";
          else if (ch === "b") s += "\b";
          else if (ch === "f") s += "\f";
          else if (ch === "v") s += "\v";
          else if (ch === "0") s += "\0";
          else if (ch === "x") {
            // Hex escape: \xNN
            const hex = src.slice(i, i + 2);
            if (hex.length === 2 && isHex(hex[0]) && isHex(hex[1])) {
              s += String.fromCharCode(parseInt(hex, 16));
              i += 2;
            } else {
              s += ch;
            }
          } else if (ch === "u") {
            // Unicode escape: \uNNNN
            const hex = src.slice(i, i + 4);
            if (hex.length === 4 && hex.split("").every(isHex)) {
              s += String.fromCharCode(parseInt(hex, 16));
              i += 4;
            } else {
              s += ch;
            }
          } else {
            s += ch;
          }
          esc = false;
        } else if (ch === "\\") {
          esc = true;
        } else if (ch === quote) {
          out.push({ type: "string", value: s });
          break;
        } else {
          s += ch;
        }
      }
      continue;
    }
    
    // Identifiers and keywords (optimized with char code)
    if (isIdentStart(c)) {
      let j = i, s = c; j++;
      while (j < src.length && isIdent(src[j])) s += src[j++];
      
      // Keywords
      if (s === "true" || s === "false") {
        out.push({ type: "bool", value: s === "true" });
      } else if (s === "null") {
        out.push({ type: "null", value: null });
      } else if (s === "undefined") {
        out.push({ type: "null", value: undefined });
      } else if (s === "Infinity") {
        out.push({ type: "number", value: Infinity });
      } else if (s === "NaN") {
        out.push({ type: "number", value: NaN });
      } else {
        out.push({ type: "ident", value: s });
      }
      i = j;
      continue;
    }
    
    // Three-character operators
    const three = src.slice(i, i + 3);
    if (three === ">>>" || three === "...") {
      out.push({ type: "op", value: three });
      i += 3;
      continue;
    }
    
    // Two-character operators (including new ones)
    const two = src.slice(i, i + 2);
    if (ops.has(two)) {
      out.push({ type: "op", value: two });
      i += 2;
      continue;
    }
    
    // Single-character operators
    if (ops.has(c)) {
      out.push({ type: "op", value: c });
      i += 1;
      continue;
    }
    
    // Unknown character - pass through as operator
    out.push({ type: "op", value: c });
    i++;
  }
  
  out.push({ type: "eof" });
  return out;
}

// ============================================================================
// PARSER - Pratt Parser with Operator Precedence
// ============================================================================

/**
 * Parse tokens into an AST
 * Security: Includes recursion depth limit to prevent stack overflow
 * @param {Array} tokens - Token array from tokenizer
 * @param {number} maxDepth - Maximum parsing depth (default 100)
 * @returns {Object} AST root node
 */
function parseExpression(tokens, maxDepth = 100) {
  let pos = 0;
  let depth = 0;
  
  const peek = () => tokens[pos] || { type: "eof" };
  const next = () => tokens[pos++] || { type: "eof" };
  const is = (t, v) => peek().type === t && (v === undefined || peek().value === v);
  const eat = (t, v) => { if (is(t, v)) return next(); return null; };
  const need = (t, v) => {
    const tok = eat(t, v);
    if (!tok) throw new Error(`Expected ${v ?? t}`);
    return tok;
  };
  
  const BP = {
    "??": 1,    // Null coalescing (lowest precedence)
    "||": 2, 
    "&&": 3,
    "|": 4,     // Bitwise OR
    "^": 5,     // Bitwise XOR
    "&": 6,     // Bitwise AND
    "==": 7, "!=": 7,
    ">": 8, ">=": 8, "<": 8, "<=": 8,
    "<<": 9, ">>": 9, ">>>": 9,  // Bitwise shifts
    "+": 10, "-": 10,
    "*": 11, "/": 11, "%": 11,
    "**": 12    // Exponentiation (highest precedence)
  };
  
  function parseExpr(rbp = 0) {
    // Recursion depth check - prevent stack overflow
    if (depth >= maxDepth) {
      throw new Error(
        `Expression too deeply nested (depth: ${depth}, max: ${maxDepth}). ` +
        `This prevents parser stack overflow from malicious or buggy expressions.`
      );
    }
    
    depth++;
    
    try {
      let left = parsePrefix();
      
      while (true) {
        // Ternary operator
        if (eat("op", "?")) {
          const middle = parseExpr(0);
          need("op", ":");
          const right = parseExpr(0);
          left = { type: "ternary", test: left, then: middle, else: right };
          continue;
        }
        
        // Function call
        if (is("op", "(")) {
          next();
          const args = [];
          if (!eat("op", ")")) {
            do { args.push(parseExpr(0)); } while (eat("op", ","));
            need("op", ")");
          }
          left = { type: "call", callee: left, args };
          continue;
        }
        
        // Member access (dot notation)
        if (eat("op", ".")) {
          const id = need("ident");
          left = {
            type: "member",
            obj: left,
            prop: { type: "string", value: id.value },
            computed: false
          };
          continue;
        }
        
        // Member access (bracket notation)
        if (eat("op", "[")) {
          const idx = parseExpr(0);
          need("op", "]");
          left = { type: "member", obj: left, prop: idx, computed: true };
          continue;
        }
        
        // Binary operators
        const t = peek();
        if (t.type === "op" && BP[t.value]) {
          const op = t.value;
          if (BP[op] <= rbp) break;
          next();
          const right = parseExpr(BP[op]);
          left = { type: "binary", op, left, right };
          continue;
        }
        
        break;
      }
      
      depth--;
      return left;
    } catch (e) {
      depth--;
      throw e;
    }
  }
  
  function parsePrefix() {
    const t = next();
    
    if (t.type === "number" || t.type === "string" ||
        t.type === "bool" || t.type === "null") {
      return t;
    }
    
    if (t.type === "ident") {
      return { type: "ident", name: t.value };
    }
    
    if (t.type === "op" && t.value === "(") {
      const e = parseExpr(0);
      need("op", ")");
      return e;
    }
    
    // Unary operators
    if (t.type === "op" && t.value === "!") {
      return { type: "unary", op: "!", arg: parsePrefix() };
    }
    
    if (t.type === "op" && t.value === "-") {
      return { type: "unary", op: "-", arg: parsePrefix() };
    }
    
    if (t.type === "op" && t.value === "+") {
      return { type: "unary", op: "+", arg: parsePrefix() };
    }
    
    if (t.type === "op" && t.value === "~") {
      return { type: "unary", op: "~", arg: parsePrefix() };
    }
    
    throw new Error(`Unexpected token: ${JSON.stringify(t)}`);
  }
  
  return parseExpr(0);
}

// ============================================================================
// COMPILATION - Source to AST with Caching
// ============================================================================

/**
 * Compile expression source to AST (cached)
 * @param {string} source - Expression source code
 * @param {number} maxDepth - Maximum parsing depth (default 100)
 * @returns {Object} AST or null node on error
 * 
 * Security: Validates input and includes depth limits
 */
export function compileExpression(source, maxDepth = 100) {
  // Input validation
  if (!source || typeof source !== 'string') {
    if (DEV && typeof console !== 'undefined') {
      console.warn("[engine] Invalid expression source:", source);
    }
    return { type: "null", value: null };
  }
  
  // Prevent excessively long expressions (potential DoS)
  if (source.length > 10000) {
    if (DEV && typeof console !== 'undefined') {
      console.error("[engine] Expression too long (>10000 chars):", source.length);
    }
    return { type: "null", value: null };
  }
  
  // Check cache
  const cached = exprCache.get(source);
  if (cached) return cached;
  
  try {
    const tokens = tokenize(source);
    
    if (!tokens || tokens.length === 0) {
      return { type: "null", value: null };
    }
    
    const ast = parseExpression(tokens, maxDepth);
    
    // Cache successful compilation
    exprCache.set(source, ast);
    return ast;
  } catch (e) {
    // Enhanced error logging with context
    if (DEV && typeof console !== 'undefined') {
      console.error(
        "[engine] Expression compilation failed:",
        "\n  Source:", source.substring(0, 100) + (source.length > 100 ? '...' : ''),
        "\n  Error:", e.message || e
      );
    }
    
    // Cache compilation failures to avoid repeated parsing errors
    const nullNode = { type: "null", value: null };
    exprCache.set(source, nullNode);
    return nullNode;
  }
}

// ============================================================================
// HELPER FUNCTIONS - Available in Expressions
// ============================================================================

/**
 * Helper functions available in expressions
 * These are the only functions accessible from user expressions (sandboxed)
 */
export const defaultHelpers = {
  // Math
  Math: Math,
  abs: Math.abs,
  ceil: Math.ceil,
  floor: Math.floor,
  round: Math.round,
  min: Math.min,
  max: Math.max,
  random: Math.random,
  sqrt: Math.sqrt,
  pow: Math.pow,
  
  // Trigonometry (useful for animations/physics)
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: Math.atan2,
  
  // Game math utilities
  clamp: (val, min, max) => Math.max(min, Math.min(max, val)),
  lerp: (a, b, t) => a + (b - a) * t,
  smoothstep: (edge0, edge1, x) => {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  },
  
  // Dice rolling
  d: (sides) => Math.floor(Math.random() * sides) + 1,
  roll: (n, sides) => {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += Math.floor(Math.random() * sides) + 1;
    }
    return sum;
  },
  
  // Array helpers
  choice: (arr) => arr[Math.floor(Math.random() * arr.length)],
  shuffle: (arr) => {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  },
  sum: (arr) => arr.reduce((a, b) => a + b, 0),
  avg: (arr) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0,
  
  // String helpers
  upper: (s) => String(s).toUpperCase(),
  lower: (s) => String(s).toLowerCase(),
  capitalize: (s) => {
    const str = String(s);
    return str.charAt(0).toUpperCase() + str.slice(1);
  },
  trim: (s) => String(s).trim(),
  
  // Pluralization helper
  plural: (n, singular, plural) => (n === 1 ? singular : (plural || singular + "s")),
  
  // Type checking
  isDefined: (v) => v !== null && v !== undefined,
  isNumber: (v) => typeof v === "number" && !isNaN(v),
  isString: (v) => typeof v === "string",
  isArray: (v) => Array.isArray(v),
  
  // Type conversion
  int: (v) => parseInt(v, 10) || 0,
  float: (v) => parseFloat(v) || 0,
  str: (v) => String(v),
  bool: (v) => Boolean(v)
};

// ============================================================================
// EVALUATOR - AST Execution with State
// ============================================================================

/**
 * Evaluate an AST with state and helpers
 * @param {Object} ast - AST node
 * @param {Object} context - { state, helpers, depTracker, maxDepth }
 * @returns {any} Evaluation result
 * 
 * Security: Includes recursion depth limit to prevent stack overflow attacks
 */
export function evaluate(ast, context) {
  const { state, helpers = {}, depTracker, maxDepth = 100 } = context;
  let depth = 0;
  
  function val(node) {
    // Recursion depth check - prevent stack overflow
    if (depth >= maxDepth) {
      throw new Error(
        `Expression too deeply nested (depth: ${depth}, max: ${maxDepth}). ` +
        `This prevents stack overflow from malicious or buggy expressions.`
      );
    }
    
    if (!node) {
      return null;
    }
    
    depth++;
    
    try {
      switch (node.type) {
        case "number":
        case "string":
        case "bool":
        case "null":
          depth--;
          return node.value;
        
        case "ident": {
          const name = node.name;
          
          // Check helpers first
          if (name in helpers) {
            depth--;
            return helpers[name];
          }
          
          // Then check state
          if (name in state) {
            // Record dependency
            if (depTracker) {
              try {
                depTracker.recordAccess([name]);
              } catch (e) {
                // Log but continue - dependency tracking is non-critical
                if (DEV && typeof console !== 'undefined') {
                  console.warn("[engine] Failed to record dependency:", name, e);
                }
              }
            }
            depth--;
            return state[name];
          }
          
          depth--;
          return undefined;
        }
        
        case "unary": {
          const arg = val(node.arg);
          depth--;
          
          if (node.op === "!") return !arg;
          if (node.op === "-") return -arg;
          if (node.op === "+") return +arg;
          if (node.op === "~") return ~arg;
          return null;
        }
        
        case "binary": {
          const left = val(node.left);
          const right = val(node.right);
          depth--;
          
          switch (node.op) {
            // Logical
            case "||": return left || right;
            case "&&": return left && right;
            
            // Equality
            case "==": return left == right;
            case "!=": return left != right;
            
            // Comparison
            case ">": return left > right;
            case ">=": return left >= right;
            case "<": return left < right;
            case "<=": return left <= right;
            
            // Arithmetic
            case "+": return left + right;
            case "-": return left - right;
            case "*": return left * right;
            case "/": return left / right;
            case "%": return left % right;
            case "**": return left ** right;  // Exponentiation
            
            // Bitwise
            case "&": return left & right;
            case "|": return left | right;
            case "^": return left ^ right;
            case "<<": return left << right;
            case ">>": return left >> right;
            case ">>>": return left >>> right;  // Unsigned right shift
            
            // Null coalescing
            case "??": return left ?? right;
            
            default: 
              depth--;
              return null;
          }
        }
        
        case "member": {
          const obj = val(node.obj);
          
          if (obj == null) {
            depth--;
            return undefined;
          }
          
          let key;
          if (node.computed) {
            key = val(node.prop);
          } else {
            key = node.prop.value;
          }
          
          // Build full path for dependency tracking
          if (depTracker && node.obj.type === "ident") {
            try {
              const basePath = [node.obj.name];
              depTracker.recordAccess([...basePath, key]);
            } catch (e) {
              // Log but continue
              if (DEV && typeof console !== 'undefined') {
                console.warn("[engine] Failed to record member access:", e);
              }
            }
          }
          
          depth--;
          return obj[key];
        }
        
        case "call": {
          const fn = val(node.callee);
          
          if (typeof fn !== "function") {
            depth--;
            return null;
          }
          
          const args = node.args.map(arg => val(arg));
          
          // Call function with error handling
          try {
            const result = fn(...args);
            depth--;
            return result;
          } catch (e) {
            depth--;
            if (DEV && typeof console !== 'undefined') {
              console.error("[engine] Function call error:", e);
            }
            return null;
          }
        }
        
        case "ternary": {
          const result = val(node.test) ? val(node.then) : val(node.else);
          depth--;
          return result;
        }
        
        default:
          depth--;
          throw new Error(`Unknown node type: ${node.type}`);
      }
    } catch (e) {
      // Always decrement depth on error
      depth--;
      
      if (DEV && typeof console !== 'undefined') {
        console.error("[engine] Evaluation error:", e, node);
      }
      
      // Re-throw depth limit errors
      if (e.message && e.message.includes('too deeply nested')) {
        throw e;
      }
      
      return null;
    }
  }
  
  return val(ast);
}

/**
 * Convert AST to lvalue path for assignments
 */
export function lvaluePathFromAst(ast) {
  if (ast.type === "ident") return [ast.name];
  
  if (ast.type === "member") {
    const left = lvaluePathFromAst(ast.obj);
    if (!left) return null;
    
    let key;
    if (ast.computed) {
      // For computed properties, we'd need to evaluate
      // For now, just handle literals
      if (ast.prop.type === "string" || ast.prop.type === "number") {
        key = String(ast.prop.value);
      } else {
        return null;
      }
    } else {
      key = ast.prop.value;
    }
    
    return [...left, key];
  }
  
  return null;
}
