/* ─────────────────────────────────────────────────────────────
   L'Oréal Routine Builder — Cloudflare Worker
   ─────────────────────────────────────────────────────────────
   DEPLOYMENT INSTRUCTIONS
   ────────────────────────
   1. Go to dash.cloudflare.com → Workers & Pages → your existing
      "loreal-chatbot" worker (or create a new one).
   2. Replace the worker code with this entire file.
   3. Make sure the OPENAI_API_KEY environment variable (secret)
      is still set in the worker's Settings → Variables tab.
   4. Save and deploy.

   HOW IT WORKS
   ─────────────
   The browser sends:
     { messages: [...], webSearch: true | false }

   When webSearch is false  → uses "gpt-4o" (standard model).
   When webSearch is true   → uses "gpt-4o-search-preview",
     which searches the live web and returns citations inside
     choices[0].message.annotations.

   The worker forwards the full OpenAI response back to the
   browser so script.js can parse both the text reply and any
   url_citation annotations.
─────────────────────────────────────────────────────────────── */

export default {
  async fetch(request, env) {

    /* ── Handle CORS pre-flight (browsers send OPTIONS first) ── */
    if (request.method === "OPTIONS") {
      return corsResponse("", 204);
    }

    /* ── Parse incoming request body ── */
    let messages, webSearch;
    try {
      const body = await request.json();
      messages   = body.messages;
      webSearch  = body.webSearch === true;
    } catch {
      return corsResponse(JSON.stringify({ error: "Invalid JSON body" }), 400);
    }

    /* ── Choose the right OpenAI model ── */
    const model = webSearch ? "gpt-4o-search-preview" : "gpt-4o";

    /* ── Build the OpenAI request body ── */
    const openAIBody = { model, messages };

    /* web_search_options is only valid with the search-preview model */
    if (webSearch) {
      openAIBody.web_search_options = {
        search_context_size: "medium"   /* "low" | "medium" | "high" */
      };
    }

    /* ── Call the OpenAI Chat Completions API ── */
    let openAIResponse;
    try {
      openAIResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${env.OPENAI_API_KEY}`
        },
        body: JSON.stringify(openAIBody)
      });
    } catch (err) {
      return corsResponse(
        JSON.stringify({ error: "Failed to reach OpenAI", detail: err.message }),
        502
      );
    }

    /* ── Forward the full OpenAI response back to the browser ──
       This includes choices[0].message.content (the reply text)
       and, for web-search requests, choices[0].message.annotations
       (an array of url_citation objects with url and title). */
    const data = await openAIResponse.json();
    return corsResponse(JSON.stringify(data), openAIResponse.status);
  }
};

/* ── Helper: attach CORS headers to every response ── */
function corsResponse(body, status) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type":                "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods":"POST, OPTIONS",
      "Access-Control-Allow-Headers":"Content-Type"
    }
  });
}
