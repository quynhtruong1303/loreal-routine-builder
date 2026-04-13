/* ─────────────────────────────────────────
   L'Oréal Routine Builder — script.js
───────────────────────────────────────── */

/* ── DOM references ── */
const categoryFilter       = document.getElementById("categoryFilter");
const productSearchInput   = document.getElementById("productSearch");
const productsContainer    = document.getElementById("productsContainer");
const selectedProductsList = document.getElementById("selectedProductsList");
const selectedCount        = document.getElementById("selectedCount");
const generateBtn          = document.getElementById("generateRoutine");
const clearAllBtn          = document.getElementById("clearAll");
const chatForm             = document.getElementById("chatForm");
const userInput            = document.getElementById("userInput");
const chatWindow           = document.getElementById("chatWindow");
const sendBtn              = document.getElementById("sendBtn");
const webSearchBtn         = document.getElementById("webSearchBtn");
const rtlToggle            = document.getElementById("rtlToggle");

/* ── Cloudflare Worker endpoint ──
   All AI requests are routed here so the OpenAI API key
   is never exposed in the browser.
   The updated worker (worker-web-search.js) must be deployed
   at this URL for web search responses to work.
*/
const CLOUDFLARE_WORKER_URL = "https://loreal-chatbot.quynhtruong1303.workers.dev/";

/* ── State ── */
let allProducts       = [];      // full product list from products.json
let selectedIds       = new Set(); // IDs of currently selected products
let currentCategory   = "";      // active category filter ("" = none)
let searchQuery       = "";      // active keyword search query
let conversationHistory = [];    // messages sent to the API each turn
let webSearchEnabled  = false;   // true when the globe toggle is ON
let searchDebounceTimer = null;  // timer ID for search input debounce

/* ── System prompt ── */
const SYSTEM_PROMPT = `You are a friendly, knowledgeable L'Oréal Beauty Advisor.
Help users build personalised skincare, haircare, makeup, and fragrance routines
using L'Oréal-family products (CeraVe, La Roche-Posay, L'Oréal Paris, Garnier,
Lancôme, Kérastase, Maybelline, etc.).

Guidelines:
- Only answer questions about beauty: skincare, haircare, makeup, fragrance,
  ingredients, and routines. Politely decline unrelated topics.
- Be warm, encouraging, and inclusive — beauty is for everyone.
- Keep responses concise (2–4 sentences) unless a detailed routine is requested.
- When generating a routine from selected products, provide clear step-by-step
  morning and/or evening instructions based on the product categories.`;

/* ─────────────────────────────────────────
   LocalStorage helpers
───────────────────────────────────────── */

function saveToStorage() {
  localStorage.setItem("lorealSelectedIds", JSON.stringify([...selectedIds]));
}

function loadFromStorage() {
  const saved = localStorage.getItem("lorealSelectedIds");
  if (saved) {
    selectedIds = new Set(JSON.parse(saved));
  }
}

/* ─────────────────────────────────────────
   Load products from JSON
───────────────────────────────────────── */

async function loadProducts() {
  const response = await fetch("products.json");
  const data = await response.json();
  allProducts = data.products;
}

/* ─────────────────────────────────────────
   Filter & display products
   Applies both the category filter and the keyword search.
   Either filter can be active independently or together.
───────────────────────────────────────── */

function applyFilters() {
  /* If neither filter is active, show the initial placeholder */
  if (!currentCategory && !searchQuery) {
    productsContainer.innerHTML = `
      <div class="placeholder-message">
        <i class="fa-solid fa-layer-group" style="margin-right:8px;color:#e3a535;"></i>
        Choose a category or type a keyword to browse products
      </div>
    `;
    return;
  }

  let filtered = allProducts;

  /* Step 1 — narrow by category (if one is selected) */
  if (currentCategory) {
    filtered = filtered.filter(p => p.category === currentCategory);
  }

  /* Step 2 — narrow further by keyword (matches name, brand, or description) */
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.brand.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q)
    );
  }

  displayProducts(filtered);
}

/* Build and inject product card HTML */
function displayProducts(products) {
  if (products.length === 0) {
    productsContainer.innerHTML = `
      <div class="placeholder-message">No products match your search.</div>
    `;
    return;
  }

  productsContainer.innerHTML = products.map(product => {
    const isSelected = selectedIds.has(product.id);
    return `
      <div class="product-card ${isSelected ? "selected" : ""}" data-id="${product.id}">
        <div class="card-inner">
          <img src="${product.image}" alt="${product.name}" loading="lazy">
          <div class="product-info">
            <p class="brand-name">${product.brand}</p>
            <h3>${product.name}</h3>
            <p class="desc-hint">
              <i class="fa-solid fa-eye"></i> Hover for description
            </p>
          </div>
        </div>
        <div class="product-desc-overlay">
          <p>${product.description}</p>
        </div>
        <div class="selected-badge">
          <i class="fa-solid fa-check"></i>
        </div>
      </div>
    `;
  }).join("");
}

/* ─────────────────────────────────────────
   Product selection
───────────────────────────────────────── */

function toggleSelect(productId) {
  if (selectedIds.has(productId)) {
    selectedIds.delete(productId);
  } else {
    selectedIds.add(productId);
  }

  saveToStorage();
  renderSelectedList();

  /* Update the card's visual state in the grid */
  const card = productsContainer.querySelector(`[data-id="${productId}"]`);
  if (card) {
    card.classList.toggle("selected", selectedIds.has(productId));
  }
}

/* ─────────────────────────────────────────
   Render selected products panel
───────────────────────────────────────── */

function renderSelectedList() {
  selectedCount.textContent = selectedIds.size;

  const selected = allProducts.filter(p => selectedIds.has(p.id));

  if (selected.length === 0) {
    selectedProductsList.innerHTML = `
      <p class="no-selection">
        No products selected yet — browse a category and click any card to add it here.
      </p>
    `;
    return;
  }

  selectedProductsList.innerHTML = selected.map(p => `
    <div class="selected-chip" data-id="${p.id}">
      <img src="${p.image}" alt="${p.name}" class="chip-img">
      <span class="chip-name">${p.name}</span>
      <button class="remove-chip" data-id="${p.id}" aria-label="Remove ${p.name}">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
  `).join("");
}

/* ─────────────────────────────────────────
   Chat helpers
───────────────────────────────────────── */

/* Append a message bubble (and optional advisor label) to the chat window.
   Returns the bubble element so callers can update it later (e.g. replace "Thinking…"). */
function appendMessage(role, text) {
  if (role === "ai") {
    const label = document.createElement("div");
    label.className = "msg-label";
    label.textContent = "L'Oréal Advisor";
    chatWindow.appendChild(label);
  }

  const bubble = document.createElement("div");
  bubble.className = `msg ${role}`;
  bubble.textContent = text;
  chatWindow.appendChild(bubble);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  return bubble;
}

/* Append a "Sources" citation block below an AI bubble when web search is on.
   citations: array of { url, title } objects */
function appendCitations(citations) {
  if (!citations || citations.length === 0) return;

  /* Web-search indicator label */
  const indicator = document.createElement("div");
  indicator.className = "web-search-indicator";
  indicator.innerHTML = `<i class="fa-solid fa-globe"></i> Web Search`;
  chatWindow.appendChild(indicator);

  /* Numbered source list */
  const box = document.createElement("div");
  box.className = "citation-list";

  const heading = document.createElement("p");
  heading.textContent = "Sources";
  box.appendChild(heading);

  const ol = document.createElement("ol");
  citations.forEach(c => {
    const li = document.createElement("li");
    const a  = document.createElement("a");
    a.href        = c.url;
    a.textContent = c.title || c.url;
    a.target      = "_blank";
    a.rel         = "noopener noreferrer";
    li.appendChild(a);
    ol.appendChild(li);
  });
  box.appendChild(ol);
  chatWindow.appendChild(box);

  chatWindow.scrollTop = chatWindow.scrollHeight;
}

/* Parse an OpenAI API response object.
   Handles both plain gpt-4o and gpt-4o-search-preview responses.
   Returns { text, citations } where citations may be an empty array. */
function parseApiResponse(data) {
  const message = data.choices[0].message;

  /* content is always a string in chat completions responses */
  const text = message.content || "";

  /* Annotations are present when gpt-4o-search-preview is used */
  const annotations = message.annotations || [];

  /* Extract unique URL citations */
  const seen = new Set();
  const citations = annotations
    .filter(a => a.type === "url_citation")
    .map(a => ({ url: a.url_citation.url, title: a.url_citation.title || a.url_citation.url }))
    .filter(c => {
      if (seen.has(c.url)) return false;
      seen.add(c.url);
      return true;
    });

  return { text, citations };
}

/* Disable / enable interactive controls while waiting for an API response */
function setLoading(isLoading) {
  sendBtn.disabled      = isLoading;
  generateBtn.disabled  = isLoading;
  userInput.disabled    = isLoading;
  webSearchBtn.disabled = isLoading;
}

/* ─────────────────────────────────────────
   Generate routine (calls Cloudflare Worker)
───────────────────────────────────────── */

async function generateRoutine() {
  const selected = allProducts.filter(p => selectedIds.has(p.id));

  if (selected.length === 0) {
    alert("Please select at least one product before generating a routine.");
    return;
  }

  /* Build a product description list to include in the prompt */
  const productList = selected.map(p =>
    `• ${p.name} by ${p.brand} (${p.category}): ${p.description}`
  ).join("\n");

  const routinePrompt =
    `Please create a personalised beauty routine using these selected products:\n\n` +
    productList +
    `\n\nProvide clear step-by-step morning and/or evening instructions as appropriate.`;

  /* Reset conversation history — this routine becomes the new context */
  conversationHistory = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user",   content: routinePrompt }
  ];

  const label = selected.length === 1 ? "1 product" : `${selected.length} products`;
  appendMessage("user", `Generate my routine — ${label} selected`);

  setLoading(true);
  const thinkingBubble = appendMessage("ai", "Building your personalised routine…");
  thinkingBubble.classList.add("thinking");

  try {
    const response = await fetch(CLOUDFLARE_WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      /* Pass webSearch flag so the updated worker picks the right model */
      body: JSON.stringify({ messages: conversationHistory, webSearch: webSearchEnabled })
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    const { text, citations } = parseApiResponse(data);

    thinkingBubble.textContent = text;
    thinkingBubble.classList.remove("thinking");

    /* Show source links if the web search model returned any */
    appendCitations(citations);

    /* Save the assistant reply so follow-up questions keep context */
    conversationHistory.push({ role: "assistant", content: text });

  } catch (err) {
    thinkingBubble.textContent =
      "Sorry, I couldn't generate the routine right now. Please check your connection and try again.";
    thinkingBubble.classList.remove("thinking");
    console.error("generateRoutine error:", err);
  } finally {
    setLoading(false);
  }
}

/* ─────────────────────────────────────────
   Follow-up chat
───────────────────────────────────────── */

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const text = userInput.value.trim();
  if (!text) return;

  appendMessage("user", text);
  userInput.value = "";

  /* Initialise history with the system prompt if this is the very first message */
  if (conversationHistory.length === 0) {
    conversationHistory = [{ role: "system", content: SYSTEM_PROMPT }];
  }

  conversationHistory.push({ role: "user", content: text });

  setLoading(true);
  const thinkingBubble = appendMessage("ai", "Thinking…");
  thinkingBubble.classList.add("thinking");

  try {
    const response = await fetch(CLOUDFLARE_WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: conversationHistory, webSearch: webSearchEnabled })
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    const { text: reply, citations } = parseApiResponse(data);

    thinkingBubble.textContent = reply;
    thinkingBubble.classList.remove("thinking");

    appendCitations(citations);

    conversationHistory.push({ role: "assistant", content: reply });

  } catch (err) {
    thinkingBubble.textContent =
      "Sorry, I'm having trouble connecting. Please try again.";
    thinkingBubble.classList.remove("thinking");
    console.error("chatForm error:", err);
  } finally {
    setLoading(false);
    userInput.focus();
  }
});

/* ─────────────────────────────────────────
   Event listeners
───────────────────────────────────────── */

/* Product card click → toggle selection */
productsContainer.addEventListener("click", (e) => {
  const card = e.target.closest(".product-card");
  if (!card) return;
  toggleSelect(parseInt(card.dataset.id, 10));
});

/* Remove chip click → deselect that product */
selectedProductsList.addEventListener("click", (e) => {
  const btn = e.target.closest(".remove-chip");
  if (!btn) return;
  toggleSelect(parseInt(btn.dataset.id, 10));
});

/* Clear All button */
clearAllBtn.addEventListener("click", () => {
  selectedIds.clear();
  saveToStorage();
  renderSelectedList();
  document.querySelectorAll(".product-card.selected").forEach(card => {
    card.classList.remove("selected");
  });
});

/* Generate Routine button */
generateBtn.addEventListener("click", generateRoutine);

/* Category dropdown → update currentCategory and re-apply filters */
categoryFilter.addEventListener("change", (e) => {
  currentCategory = e.target.value;
  applyFilters();
});

/* Product search input → debounced keyword filter.
   Waits 250 ms after the user stops typing before filtering,
   so we aren't re-rendering the grid on every keystroke. */
productSearchInput.addEventListener("input", (e) => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    searchQuery = e.target.value.trim();
    applyFilters();
  }, 250);
});

/* Web Search toggle — switches between gpt-4o and gpt-4o-search-preview */
webSearchBtn.addEventListener("click", () => {
  webSearchEnabled = !webSearchEnabled;
  webSearchBtn.classList.toggle("active", webSearchEnabled);
  webSearchBtn.title         = webSearchEnabled ? "Web Search: ON"  : "Web Search: OFF";
  webSearchBtn.ariaPressed   = webSearchEnabled ? "true" : "false";
});

/* RTL toggle — adds/removes dir="rtl" on <html> to flip the layout */
rtlToggle.addEventListener("click", () => {
  const html   = document.documentElement;
  const isRtl  = html.getAttribute("dir") === "rtl";
  html.setAttribute("dir", isRtl ? "ltr" : "rtl");
  rtlToggle.classList.toggle("active", !isRtl);
  rtlToggle.title = isRtl ? "Switch to RTL layout" : "Switch to LTR layout";
  /* Update the button label to reflect the current mode */
  rtlToggle.querySelector("span").textContent = isRtl ? "RTL" : "LTR";
});

/* ─────────────────────────────────────────
   Initialise on page load
───────────────────────────────────────── */

async function init() {
  /* Show placeholder while products load */
  productsContainer.innerHTML = `
    <div class="placeholder-message">
      <i class="fa-solid fa-layer-group" style="margin-right:8px;color:#e3a535;"></i>
      Choose a category or type a keyword to browse products
    </div>
  `;

  await loadProducts();

  /* Restore saved selections from localStorage */
  loadFromStorage();
  renderSelectedList();

  /* Seed the conversation history with the system prompt */
  conversationHistory = [{ role: "system", content: SYSTEM_PROMPT }];

  /* Initial greeting */
  appendMessage(
    "ai",
    "Bonjour! I'm your L'Oréal Beauty Advisor.\n\n" +
    "Browse the categories or search by keyword, click products to build your selection, " +
    "then hit 'Generate My Routine' for a personalised plan.\n\n" +
    "Turn on Web Search (🌐) for up-to-date tips, or just ask me anything about skincare, " +
    "haircare, makeup, or fragrance!"
  );
}

init();
