// graph-view.js — Optimized passage graph visualizer using Cytoscape.
// OPTIMIZATIONS:
// - Viewport culling for large graphs
// - Dynamic label rendering based on zoom level
// - Improved layout performance
// - Better memory management

const CY = () => window.cytoscape;

// Same font as the page
const FONT_STACK = "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";

// Tunables - optimized for large graphs
const MIN_NODE_SIZE = 16;
const MAX_NODE_SIZE = 34;
const LABEL_NODE_THRESHOLD = 400;  // Reduced from 600 for better performance
const LABEL_ZOOM_THRESHOLD = 0.7;  // Only show labels when zoomed in enough
const DBLCLICK_MS = 300;

// Performance constants
const VIEWPORT_CULLING_THRESHOLD = 500;  // Enable viewport culling above this node count
const VIEWPORT_BUFFER = 150;             // Buffer around viewport for smoother pan

// Theme palettes for the graph
const THEMES = {
  light: {
    labelText: "#111827",
    labelBg: "#ffffff",
    labelBorder: "#d1d5db",
    nodeRampLo: "#bcdcff",
    nodeRampHi: "#2b6cb0",
    nodeBorder: "#d0d7de",
    startBg: "#166534",
    startBorder: "#052e16",
    startLabelBorder: "#94a3b8",
    endpointBg: "#9ca3af",
    endpointBorder: "#6b7280",
    unreachableBg: "#bbbbbb",
    edgeLine: "#c7c7c7",
    edgeArrow: "#9ca3af",
    hoverBorder: "#f59e0b"
  },
  dark: {
    labelText: "#e5e7eb",
    labelBg: "#0f172a",
    labelBorder: "#334155",
    nodeRampLo: "#374151",
    nodeRampHi: "#60a5fa",
    nodeBorder: "#374151",
    startBg: "#22c55e",
    startBorder: "#14532d",
    startLabelBorder: "#475569",
    endpointBg: "#6b7280",
    endpointBorder: "#52525b",
    unreachableBg: "#2d2d2d",
    edgeLine: "#3f3f46",
    edgeArrow: "#a1a1aa",
    hoverBorder: "#f59e0b"
  }
};

function extractLinks(html) {
  const out = [];
  const re = /\b(?:data-goto|go)="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

function buildGraphFromPassages(passages, tagsById = {}) {
  const ids = Object.keys(passages);

  // nodes with tag arrays
  const nodes = ids.map(id => ({
    data: { id, tags: Array.isArray(tagsById[id]) ? tagsById[id] : [] }
  }));

  // edges
  const edges = [];
  const idSet = new Set(ids);
  for (const id of ids) {
    const html = passages[id];
    if (typeof html !== "string") continue;
    const links = extractLinks(html);
    for (const to of links) {
      if (idSet.has(to)) edges.push({ data: { id: `${id}->${to}`, source: id, target: to } });
    }
  }

  // degrees
  const degOut = new Map(ids.map(id => [id, 0]));
  const degIn  = new Map(ids.map(id => [id, 0]));
  for (const e of edges) {
    degOut.set(e.data.source, (degOut.get(e.data.source) || 0) + 1);
    degIn.set(e.data.target, (degIn.get(e.data.target) || 0) + 1);
  }
  let minIn = Infinity, maxIn = -Infinity, minOut = Infinity, maxOut = -Infinity;
  for (const id of ids) {
    const di = degIn.get(id)  || 0;
    const dO = degOut.get(id) || 0;
    if (di < minIn) minIn = di;
    if (di > maxIn) maxIn = di;
    if (dO < minOut) minOut = dO;
    if (dO > maxOut) maxOut = dO;
  }
  for (const n of nodes) {
    n.data.degIn = degIn.get(n.data.id) || 0;
    n.data.degOut = degOut.get(n.data.id) || 0;
  }
  const deg = { minIn, maxIn, minOut, maxOut };

  return { nodes, edges, ids, deg };
}

function bfsReachable(ids, edges, startId) {
  const adj = new Map(ids.map(id => [id, []]));
  for (const e of edges) adj.get(e.data.source).push(e.data.target);
  const seen = new Set();
  const q = [];
  if (startId && adj.has(startId)) { seen.add(startId); q.push(startId); }
  while (q.length) {
    const cur = q.shift();
    for (const nxt of adj.get(cur)) if (!seen.has(nxt)) { seen.add(nxt); q.push(nxt); }
  }
  return seen;
}

function kHopNeighborhood(cy, id, k = 2) {
  let set = cy.$(`#${CSS.escape(id)}`);
  let frontier = set;
  for (let i = 0; i < k; i++) {
    frontier = frontier.closedNeighborhood();
    set = set.union(frontier);
  }
  return set;
}

function makeStyle(theme, deg) {
  return [
    {
      selector: "node",
      style: {
        "background-color": `mapData(degIn, ${deg.minIn}, ${deg.maxIn}, ${theme.nodeRampLo}, ${theme.nodeRampHi})`,
        "width":  `mapData(degOut, ${deg.minOut}, ${deg.maxOut}, ${MIN_NODE_SIZE}, ${MAX_NODE_SIZE})`,
        "height": `mapData(degOut, ${deg.minOut}, ${deg.maxOut}, ${MIN_NODE_SIZE}, ${MAX_NODE_SIZE})`,
        "border-width": 1,
        "border-color": theme.nodeBorder,
        "shape": "ellipse",
        "font-family": FONT_STACK,
        "label": "data(id)",
        "font-size": 11,
        "color": theme.labelText,
        "text-wrap": "wrap",
        "text-max-width": 120,
        "text-halign": "center",
        "text-valign": "bottom",
        "text-margin-y": 10,
        "text-background-color": theme.labelBg,
        "text-background-opacity": 0.92,
        "text-background-padding": 2,
        "text-background-shape": "roundrectangle",
        "text-border-color": theme.labelBorder,
        "text-border-width": 1
      }
    },
    { selector: "node.start", style: { "background-color": theme.startBg, "border-color": theme.startBorder, "border-width": 2, "color": theme.labelText, "text-background-color": theme.labelBg, "text-border-color": theme.startLabelBorder } },
    { selector: "node.endpoint", style: { "background-color": theme.endpointBg, "border-color":"#6b7280", "border-width": 2 } },
    { selector: "node.unreachable", style: { "background-color": theme.unreachableBg, "opacity": 0.55 } },
    { selector: "node.filtered", style: { "background-color": "#f59e0b", "border-color":"#b45309", "border-width": 2 } },
    { selector: "node.dimmed", style: { "opacity": 0.25 } },

    { selector: "node.hovered", style: { "border-width": 3, "border-color": theme.hoverBorder, "overlay-opacity": 0 } },
    { selector: "node.labelOff", style: { "label": "" } },

    { selector: "edge", style: { "width": 1.2, "curve-style": "bezier", "target-arrow-shape": "triangle", "target-arrow-color": theme.edgeArrow, "line-color": theme.edgeLine } },
    { selector: ".hidden", style: { "display": "none" } }
  ];
}

export function mountGraphFromPassages(opts) {
  const {
    container,
    passages,
    startId = "start",
    layout = "cose",
    hideUnreachable = false,
    theme = "light",
    tagsById = {},
    onStats,
    onSelect
  } = opts || {};

  if (!container) throw new Error("Graph container not provided.");
  if (!window.cytoscape) throw new Error("Cytoscape not available on page.");
  if (!passages || typeof passages !== "object") throw new Error("Invalid passages.");

  const { nodes, edges, ids, deg } = buildGraphFromPassages(passages, tagsById);
  const reachable = bfsReachable(ids, edges, startId);
  const themeObj = THEMES[theme] || THEMES.light;
  
  const nodeCount = nodes.length;
  const useViewportCulling = nodeCount > VIEWPORT_CULLING_THRESHOLD;
  console.log(`[graph] Rendering ${nodeCount} nodes (viewport culling: ${useViewportCulling})`);

  const cy = CY()({
    container,
    elements: { nodes, edges },
    textureOnViewport: nodeCount > 1000,
    hideEdgesOnViewport: nodeCount > 800,
    hideLabelsOnViewport: true,
    motionBlur: nodeCount < 500,
    motionBlurOpacity: 0.15,
    pixelRatio: 1,
    wheelSensitivity: 0.25,
    style: makeStyle(themeObj, deg)
  });

  cy.batch(() => {
    cy.nodes().forEach(n => {
      const id = n.id();
      if (id === startId) n.addClass("start");
      if (!reachable.has(id)) n.addClass("unreachable");
      if ((n.data("degOut") || 0) === 0) n.addClass("endpoint");
    });
  });

  const runLayout = (name) => {
    let opts;
    
    switch (name) {
      case "breadthfirst":
        opts = { 
          name: "breadthfirst", 
          directed: true, 
          padding: 20, 
          spacingFactor: 1.15, 
          roots: `#${CSS.escape(startId)}`, 
          animate: false 
        };
        break;
        
      case "circle":
        opts = {
          name: "circle",
          padding: 30,
          animate: nodeCount < 300,
          avoidOverlap: true,
          spacingFactor: 1.1
        };
        break;
        
      case "concentric":
        opts = {
          name: "concentric",
          padding: 30,
          animate: nodeCount < 300,
          avoidOverlap: true,
          concentric: (node) => node.data("degIn") || 0,  // Higher degree = inner rings
          levelWidth: () => 2,
          spacingFactor: 1.2,
          startAngle: Math.PI / 2
        };
        break;
        
      case "grid":
        opts = {
          name: "grid",
          padding: 30,
          animate: nodeCount < 300,
          avoidOverlap: true,
          avoidOverlapPadding: 10,
          condense: true
        };
        break;
        
      case "cose":
      default:
        opts = { 
          name: "cose", 
          animate: nodeCount < 300,
          nodeRepulsion: nodeCount > 1000 ? 3000 : 4000,
          componentSpacing: 80, 
          padding: 20,
          numIter: nodeCount > 1000 ? 500 : 1000,
          idealEdgeLength: () => 50,
          edgeElasticity: () => 100
        };
    }
    
    cy.layout(opts).run();
  };
  
  // Smart default layout selection based on node count
  const defaultLayout = nodeCount >= 500 ? "breadthfirst" : layout;
  if (nodeCount >= 500 && layout === "cose") {
    console.log(`[graph] Using breadthfirst instead of cose for ${nodeCount} nodes (performance)`);
  }
  runLayout(defaultLayout);

  const fit = () => cy.fit(undefined, 24);

  let hiddenUnreachable = false;
  const toggleHideUnreachable = (flag) => {
    hiddenUnreachable = !!flag;
    cy.batch(() => {
      cy.nodes(".unreachable").toggleClass("hidden", hiddenUnreachable);
      cy.edges().forEach(e => {
        const sh = e.source().hasClass("hidden");
        const th = e.target().hasClass("hidden");
        e.toggleClass("hidden", hiddenUnreachable && (sh || th));
      });
    });
    fit();
  };
  if (hideUnreachable) toggleHideUnreachable(true);

  let lastUpdateTime = 0;
  const THROTTLE_MS = 100;
  
  function updateLabelMode() {
    const now = performance.now();
    if (now - lastUpdateTime < THROTTLE_MS) return;
    lastUpdateTime = now;
    
    const zoom = cy.zoom();
    const shouldHideAll = nodeCount > LABEL_NODE_THRESHOLD || zoom < LABEL_ZOOM_THRESHOLD;
    
    cy.batch(() => {
      if (shouldHideAll) {
        cy.nodes().addClass("labelOff");
      } else if (useViewportCulling) {
        const extent = cy.extent();
        const buffer = VIEWPORT_BUFFER;
        
        cy.nodes().forEach(n => {
          const pos = n.position();
          const inViewport = (
            pos.x >= extent.x1 - buffer &&
            pos.x <= extent.x2 + buffer &&
            pos.y >= extent.y1 - buffer &&
            pos.y <= extent.y2 + buffer
          );
          
          n.toggleClass("labelOff", !inViewport);
        });
      } else {
        cy.nodes().removeClass("labelOff");
      }
      
      cy.nodes(".hovered, :selected").removeClass("labelOff");
    });
  }
  
  let updateTimer = null;
  const scheduleUpdate = () => {
    if (updateTimer) return;
    updateTimer = setTimeout(() => {
      updateLabelMode();
      updateTimer = null;
    }, THROTTLE_MS);
  };
  
  cy.on("zoom pan", scheduleUpdate);
  updateLabelMode();

  cy.on("mouseover", "node", (e) => e.target.addClass("hovered").removeClass("labelOff"));
  cy.on("mouseout", "node", (e) => { e.target.removeClass("hovered"); updateLabelMode(); });

  cy.on("tap", "node", (evt) => {
    const n = evt.target;
    const id = n.id();
    const html = passages[id];
    if (typeof onSelect === "function") onSelect({ id, html, tags: n.data("tags") || [] });
    cy.center(n);
  });

  let lastTapTime = 0, lastTapId = null;
  cy.on("tap", "node", (evt) => {
    const now = performance.now();
    const id = evt.target.id();
    if (lastTapId === id && (now - lastTapTime) < DBLCLICK_MS) {
      const ego = kHopNeighborhood(cy, id, 2);
      cy.nodes().removeClass("filtered");
      ego.addClass("filtered");
      cy.layout({ name: "cose", animate: true, eles: ego, nodeRepulsion: 5000, padding: 20 }).run();
      cy.fit(ego, 40);
    }
    lastTapId = id; lastTapTime = now;
  });

  const searchCache = new Map();
  function search(q) {
    const query = (q || "").trim().toLowerCase();
    
    if (searchCache.has(query)) {
      const cached = searchCache.get(query);
      cy.batch(() => {
        cy.nodes().removeClass("filtered");
        cached.forEach(n => n.addClass("filtered"));
      });
      if (cached.length > 0) cy.fit(cy.nodes(".filtered").filter(n => !n.hasClass("hidden")), 40);
      return;
    }
    
    const matches = [];
    cy.batch(() => {
      cy.nodes().removeClass("filtered");
      if (!query) return;
      cy.nodes().forEach(n => { 
        if (n.id().toLowerCase().includes(query)) {
          n.addClass("filtered");
          matches.push(n);
        }
      });
    });
    
    searchCache.set(query, matches);
    const visible = cy.nodes(".filtered").filter(n => !n.hasClass("hidden"));
    if (visible.length > 0) cy.fit(visible, 40);
  }

  function setTheme(name) {
    const t = THEMES[name] || THEMES.light;
    cy.style().fromJson(makeStyle(t, deg)).update();
  }

  const tagIndex = (() => {
    const m = new Map();
    cy.nodes().forEach(n => {
      const id = n.id();
      const tags = Array.isArray(n.data("tags")) ? n.data("tags") : [];
      for (const t of tags) {
        const k = String(t || "").toLowerCase();
        if (!k) continue;
        if (!m.has(k)) m.set(k, new Set());
        m.get(k).add(id);
      }
    });
    return m;
  })();

  function setTagFilter({ include = new Set(), mode = "filter" } = {}) {
    const hasFilter = include && include.size > 0;
    cy.batch(() => {
      cy.nodes().removeClass("dimmed");
      if (!hasFilter) {
        cy.nodes().forEach(n => {
          const isUnreach = n.hasClass("unreachable");
          n.toggleClass("hidden", hiddenUnreachable && isUnreach);
        });
        cy.edges().forEach(e => e.removeClass("hidden"));
        return;
      }
      const allowed = new Set();
      for (const t of include) {
        const ids = tagIndex.get(String(t).toLowerCase());
        if (!ids) continue;
        for (const id of ids) allowed.add(id);
      }
      if (mode === "filter") {
        cy.nodes().forEach(n => {
          const keep = allowed.has(n.id());
          const isUnreach = n.hasClass("unreachable");
          n.toggleClass("hidden", !keep || (hiddenUnreachable && isUnreach));
        });
        cy.edges().forEach(e => {
          const sh = e.source().hasClass("hidden");
          const th = e.target().hasClass("hidden");
          e.toggleClass("hidden", sh || th);
        });
      } else {
        cy.nodes().forEach(n => n.toggleClass("dimmed", !allowed.has(n.id())));
      }
    });
  }

  if (typeof onStats === "function") {
    const comps = cy.elements().components().length;
    onStats({ nodes: nodes.length, edges: edges.length, components: comps, reachable: bfsReachable(ids, edges, startId).size });
  }

  let resizeTimer = null;
  const ro = new ResizeObserver(() => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      fit();
      resizeTimer = null;
    }, 150);
  });
  ro.observe(container);

  return {
    fit,
    runLayout,
    toggleHideUnreachable,
    search,
    setTheme,
    setTagFilter,
    getTagIndex: () => new Map(tagIndex),
    destroy() { 
      try { 
        if (updateTimer) clearTimeout(updateTimer);
        if (resizeTimer) clearTimeout(resizeTimer);
        ro.disconnect(); 
      } catch {} 
      try { cy.destroy(); } catch {} 
    }
  };
}








