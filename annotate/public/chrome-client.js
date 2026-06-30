/*
 * Design-and-Ship annotate side panel (browser side).
 * Adapted from the Lavish chrome-client (MIT), simplified: no layout gate.
 * Receives annotations from the sandboxed iframe over postMessage, queues them,
 * POSTs them to the server, and renders the conversation + queued-annotation list.
 * No em dashes anywhere (hard project rule).
 */
(function () {
  var sessionEl = document.getElementById("dns-session");
  var sessionData = JSON.parse((sessionEl && sessionEl.textContent) || "{}");
  var key = String(sessionData.key || "");
  var filePath = String(sessionData.file || "");
  var queueStorageKey = "dns-annotate:queued:" + key;
  var initialChat = Array.isArray(sessionData.initialChat) ? sessionData.initialChat : [];

  var frame = document.getElementById("artifact");
  var pills = document.getElementById("annotationPills");
  var chatLog = document.getElementById("chatLog");
  var chatInput = document.getElementById("chatInput");
  var sendButton = document.getElementById("send");
  var annotationSwitch = document.getElementById("annotation");
  var reloadButton = document.getElementById("reloadArtifact");
  var endButton = document.getElementById("end");
  var copyPathButton = document.getElementById("copyPath");
  var presenceBanner = document.getElementById("presenceBanner");
  var endedOverlay = document.getElementById("endedOverlay");
  var artifactSrc = frame.getAttribute("data-artifact-src") || "";

  var queued = loadQueued();
  var annotation = true;
  var ended = false;
  var agentPresence = "waiting";
  var workingBubble = null;
  var lastScroll = { x: 0, y: 0 };

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function loadQueued() {
    try {
      var parsed = JSON.parse(sessionStorage.getItem(queueStorageKey) || "[]");
      return Array.isArray(parsed) ? parsed.filter(function (p) { return p && typeof p === "object"; }) : [];
    } catch (e) {
      return [];
    }
  }

  function persistQueued() {
    try {
      if (queued.length) sessionStorage.setItem(queueStorageKey, JSON.stringify(queued));
      else sessionStorage.removeItem(queueStorageKey);
    } catch (e) {
      /* in-memory queue still works */
    }
  }

  function render() {
    while (pills.firstChild) pills.removeChild(pills.firstChild);
    queued.forEach(function (prompt, index) {
      var wrap = document.createElement("div");
      wrap.className = "pill";
      var preview = document.createElement("span");
      preview.className = "pill-text";
      preview.textContent = prompt.selector ? prompt.selector + "  -  " + prompt.prompt : prompt.prompt;
      preview.title = prompt.prompt;
      var close = document.createElement("button");
      close.className = "pill-close";
      close.type = "button";
      close.setAttribute("aria-label", "Remove queued annotation");
      close.textContent = "×";
      close.addEventListener("click", function (event) {
        event.stopPropagation();
        queued.splice(index, 1);
        persistQueued();
        render();
      });
      wrap.appendChild(preview);
      wrap.appendChild(close);
      pills.appendChild(wrap);
    });
    updateSendState();
  }

  function updateSendState() {
    sendButton.disabled = ended || agentPresence === "working";
  }

  function addChat(role, text) {
    if (!text) return;
    var el = document.createElement("div");
    el.className = "bubble " + role;
    var who = document.createElement("small");
    who.textContent = role === "agent" ? "Agent" : "You";
    var body = document.createElement("div");
    body.textContent = text;
    el.appendChild(who);
    el.appendChild(body);
    chatLog.appendChild(el);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function syncChat(chat) {
    var stale = chatLog.querySelectorAll(".bubble.user,.bubble.agent:not(.agent-working)");
    for (var i = 0; i < stale.length; i++) stale[i].remove();
    chat.forEach(function (item) { addChat(item.role, item.text); });
    if (workingBubble) chatLog.appendChild(workingBubble);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function setPresence(state) {
    agentPresence = state === "listening" || state === "working" ? state : "waiting";
    updateSendState();
    if (presenceBanner) presenceBanner.hidden = ended || agentPresence !== "waiting";
    if (agentPresence !== "working") {
      if (workingBubble) workingBubble.remove();
      workingBubble = null;
      return;
    }
    if (!workingBubble) {
      workingBubble = document.createElement("div");
      workingBubble.className = "bubble agent agent-working";
      workingBubble.innerHTML = '<span class="spinner"></span><span>Working...</span>';
      chatLog.appendChild(workingBubble);
    }
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function postToFrame(message) {
    if (frame.contentWindow) frame.contentWindow.postMessage(message, "*");
  }

  function enqueue(prompt) {
    if (!prompt || typeof prompt !== "object") return;
    queued.push(prompt);
    persistQueued();
    render();
  }

  function sendQueued() {
    if (ended || agentPresence === "working") return;
    var text = chatInput.value.trim();
    if (text) {
      queued.push({ uid: "", prompt: text, selector: "", tag: "message", text: "Freeform message" });
      persistQueued();
      addChat("user", text);
      chatInput.value = "";
      render();
    }
    if (!queued.length) return;
    submitQueued();
  }

  function submitQueued() {
    var prompts = queued.slice();
    fetch("/api/" + key + "/prompts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompts: prompts }),
    })
      .then(function (response) {
        if (!response.ok) throw new Error("submit failed");
        prompts.forEach(function (p) {
          var idx = queued.indexOf(p);
          if (idx !== -1) queued.splice(idx, 1);
        });
        persistQueued();
        render();
        if (agentPresence === "listening") setPresence("working");
      })
      .catch(function () {
        /* leave queued so the user can retry */
      });
  }

  function endSession() {
    if (ended) return;
    fetch("/api/" + key + "/end", { method: "POST" })
      .then(function (response) {
        if (!response.ok) throw new Error("end failed");
        ended = true;
        annotationSwitch.disabled = true;
        chatInput.disabled = true;
        updateSendState();
        if (presenceBanner) presenceBanner.hidden = true;
        postToFrame({ type: "dns:setAnnotationMode", enabled: false });
        endedOverlay.hidden = false;
      })
      .catch(function () {});
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () {});
    }
  }

  function resetFrame() {
    frame.src = artifactSrc || frame.src;
  }

  function reloadAfterServerRestart() {
    var sawOutage = false;
    var deadline = Date.now() + 5000;
    function tick() {
      if (Date.now() >= deadline) { location.reload(); return; }
      fetch("/health", { cache: "no-store" })
        .then(function (res) { if (sawOutage && res.ok) location.reload(); else setTimeout(tick, 120); })
        .catch(function () { sawOutage = true; setTimeout(tick, 120); });
    }
    tick();
  }

  window.addEventListener("message", function (event) {
    if (event.source !== frame.contentWindow) return;
    var msg = event.data || {};
    if (msg.type === "dns:queuePrompt") enqueue(msg.prompt);
    if (msg.type === "dns:sendQueuedPrompts") sendQueued();
    if (msg.type === "dns:endSession") endSession();
    if (msg.type === "dns:scroll") lastScroll = { x: Number(msg.x) || 0, y: Number(msg.y) || 0 };
  });

  annotationSwitch.onclick = function () {
    annotation = !annotation;
    annotationSwitch.setAttribute("aria-pressed", String(annotation));
    postToFrame({ type: "dns:setAnnotationMode", enabled: annotation });
  };
  sendButton.onclick = function () { sendQueued(); };
  reloadButton.onclick = function () { resetFrame(); };
  endButton.onclick = function () { endSession(); };
  copyPathButton.onclick = function () { copyText(filePath); };
  chatInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendQueued();
    }
  });
  frame.addEventListener("load", function () {
    postToFrame({ type: "dns:setAnnotationMode", enabled: annotation && !ended });
    postToFrame({ type: "dns:restoreScroll", x: lastScroll.x, y: lastScroll.y });
  });

  if (artifactSrc) frame.src = artifactSrc;

  var events = new EventSource("/events/" + key);
  events.addEventListener("reload", function () { resetFrame(); });
  events.addEventListener("server-reload", function () { reloadAfterServerRestart(); });
  events.addEventListener("agent-reply", function (event) { addChat("agent", JSON.parse(event.data).text); });
  events.addEventListener("chat-sync", function (event) { syncChat(JSON.parse(event.data).chat || []); });
  events.addEventListener("agent-presence", function (event) { setPresence(JSON.parse(event.data).state); });

  render();
  initialChat.forEach(function (item) { addChat(item.role, item.text); });
  setPresence("waiting");
})();
