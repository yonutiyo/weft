// core/export-single.js
// Standalone HTML exporter that embeds a v2c pack + inline runtime
// Creates self-contained, single-file HTML games with all features included

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Strips ES6 module syntax (import/export) from source code
 * to make it compatible with inline <script> tags
 * @param {string} src - Source code to process
 * @returns {string} Code with module syntax removed
 */
function stripModuleSyntax(src) {
  return String(src)
    .replace(/^\s*import\s+[^;]+;?\s*$/gm, "")                           // Remove import statements
    .replace(/\bexport\s+(?=(?:async\s+)?function|const|class|let|var)/g, "") // Remove export keywords
    .replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, "")                       // Remove export {...} blocks
    .replace(/^\s*export\s+default\s+/gm, "");                           // Remove export default
}

/**
 * Makes JSON safe for embedding in HTML by escaping special characters
 * @param {string} jsonString - JSON string to escape
 * @returns {string} HTML-safe JSON string
 */
function safeForHtml(jsonString) {
  return String(jsonString)
    .replace(/</g, "&lt;")
    .replace(/<\/script/gi, "<\\x2Fscript");
}

// ============================================================================
// HTML GENERATION HELPERS
// ============================================================================

/**
 * Generates the default CSS for the exported game
 * @returns {string} CSS string
 */
function getDefaultCss() {
  return [
    "html,body{height:100%}",
    "body{margin:0;background:#0b0b0c;color:#e5e7eb;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.6}",
    "#app{min-height:100vh;padding:16px}",
    "@media (prefers-color-scheme: light){body{background:#f7f7f7;color:#111827}#app{background:#f7f7f7;color:#111827}}"
  ].join("");
}

/**
 * Combines and processes runtime sources into a single script
 * @param {Array} runtimeSources - Array of {name, code} objects
 * @returns {string} Combined runtime code
 */
function combineRuntimeSources(runtimeSources) {
  if (!Array.isArray(runtimeSources) || runtimeSources.length === 0) {
    return "";
  }

  return runtimeSources
    .map(({ name, code }) => {
      const processedCode = stripModuleSyntax(String(code || ""));
      return `/* ================ ${name} ================ */\n${processedCode}\n`;
    })
    .join("\n");
}

/**
 * Generates a fallback provider function in case pack-provider.js wasn't included
 * @returns {string} Fallback provider code
 */
function getProviderFallback() {
  return `
(function() {
  'use strict';
  if (typeof createJsonProvider !== 'function') {
    window.createJsonProvider = function(v2c) {
      if (!v2c || v2c.fmt !== 'v2c') {
        throw new Error('createJsonProvider: v2c pack required');
      }
      
      var map = Object.create(null);
      var ids = v2c.ids || [];
      var html = v2c.html || [];
      
      for (var i = 0; i < ids.length; i++) {
        map[ids[i]] = html[i] || '';
      }
      
      return {
        get: async function(id) {
          return Object.prototype.hasOwnProperty.call(map, id) ? map[id] : null;
        }
      };
    };
  }
})();
`.trim();
}

/**
 * Generates a helper function that waits for a condition before executing callback
 * @returns {string} Wait helper code
 */
function getWaitHelper() {
  return `
function __waitFor(cond, cb) {
  var t0 = performance.now();
  (function poll() {
    try {
      if (cond()) return cb();
    } catch (e) {
      // Ignore errors during condition check
    }
    if (performance.now() - t0 > 3000) {
      return cb(new Error('timeout waiting for condition'));
    }
    requestAnimationFrame(poll);
  })();
}
`.trim();
}

/**
 * Generates the bootstrap code that initializes the game
 * @returns {string} Bootstrap code
 */
function getBootstrapCode() {
  return `
(function() {
  'use strict';
  
  ${getWaitHelper()}
  
  function start() {
    try {
      // Get DOM elements
      var holder = document.getElementById('app');
      if (!holder) throw new Error('#app element not found');
      
      var storyScript = document.getElementById('story-pack');
      if (!storyScript) throw new Error('#story-pack script not found');
      
      // Parse the story pack
      var PACK = JSON.parse(storyScript.textContent);
      
      // Verify required functions are available
      if (typeof createEngine !== 'function') {
        throw new Error('createEngine function not found');
      }
      if (typeof createJsonProvider !== 'function') {
        throw new Error('createJsonProvider function not found');
      }
      
      // Initialize the engine
      var engine = createEngine({
        appSelector: '#app',
        cacheSize: 200,
        useHashRouting: true
      });
      
      // Create and attach the content provider
      var provider = createJsonProvider(PACK);
      engine.useContentProvider(provider);
      
      // Start the game
      var startPassage = PACK.start || 'start';
      engine.start(startPassage);
      
      // Attach optional UI features after next frame
      requestAnimationFrame(function() {
        // Attach sidebar if available
        try {
          if (typeof attachSidebar === 'function') {
            attachSidebar(engine);
          }
        } catch (e) {
          console.debug('[export-single] sidebar attachment failed:', e);
        }
        
        // Attach debug overlay if available
        try {
          if (typeof attachDebugOverlay === 'function') {
            attachDebugOverlay(engine, {
              hotkey: '\`',
              startOpen: false,
              corner: 'right'
            });
          }
        } catch (e) {
          console.debug('[export-single] debug overlay attachment failed:', e);
        }
      });
      
    } catch (e) {
      console.error('[export-single] Boot error:', e);
      var el = document.getElementById('app');
      if (el) {
        el.innerHTML = 
          '<h1>Boot Error</h1>' +
          '<pre style="white-space:pre-wrap">' + 
          String(e && e.stack || e) + 
          '</pre>';
      }
    }
  }
  
  // Wait for DOM to be ready, then wait for #app to exist, then start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      __waitFor(function() {
        return !!document.getElementById('app');
      }, function() {
        start();
      });
    });
  } else {
    __waitFor(function() {
      return !!document.getElementById('app');
    }, function() {
      start();
    });
  }
})();
`.trim();
}

// ============================================================================
// MAIN EXPORT FUNCTION
// ============================================================================

/**
 * Builds a standalone HTML file containing a complete game with embedded runtime
 * 
 * @param {Object} options - Configuration options
 * @param {Object} options.v2c - The v2c pack containing the game data
 * @param {Array} options.runtimeSources - Array of {name, code} objects for runtime files
 * @param {string} [options.title] - Game title (defaults to v2c.meta.title or "Story")
 * @param {string} [options.inlineCss] - Additional CSS to include
 * @returns {string} Complete HTML document as a string
 * @throws {Error} If v2c is missing or invalid
 */
export function buildSingleFileHtml({ v2c, runtimeSources, title, inlineCss = "" }) {
  // Validate input
  if (!v2c || v2c.fmt !== "v2c") {
    throw new Error("buildSingleFileHtml: valid v2c pack required");
  }
  
  // Prepare document title (escape HTML)
  const docTitle = String(title || v2c?.meta?.title || "Story")
    .replace(/</g, "&lt;");
  
  // Combine CSS
  const baseCss = getDefaultCss();
  const combinedCss = baseCss + (inlineCss ? "\n" + inlineCss : "");
  
  // Combine all runtime sources
  const combinedRuntime = combineRuntimeSources(runtimeSources);
  
  // Build the HTML document
  const html = [];
  
  // Document structure
  html.push("<!doctype html>");
  html.push("<html lang=\"en\">");
  
  // Head section
  html.push("<head>");
  html.push('  <meta charset="utf-8">');
  html.push('  <meta name="viewport" content="width=device-width,initial-scale=1">');
  html.push(`  <title>${docTitle}</title>`);
  html.push(`  <style>${combinedCss}</style>`);
  html.push("</head>");
  
  // Body section
  html.push("<body>");
  html.push('  <div id="app">');
  html.push('    <noscript>Please enable JavaScript to play this game.</noscript>');
  html.push('  </div>');
  
  // Embedded story pack (as JSON)
  html.push('  <script id="story-pack" type="application/json">');
  html.push(safeForHtml(JSON.stringify(v2c)));
  html.push('  </script>');
  
  // Combined runtime and bootstrap
  html.push('  <script>');
  html.push('/* ============================================================================ */');
  html.push('/* RUNTIME CODE                                                               */');
  html.push('/* ============================================================================ */');
  html.push(combinedRuntime);
  html.push('');
  html.push('/* ============================================================================ */');
  html.push('/* PROVIDER FALLBACK                                                          */');
  html.push('/* ============================================================================ */');
  html.push(getProviderFallback());
  html.push('');
  html.push('/* ============================================================================ */');
  html.push('/* BOOTSTRAP                                                                  */');
  html.push('/* ============================================================================ */');
  html.push(getBootstrapCode());
  html.push('  </script>');
  
  html.push("</body>");
  html.push("</html>");
  
  return html.join("\n");
}


