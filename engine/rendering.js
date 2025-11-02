// engine/rendering.js
// DOM rendering and conditional logic

import { compileExpression, evaluate, defaultHelpers } from "./expressions.js";
import { escapeHtml } from "./utils.js";

/**
 * Create a renderer
 */
export function createRenderer(container, options = {}) {
  const { onRender } = options;
  
  let delegationAttached = false;
  
  /**
   * Apply conditional rendering (data-if, data-unless, data-if-not)
   * Optimized: batch DOM operations
   */
  function applyConditions(state) {
    const nodes = container.querySelectorAll("[data-if], [data-unless], [data-if-not]");
    const toRemove = [];
    
    for (const el of nodes) {
      const condIf = el.getAttribute("data-if");
      const condUnless = el.getAttribute("data-unless") ?? el.getAttribute("data-if-not");
      
      let keep = true;
      if (condIf != null) {
        try {
          const ast = compileExpression(condIf);
          keep = !!evaluate(ast, { state, helpers: defaultHelpers });
        } catch (e) {
          console.error("[engine] data-if error:", condIf, e);
          keep = false;
        }
      }
      if (condUnless != null) {
        try {
          const ast = compileExpression(condUnless);
          const result = evaluate(ast, { state, helpers: defaultHelpers });
          keep = keep && !result;
        } catch (e) {
          console.error("[engine] data-unless error:", condUnless, e);
        }
      }
      
      if (!keep) {
        toRemove.push(el);
      }
    }
    
    // Batch removal to minimize reflows
    for (const el of toRemove) {
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    }
  }
  
  /**
   * Wire up click delegation for links
   * Only needs to be called once
   */
  function wireLinkDelegation(onLinkClick) {
    if (delegationAttached) return;
    delegationAttached = true;
    
    container.addEventListener("click", async (evt) => {
      const link = evt.target.closest("a[data-goto], a[data-set]");
      if (!link || !container.contains(link)) return;
      
      evt.preventDefault();
      
      const setStr = link.getAttribute("data-set");
      const target = link.getAttribute("data-goto");
      
      if (onLinkClick) {
        await onLinkClick({ setStr, target });
      }
    });
  }
  
  /**
   * Render HTML to container
   */
  function render(html, state, passageId) {
    container.innerHTML = html;
    
    // Apply conditional rendering
    applyConditions(state);
    
    if (onRender) {
      onRender({
        id: passageId,
        state,
        container
      });
    }
  }
  
  /**
   * Show an error in the container
   */
  function renderError(passageId, error) {
    container.innerHTML = `
      <h1>Render Error</h1>
      <p>Failed to render passage "${escapeHtml(passageId)}"</p>
      <pre>${escapeHtml(error.stack || error.message || String(error))}</pre>
    `;
  }
  
  /**
   * Show missing passage message
   */
  function renderMissing(passageId) {
    container.innerHTML = `
      <h1>Missing Passage</h1>
      <p>No passage named "${escapeHtml(passageId)}".</p>
      <nav><a href="#" data-goto="start">Back to start</a></nav>
    `;
  }
  
  return {
    render,
    renderError,
    renderMissing,
    wireLinkDelegation,
    applyConditions
  };
}
