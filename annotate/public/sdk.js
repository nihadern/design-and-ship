/*
 * Design-and-Ship annotation SDK.
 * Vendored and adapted from the Lavish artifact SDK (kunchenguid/lavish-axi, MIT),
 * stripped down to the annotation mechanism and rebranded for design-and-ship.
 *
 * Runs inside the sandboxed iframe (allow-scripts, no allow-same-origin), so it
 * cannot touch the chrome DOM. It talks to the side panel over postMessage only.
 *
 * Capabilities kept from the reference:
 *  - hover highlight of the element under the cursor
 *  - click an element to open an annotation card
 *  - select text to annotate a text range
 *  - CSS selector building walking up to 5 ancestors
 *  - the comment card lives in a closed-ish shadow DOM so artifact CSS can't leak in
 *  - postMessage API: queuePrompt / sendQueuedPrompts / endSession
 *
 * No em dashes anywhere in this file (hard project rule).
 */
(function () {
  var ACCENT = "#10b981";
  var annotationMode = true;
  var hovered = null;
  var selected = null;
  var ignoreNextClick = false;
  var shadow = null;
  var counter = 0;
  var ids = new WeakMap();

  function uid(el) {
    if (!ids.has(el)) ids.set(el, String(++counter));
    return ids.get(el);
  }

  // Build a CSS selector by walking up at most 5 ancestors. Stops early at an id.
  function selector(el) {
    if (!el || !el.tagName) return "";
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && parts.length < 5) {
      var part = node.tagName.toLowerCase();
      if (node.id) {
        part += "#" + CSS.escape(node.id);
        parts.unshift(part);
        break;
      }
      var parent = node.parentElement;
      if (parent) {
        var same = Array.prototype.filter.call(parent.children, function (x) {
          return x.tagName === node.tagName;
        });
        if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(node) + 1) + ")";
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(" > ");
  }

  function context(el) {
    return {
      uid: uid(el),
      selector: selector(el),
      tag: (el.tagName || "").toLowerCase(),
      text: (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 240),
    };
  }

  function closestElement(node) {
    if (!node) return document.body;
    if (node.nodeType === 1) return node;
    return node.parentElement || document.body;
  }

  function nodePath(node, root) {
    var path = [];
    var current = node;
    while (current && current !== root) {
      var parentNode = current.parentNode;
      if (!parentNode) break;
      path.unshift(Array.prototype.indexOf.call(parentNode.childNodes, current));
      current = parentNode;
    }
    return path;
  }

  function rangeBoundary(node, offset) {
    var el = closestElement(node);
    return { selector: selector(el), path: nodePath(node, el), offset: Number(offset) || 0 };
  }

  function isDnsUi(el) {
    return !!(el && el.closest && el.closest("[data-dns-ui]"));
  }
  function isDnsAction(el) {
    return !!(el && el.closest && el.closest("[data-dns-action]"));
  }
  function isInteractiveControl(el) {
    return !!(
      el &&
      el.closest &&
      el.closest(
        "button,input,select,textarea,option,optgroup,label,summary,[contenteditable]:not([contenteditable='false'])"
      )
    );
  }

  function textSelectionContext(sel) {
    if (!sel || sel.rangeCount === 0) return null;
    var range = sel.getRangeAt(0);
    var text = sel.toString().trim().replace(/\s+/g, " ");
    if (range.collapsed || !text) return null;
    var ancestor = closestElement(range.commonAncestorContainer);
    if (isDnsUi(ancestor) || isDnsAction(ancestor) || isInteractiveControl(ancestor)) return null;
    var commonAncestorSelector = selector(ancestor);
    var target = {
      type: "text-range",
      text: text,
      selector: commonAncestorSelector,
      commonAncestorSelector: commonAncestorSelector,
      start: rangeBoundary(range.startContainer, range.startOffset),
      end: rangeBoundary(range.endContainer, range.endOffset),
    };
    return {
      uid: "",
      selector: commonAncestorSelector,
      tag: "text",
      text: text.slice(0, 240),
      target: target,
      element: ancestor,
      range: range.cloneRange(),
    };
  }

  function highlightElement(el) {
    if (!el) return;
    el.style.outline = "2px solid " + ACCENT;
    el.style.outlineOffset = "2px";
  }
  function clearHighlight(el) {
    if (el) el.style.outline = "";
  }
  function clearTextHighlight() {
    if (!shadow) return;
    var marks = shadow.querySelectorAll(".dns-text-highlight");
    for (var i = 0; i < marks.length; i++) marks[i].remove();
  }
  function highlightTextRange(range) {
    clearTextHighlight();
    var root = ensureShadow();
    var rects = range.getClientRects();
    for (var i = 0; i < rects.length; i++) {
      var rect = rects[i];
      if (rect.width <= 0 || rect.height <= 0) continue;
      var mark = document.createElement("div");
      mark.className = "dns-text-highlight";
      mark.style.left = rect.left + "px";
      mark.style.top = rect.top + "px";
      mark.style.width = rect.width + "px";
      mark.style.height = rect.height + "px";
      root.appendChild(mark);
    }
  }

  function setAnnotationMode(enabled) {
    annotationMode = !!enabled;
    var style = document.getElementById("dns-cursor-style");
    if (annotationMode && !style) {
      style = document.createElement("style");
      style.id = "dns-cursor-style";
      style.textContent =
        "*{cursor:default!important}[data-dns-action],[data-dns-action] *{cursor:pointer!important}" +
        "input,textarea,[contenteditable]:not([contenteditable='false']){cursor:text!important}" +
        "button,select,label,option,input[type='button'],input[type='submit'],input[type='reset']," +
        "input[type='checkbox'],input[type='radio']{cursor:pointer!important}";
      document.head.appendChild(style);
    }
    if (!annotationMode && style) style.remove();
    if (!annotationMode) closeCard();
  }

  function queuePrompt(prompt, options) {
    options = options || {};
    var originElement = options.element || document.activeElement || document.body;
    var item = {
      uid: context(originElement).uid,
      selector: context(originElement).selector,
      tag: context(originElement).tag,
      text: context(originElement).text,
      prompt: String(prompt || ""),
    };
    if (options.uid) item.uid = String(options.uid);
    if (options.selector) item.selector = String(options.selector);
    if (options.tag) item.tag = String(options.tag);
    if (options.text) item.text = String(options.text);
    if (options.target) item.target = options.target;
    parent.postMessage({ type: "dns:queuePrompt", prompt: item }, "*");
  }

  function sendQueuedPrompts() {
    parent.postMessage({ type: "dns:sendQueuedPrompts" }, "*");
  }
  function endSession() {
    parent.postMessage({ type: "dns:endSession" }, "*");
  }

  function snapshot() {
    var lines = [];
    function walk(el, depth) {
      if (!(el instanceof Element) || depth > 6 || isDnsUi(el)) return;
      var c = context(el);
      var name = c.text ? ' "' + c.text.slice(0, 80).replace(/"/g, "'") + '"' : "";
      lines.push(new Array(depth + 1).join("  ") + "uid=" + c.uid + " " + c.tag + name);
      for (var i = 0; i < el.children.length; i++) walk(el.children[i], depth + 1);
    }
    walk(document.body, 0);
    return lines.join("\n");
  }

  function ensureShadow() {
    if (shadow) return shadow;
    var host = document.createElement("div");
    host.className = "dns-annotation-root";
    host.setAttribute("data-dns-ui", "annotation-root");
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: "open" });
    var style = document.createElement("style");
    style.textContent =
      ":host{all:initial;position:fixed;z-index:2147483647;left:0;top:0;" +
      "--accent:#10b981;--accent-fg:#047857;--bg-card:#ffffff;--fg:#1c2024;--fg-soft:#5b656e;" +
      "--border:#e5e9ee;--radius:14px;" +
      "--sans:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;" +
      "font-family:var(--sans)}*{box-sizing:border-box}" +
      ":focus-visible{outline:2px solid var(--accent);outline-offset:2px}" +
      ".dns-text-highlight{position:fixed;pointer-events:none;background:rgba(16,185,129,.20);" +
      "border-radius:3px;box-shadow:0 0 0 1px rgba(16,185,129,.45)}" +
      ".dns-card{position:fixed;width:min(330px,calc(100vw - 24px));padding:14px;" +
      "border-radius:var(--radius);background:var(--bg-card);color:var(--fg);" +
      "border:1px solid var(--border);box-shadow:0 10px 34px rgba(16,24,40,.16);" +
      "font:14px/1.5 var(--sans)}" +
      ".dns-head{font-weight:700;margin-bottom:8px;display:flex;align-items:center;gap:8px}" +
      ".dns-dot{width:10px;height:10px;border-radius:50%;background:var(--accent);" +
      "box-shadow:0 0 0 4px rgba(16,185,129,.14)}" +
      ".dns-card textarea{width:100%;min-height:86px;resize:vertical;border-radius:10px;" +
      "border:1px solid var(--border);background:#fff;color:var(--fg);padding:9px;font:inherit}" +
      ".dns-card textarea::placeholder{color:var(--fg-soft)}" +
      ".dns-hint{margin-top:6px;font-size:11px;color:var(--fg-soft)}" +
      ".dns-row{display:flex;gap:8px;justify-content:flex-end;margin-top:10px}" +
      ".dns-card button{border:0;border-radius:10px;padding:8px 12px;font-family:var(--sans);" +
      "font-size:13px;font-weight:600;cursor:pointer}" +
      ".dns-send{background:var(--accent);color:#fff}.dns-send:hover{background:var(--accent-fg)}" +
      ".dns-cancel{background:#f3f5f7;color:var(--fg)}";
    shadow.appendChild(style);
    return shadow;
  }

  function closeCard() {
    if (shadow) {
      var cards = shadow.querySelectorAll(".dns-card");
      for (var i = 0; i < cards.length; i++) cards[i].remove();
    }
    clearHighlight(hovered);
    clearHighlight(selected);
    hovered = null;
    clearTextHighlight();
    selected = null;
  }

  function showAnnotationCard(target, options) {
    options = options || {};
    var root = ensureShadow();
    closeCard();
    var c = options.context || context(target);
    if (options.range) {
      highlightTextRange(options.range);
    } else {
      selected = target;
      highlightElement(selected);
    }
    var rect = options.range ? options.range.getBoundingClientRect() : target.getBoundingClientRect();
    var card = document.createElement("div");
    card.className = "dns-card";
    var heading = c.tag === "text" ? "Annotate text" : "Annotate <" + c.tag + ">";
    var placeholder =
      c.tag === "text"
        ? "Tell the agent what to change about this text..."
        : "Tell the agent what to change about this element...";
    var modKey = /Mac|iP(hone|ad|od)/.test(navigator.platform) ? "Cmd" : "Ctrl";
    card.innerHTML =
      '<div class="dns-head"><span class="dns-dot"></span><span>' +
      escapeHtml(heading) +
      '</span></div><textarea placeholder="' +
      escapeHtml(placeholder) +
      '"></textarea><div class="dns-hint">Enter to queue &middot; ' +
      modKey +
      '+Enter to send now</div><div class="dns-row">' +
      '<button class="dns-cancel" type="button">Cancel</button>' +
      '<button class="dns-send" type="button">Queue</button></div>';
    root.appendChild(card);

    var left = Math.min(Math.max(12, rect.left), window.innerWidth - card.offsetWidth - 12);
    var top = Math.min(Math.max(12, rect.bottom + 8), window.innerHeight - card.offsetHeight - 12);
    card.style.left = left + "px";
    card.style.top = top + "px";

    var textarea = card.querySelector("textarea");
    var cancelButton = card.querySelector(".dns-cancel");
    var sendButton = card.querySelector(".dns-send");
    if (!textarea || !cancelButton || !sendButton) return;

    cancelButton.onclick = closeCard;
    sendButton.onclick = function () {
      var prompt = textarea.value.trim();
      if (prompt) {
        queuePrompt(prompt, { uid: c.uid, selector: c.selector, tag: c.tag, text: c.text, target: c.target });
      }
      closeCard();
    };
    textarea.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        var sendNow = (event.ctrlKey || event.metaKey) && !!textarea.value.trim();
        sendButton.click();
        if (sendNow) sendQueuedPrompts();
      }
    });
    setTimeout(function () {
      textarea.focus();
    }, 0);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  window.dns = {
    queuePrompt: queuePrompt,
    sendQueuedPrompts: sendQueuedPrompts,
    endSession: endSession,
    snapshot: snapshot,
    setStatus: function (message) {
      parent.postMessage({ type: "dns:status", message: String(message) }, "*");
    },
  };

  window.addEventListener("message", function (event) {
    var msg = event.data || {};
    if (msg.type === "dns:setAnnotationMode") setAnnotationMode(msg.enabled);
    if (msg.type === "dns:requestSnapshot") {
      parent.postMessage({ type: "dns:snapshot", snapshot: snapshot() }, "*");
    }
    if (msg.type === "dns:restoreScroll") {
      window.scrollTo(Number(msg.x) || 0, Number(msg.y) || 0);
    }
  });

  // Report scroll so the chrome can restore it across hot reloads (sandbox blocks direct reads).
  var scrollFrame = 0;
  window.addEventListener(
    "scroll",
    function () {
      if (scrollFrame) return;
      scrollFrame = window.requestAnimationFrame(function () {
        scrollFrame = 0;
        parent.postMessage({ type: "dns:scroll", x: window.scrollX, y: window.scrollY }, "*");
      });
    },
    { passive: true }
  );

  document.addEventListener(
    "mouseover",
    function (event) {
      if (!annotationMode || isDnsUi(event.target) || isDnsAction(event.target) || isInteractiveControl(event.target))
        return;
      if (event.target === selected) return;
      if (hovered && hovered !== selected) clearHighlight(hovered);
      hovered = event.target;
      highlightElement(hovered);
    },
    true
  );

  document.addEventListener(
    "mouseout",
    function () {
      if (hovered && hovered !== selected) {
        clearHighlight(hovered);
        hovered = null;
      }
    },
    true
  );

  document.addEventListener(
    "mouseup",
    function (event) {
      if (!annotationMode || isDnsUi(event.target) || isDnsAction(event.target) || isInteractiveControl(event.target))
        return;
      var c = textSelectionContext(document.getSelection());
      if (!c) return;
      ignoreNextClick = true;
      showAnnotationCard(c.element, { context: c, range: c.range });
    },
    true
  );

  document.addEventListener(
    "click",
    function (event) {
      if (!annotationMode || isDnsUi(event.target) || isDnsAction(event.target) || isInteractiveControl(event.target))
        return;
      event.preventDefault();
      event.stopPropagation();
      if (ignoreNextClick) {
        ignoreNextClick = false;
        return;
      }
      showAnnotationCard(event.target);
    },
    true
  );

  setAnnotationMode(annotationMode);
})();
