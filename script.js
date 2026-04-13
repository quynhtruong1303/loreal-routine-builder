/* ─────────────────────────────────────────
   L'Oréal Routine Builder — script.js
───────────────────────────────────────── */

/* ── DOM references ── */
const categoryFilter      = document.getElementById("categoryFilter");
const productsContainer   = document.getElementById("productsContainer");
const selectedProductsList = document.getElementById("selectedProductsList");
const selectedCount       = document.getElementById("selectedCount");
const generateBtn         = document.getElementById("generateRoutine");
const clearAllBtn         = document.getElementById("clearAll");
const chatForm            = document.getElementById("chatForm");
const userInput           = document.getElementById("userInput");
const chatWindow          = document.getElementById("chatWindow");
const sendBtn             = document.getElementById("sendBtn");

/* ── Cloudflare Worker endpoint ──
   Requests are routed through a Cloudflare Worker so the OpenAI API
   key is never exposed in the browser.
*/
const CLOUDFLARE_WORKER_URL = "https://loreal-chatbot.quynhtruong1303.workers.dev/";

/* ── State ── */
let allProducts = [];          // full product list loaded from products.json
let selectedIds = new Set();   // IDs of currently selected products
let conversationHistory = [];  // full message history sent to the API each turn
let routineGenerated = false;  // true once the first routine has been generated

/* ── System prompt sent as the first message in every conversation ── */
const SYSTEM_PROMPT = `You are a friendly, knowledgeable L'Oréal Beauty Advisor.
Your role is to help users build personalised skincare, haircare, makeup, and
fragrance routines using L'Oréal-family products (CeraVe, La Roche-Posay,
L'Oréal Paris, Garnier, Lancôme, Kérastase, Maybelline, etc.).

Guidelines:
- Only answer questions related to beauty: skincare, haircare, makeup, fragrance,
  ingredients, and product routines. If a user asks about something completely
  unrelated (politics, sports, coding, etc.), politely decline and redirect them.
- Be warm, encouraging, and inclusive — beauty is for everyone.
- Keep responses concise (2–4 sentences) unless a detailed routine is requested.
- When generating a routine from selected products, provide clear step-by-step
  morning and/or evening instructions based on the product categories.`;

/* ─────────────────────────────────────────
   LocalStorage helpers
───────────────────────────────────────── */

/* Save the current set of selected product IDs to localStorage */
function saveToStorage() {
  localStorage.setItem("lorealSelectedIds", JSON.stringify([...selectedIds]));
}

/* Restore selected IDs from localStorage on page load */
function loadFromStorage() {
  const saved = localStorage.getItem("lorealSelectedIds");
  if (saved) {
    selectedIds = new Set(JSON.parse(saved));
  }
}

/* ─────────────────────────────────────────
   Load & display products
───────────────────────────────────────── */

/* Fetch product data from products.json */
async function loadProducts() {
  const response = await fetch("products.json");
  const data = await response.json();
  allProducts = data.products;
}

/* Build and inject product card HTML for the given array of products */
function displayProducts(products) {
  if (products.length === 0) {
    productsContainer.innerHTML = `
      <div class="placeholder-message">No products found in this category.</div>
    `;
    return;
  }

  /* Map each product to a card HTML string, then join and set innerHTML */
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
              <i class="fa-solid fa-eye"></i> Hover to see description
            </p>
          </div>
        </div>
        <!-- Overlay shown on hover — reveals the product description -->
        <div class="product-desc-overlay">
          <p>${product.description}</p>
        </div>
        <!-- Check mark badge shown when this product is selected -->
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

/* Toggle a product in/out of the selected set */
function toggleSelect(productId) {
  if (selectedIds.has(productId)) {
    selectedIds.delete(productId);
  } else {
    selectedIds.add(productId);
  }

  /* Persist immediately so a refresh retains the list */
  saveToStorage();
  renderSelectedList();

  /* Update the visual state of the card in the grid (if still visible) */
  const card = productsContainer.querySelector(`[data-id="${productId}"]`);
  if (card) {
    card.classList.toggle("selected", selectedIds.has(productId));
  }
}

/* ─────────────────────────────────────────
   Render selected products panel
───────────────────────────────────────── */

/* Re-render the chips list and update the counter badge */
function renderSelectedList() {
  /* Update the count badge in the section heading */
  selectedCount.textContent = selectedIds.size;

  /* Get full product objects for all selected IDs */
  const selected = allProducts.filter(p => selectedIds.has(p.id));

  if (selected.length === 0) {
    selectedProductsList.innerHTML = `
      <p class="no-selection">
        No products selected yet — browse a category and click any card to add it here.
      </p>
    `;
    return;
  }

  /* Render one chip per selected product */
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

/* Append a message bubble to the chat window.
   role: "user" | "ai"
   Returns the created bubble element so callers can update it (e.g. replace "Thinking…"). */
function appendMessage(role, text) {
  /* Add a label above every AI response */
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

  /* Auto-scroll to the newest message */
  chatWindow.scrollTop = chatWindow.scrollHeight;
  return bubble;
}

/* Disable / enable interactive controls while waiting for a response */
function setLoading(isLoading) {
  sendBtn.disabled     = isLoading;
  generateBtn.disabled = isLoading;
  userInput.disabled   = isLoading;
}

/* ─────────────────────────────────────────
   Generate routine (calls Cloudflare Worker)
───────────────────────────────────────── */

async function generateRoutine() {
  /* Collect the full product objects for everything selected */
  const selected = allProducts.filter(p => selectedIds.has(p.id));

  if (selected.length === 0) {
    alert("Please select at least one product before generating a routine.");
    return;
  }

  /* Build a readable product list to include in the prompt */
  const productList = selected.map(p =>
    `• ${p.name} by ${p.brand} (${p.category}): ${p.description}`
  ).join("\n");

  /* The actual instruction sent to the model */
  const routinePrompt =
    `Please create a personalised beauty routine using the following selected products:\n\n` +
    productList +
    `\n\nProvide clear step-by-step morning and/or evening instructions as appropriate for these product types.`;

  /* Reset conversation history so this routine becomes the new context */
  conversationHistory = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user",   content: routinePrompt }
  ];

  /* Show a user-visible summary of what was requested */
  const label = selected.length === 1
    ? `1 product selected`
    : `${selected.length} products selected`;
  appendMessage("user", `Generate my routine — ${label}`);

  setLoading(true);
  const thinkingBubble = appendMessage("ai", "Building your personalised routine…");
  thinkingBubble.classList.add("thinking");

  try {
    const response = await fetch(CLOUDFLARE_WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: conversationHistory })
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data  = await response.json();
    const reply = data.choices[0].message.content;

    /* Replace the placeholder with the real routine */
    thinkingBubble.textContent = reply;
    thinkingBubble.classList.remove("thinking");

    /* Add assistant reply to history so follow-up questions have context */
    conversationHistory.push({ role: "assistant", content: reply });
    routineGenerated = true;

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

  /* Show user's message */
  appendMessage("user", text);
  userInput.value = "";

  /* If the user hasn't generated a routine yet, start with the base system prompt */
  if (conversationHistory.length === 0) {
    conversationHistory = [{ role: "system", content: SYSTEM_PROMPT }];
  }

  /* Append to conversation history */
  conversationHistory.push({ role: "user", content: text });

  setLoading(true);
  const thinkingBubble = appendMessage("ai", "Thinking…");
  thinkingBubble.classList.add("thinking");

  try {
    const response = await fetch(CLOUDFLARE_WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: conversationHistory })
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data  = await response.json();
    const reply = data.choices[0].message.content;

    thinkingBubble.textContent = reply;
    thinkingBubble.classList.remove("thinking");

    /* Save assistant reply so the next question retains full context */
    conversationHistory.push({ role: "assistant", content: reply });

  } catch (err) {
    thinkingBubble.textContent =
      "Sorry, I'm having trouble connecting right now. Please try again.";
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

/* Click on a product card → toggle selection */
productsContainer.addEventListener("click", (e) => {
  const card = e.target.closest(".product-card");
  if (!card) return;
  const productId = parseInt(card.dataset.id, 10);
  toggleSelect(productId);
});

/* Click the × on a chip → remove that product */
selectedProductsList.addEventListener("click", (e) => {
  const removeBtn = e.target.closest(".remove-chip");
  if (!removeBtn) return;
  const productId = parseInt(removeBtn.dataset.id, 10);
  toggleSelect(productId);
});

/* Clear All button → empty the selection */
clearAllBtn.addEventListener("click", () => {
  selectedIds.clear();
  saveToStorage();
  renderSelectedList();

  /* Remove the "selected" class from any visible cards */
  document.querySelectorAll(".product-card.selected").forEach(card => {
    card.classList.remove("selected");
  });
});

/* Generate Routine button */
generateBtn.addEventListener("click", generateRoutine);

/* Category dropdown → filter and display products */
categoryFilter.addEventListener("change", (e) => {
  const category   = e.target.value;
  const filtered   = allProducts.filter(p => p.category === category);
  displayProducts(filtered);
});

/* ─────────────────────────────────────────
   Initialise on page load
───────────────────────────────────────── */

async function init() {
  /* Show placeholder while products haven't been loaded yet */
  productsContainer.innerHTML = `
    <div class="placeholder-message">
      <i class="fa-solid fa-layer-group" style="margin-right:8px;color:#e3a535;"></i>
      Choose a category above to browse products
    </div>
  `;

  /* Load all product data from the JSON file */
  await loadProducts();

  /* Restore any previously saved selections from localStorage */
  loadFromStorage();
  renderSelectedList();

  /* Initialise the conversation with the system prompt */
  conversationHistory = [{ role: "system", content: SYSTEM_PROMPT }];

  /* Greet the user */
  appendMessage(
    "ai",
    "Bonjour! I'm your L'Oréal Beauty Advisor 💄\n\n" +
    "Browse the product categories above, click cards to build your selection, " +
    "then hit 'Generate My Routine' for a personalised plan. " +
    "You can also ask me anything about skincare, haircare, makeup, or fragrance!"
  );
}

init();
