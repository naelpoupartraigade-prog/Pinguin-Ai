// ═══════════════════════════════════════════════════════════════
//  PINGUIN IA — Cloudflare Worker (Backend sécurisé)
//  Déploiement : https://workers.cloudflare.com (compte gratuit)
//
//  ÉTAPES :
//  1. Créez un compte sur https://workers.cloudflare.com
//  2. Créez un Worker nommé "pinguin-ia-proxy"
//  3. Collez ce code dans l'éditeur
//  4. Allez dans Settings → Variables → Ajoutez une variable secrète :
//       Nom : GROQ_API_KEY
//       Valeur : votre clé Groq (gsk_...)
//  5. Cliquez "Deploy"
//  6. Copiez l'URL du Worker (ex: pinguin-ia-proxy.PSEUDO.workers.dev)
//  7. Collez cette URL dans index.html à la ligne WORKER_URL
// ═══════════════════════════════════════════════════════════════

const ALLOWED_ORIGINS = [
  'https://naelpoupartraigade-prog.github.io',
  'http://localhost',
  'http://127.0.0.1',
];

const CORS_HEADERS = (origin) => ({
  'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-User-Id',
  'Access-Control-Max-Age': '86400',
});

// Rate limiting simple (par IP)
const RATE_MAP = new Map();
function rateLimit(ip) {
  const now = Date.now();
  const entry = RATE_MAP.get(ip) || { count: 0, reset: now + 60000 };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + 60000; }
  entry.count++;
  RATE_MAP.set(ip, entry);
  return entry.count > 30; // max 30 req/minute par IP
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const corsH = CORS_HEADERS(origin);

    // Preflight CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsH });
    }

    const url = new URL(request.url);

    // ── Route : /chat ──────────────────────────────────────
    if (url.pathname === '/chat' && request.method === 'POST') {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      if (rateLimit(ip)) {
        return new Response(JSON.stringify({ error: 'rate_limit' }), {
          status: 429, headers: { ...corsH, 'Content-Type': 'application/json' }
        });
      }

      const apiKey = env.GROQ_API_KEY;
      if (!apiKey) {
        return new Response(JSON.stringify({ error: 'not_configured' }), {
          status: 503, headers: { ...corsH, 'Content-Type': 'application/json' }
        });
      }

      let body;
      try { body = await request.json(); } catch {
        return new Response(JSON.stringify({ error: 'invalid_json' }), {
          status: 400, headers: { ...corsH, 'Content-Type': 'application/json' }
        });
      }

      if (!body.messages || !Array.isArray(body.messages)) {
        return new Response(JSON.stringify({ error: 'invalid_request' }), {
          status: 400, headers: { ...corsH, 'Content-Type': 'application/json' }
        });
      }

      // Appel à Groq (côté serveur, clé jamais exposée au client)
      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 1500,
          messages: body.messages,
          ...(body.system ? { system: body.system } : {}),
        })
      });

      const data = await groqRes.json();
      return new Response(JSON.stringify(data), {
        status: groqRes.status,
        headers: { ...corsH, 'Content-Type': 'application/json' }
      });
    }

    // ── Route : /status ────────────────────────────────────
    // Vérifie si la clé est configurée (sans la révéler)
    if (url.pathname === '/status' && request.method === 'GET') {
      const configured = !!(env.GROQ_API_KEY);
      return new Response(JSON.stringify({ configured, worker: 'pinguin-ia-proxy' }), {
        headers: { ...corsH, 'Content-Type': 'application/json' }
      });
    }

    return new Response('Pinguin IA Worker — OK', { status: 200, headers: corsH });
  }
};
