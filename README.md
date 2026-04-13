# Project 9: L'Oréal Smart Routine & Product Advisor

A product-aware AI chatbot that lets users browse real L'Oréal brand products, build a personalised routine, and chat with a virtual beauty advisor.

## Features

- **Product Browsing** — filter products by category (Cleansers, Moisturizers, Haircare, Makeup, and more) from a curated `products.json` dataset spanning CeraVe, La Roche-Posay, L'Oréal Paris, Garnier, Lancôme, and other brands
- **Keyword Search** — type in the search field to filter products by name, brand, or keyword; works alongside the category filter
- **Product Description Reveal** — hover over any product card to see its full description
- **Product Selection** — click cards to select or deselect products; selected items appear as chips in the Selected Products panel
- **AI Routine Generator** — click "Generate My Routine" to send your selected products to the AI and receive a personalised step-by-step morning/evening routine
- **Web Search** — toggle the 🌐 button to enable live web search; responses are powered by `gpt-4o-search-preview` and include clickable source citations

## Tech Stack

- Plain HTML, CSS, and JavaScript (no frameworks or bundlers)
- [products.json](products.json) as the product data source
- OpenAI `gpt-4o` / `gpt-4o-search-preview` via a Cloudflare Worker
- `localStorage` for client-side persistence

## Cloudflare Worker

API requests are routed through a Cloudflare Worker (`worker-web-search.js`) so the OpenAI API key is never exposed in the browser. The worker selects the model based on a `webSearch` flag sent by the client:

| `webSearch` | Model used |
|---|---|
| `false` | `gpt-4o` |
| `true` | `gpt-4o-search-preview` |

### Deploying the worker

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → your worker
2. Replace the worker code with the contents of `worker-web-search.js`
3. Confirm the `OPENAI_API_KEY` secret is set under **Settings → Variables**
4. Deploy

### Try It Out [Here!](https://quynhtruong1303.github.io/loreal-routine-builder/)
