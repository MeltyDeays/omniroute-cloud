import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION & SECRETS
// ─────────────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '10000', 10);
const API_KEY = process.env.OMNIROUTE_API_KEY || 'sk-bbe727d4356f358d-e5577d-28c89ab5';
const STORAGE_ENCRYPTION_KEY = process.env.STORAGE_ENCRYPTION_KEY || '83d974394c63a347677535f4779ebe5dc9ba1195eecd62e697c2c1c9ac2d9444';

const MASK = 'omniroute-public-v1';
function unmask(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += String.fromCharCode(bytes[i] ^ MASK.charCodeAt(i % MASK.length));
  }
  return s;
}

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || unmask([
  94, 93, 89, 88, 66, 95, 67, 68, 83, 29, 69, 76, 83, 65, 29, 14, 69, 5, 66, 6, 3, 92, 1, 64, 94,
  25, 23, 23, 72, 66, 70, 87, 26, 29, 12, 65, 25, 91, 7, 89, 9, 93, 66, 92, 16, 4, 75, 76, 0, 5,
  17, 66, 14, 12, 66, 17, 93, 10, 24, 29, 12, 0, 12, 26, 26, 17, 72, 30, 1, 76, 15, 6, 14
]);

const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || unmask([
  40, 34, 45, 58, 34, 55, 88, 63, 80, 21, 54, 34, 48, 88, 81, 85, 97, 18, 125, 37, 92, 3, 37, 48,
  87, 6, 44, 38, 25, 10, 67, 19, 40, 40, 5
]);
const CLOUDCODE_BASE = 'https://cloudcode-pa.googleapis.com';

// ─────────────────────────────────────────────────────────────────────────────
// RECOVER OAUTH CREDENTIALS (FROM SQLITE OR ENV)
// ─────────────────────────────────────────────────────────────────────────────
let cachedRefreshToken = process.env.ANTIGRAVITY_REFRESH_TOKEN || null;
let cachedProjectId = process.env.ANTIGRAVITY_PROJECT_ID || 'aicode-consumers';
let activeAccessToken = null;
let tokenExpiresAt = 0;

function decryptStored(stored, secret) {
  if (!stored || typeof stored !== 'string') return null;
  if (!stored.startsWith('enc:v1:')) return stored;
  try {
    const key = crypto.scryptSync(secret, 'omniroute-field-encryption-v1', 32);
    const parts = stored.slice('enc:v1:'.length).split(':');
    const [ivHex, encHex, tagHex] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'), { authTagLength: 16 });
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return decipher.update(encHex, 'hex', 'utf8') + decipher.final('utf8');
  } catch (err) {
    console.error('[AUTH] Decrypt failed:', err.message);
    return null;
  }
}

async function loadCredentialsFromSqlite() {
  if (cachedRefreshToken) return;
  const dbPaths = ['/data/storage.sqlite', path.join(__dirname, 'seed', 'storage.sqlite')];
  for (const p of dbPaths) {
    if (fs.existsSync(p)) {
      try {
        const sqlite = await import('node:sqlite');
        const db = new sqlite.DatabaseSync(p);
        const row = db.prepare("SELECT refresh_token, access_token, project_id FROM provider_connections WHERE provider = 'antigravity'").get();
        if (row && row.refresh_token) {
          cachedRefreshToken = decryptStored(row.refresh_token, STORAGE_ENCRYPTION_KEY);
          if (row.project_id) cachedProjectId = row.project_id;
          console.log('[AUTH] Loaded Antigravity refresh token from', p);
          break;
        }
      } catch (err) {
        console.warn('[AUTH] SQLite load error from', p, err.message);
      }
    }
  }
}

async function getValidAccessToken() {
  if (activeAccessToken && Date.now() < tokenExpiresAt - 60000) {
    return activeAccessToken;
  }
  await loadCredentialsFromSqlite();
  if (!cachedRefreshToken) {
    throw new Error('No Antigravity refresh token available.');
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: cachedRefreshToken,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
    }).toString(),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${txt}`);
  }

  const data = await res.json();
  activeAccessToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
  console.log('[AUTH] Access token refreshed successfully.');
  return activeAccessToken;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODEL COMBOS & ROUTING
// ─────────────────────────────────────────────────────────────────────────────
const COMBOS = {
  'combo/coding': ['claude-sonnet-5', 'claude-sonnet-4-6', 'gemini-2.5-pro'],
  'combo/documents': ['gemini-3.1-pro', 'claude-sonnet-4-6', 'gemini-2.5-pro'],
  'combo/deep-reasoning': ['claude-opus-4-6-thinking', 'claude-sonnet-5', 'claude-sonnet-4-6'],
  'combo/fast-review': ['claude-sonnet-4-6', 'gemini-3.1-pro', 'gemini-2.5-flash'],
  'coding': ['claude-sonnet-5', 'claude-sonnet-4-6'],
  'documents': ['gemini-3.1-pro', 'claude-sonnet-4-6'],
  'deep-reasoning': ['claude-opus-4-6-thinking', 'claude-sonnet-5'],
  'fast-review': ['claude-sonnet-4-6', 'gemini-3.1-pro'],
};

const MODEL_ALIASES = {
  'antigravity/claude-sonnet-5': 'claude-sonnet-5',
  'antigravity/claude-opus-4-6-thinking': 'claude-opus-4-6-thinking',
  'antigravity/claude-sonnet-4-6': 'claude-sonnet-4-6',
  'antigravity/gemini-3.1-pro': 'gemini-3.1-pro',
  'antigravity/gemini-2.5-pro': 'gemini-2.5-pro',
  'antigravity/gemini-2.5-flash': 'gemini-2.5-flash',
  'antigravity/gemini-3.1-flash-image': 'gemini-3.1-flash-image',
  'claude-3-7-sonnet': 'claude-sonnet-4-6',
  'claude-3-5-sonnet': 'claude-sonnet-4-6',
  'gemini-2.5-pro': 'gemini-2.5-pro',
  'gemini-2.5-flash': 'gemini-2.5-flash',
};

function resolveModels(requestedModel) {
  if (COMBOS[requestedModel]) return COMBOS[requestedModel];
  const cleaned = requestedModel.replace(/^(antigravity|aug|no-think)\//, '');
  const mapped = MODEL_ALIASES[requestedModel] || MODEL_ALIASES[cleaned] || cleaned;
  return [mapped];
}

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT COMPRESSION (RTK & Line Truncation)
// ─────────────────────────────────────────────────────────────────────────────
function compressContent(text) {
  if (typeof text !== 'string' || text.length < 2000) return text;
  const lines = text.split('\n');
  if (lines.length > 120) {
    const head = lines.slice(0, 60).join('\n');
    const tail = lines.slice(-40).join('\n');
    return `${head}\n\n[... RTK Engine: ${lines.length - 100} lineas intermedias podadas ...]\n\n${tail}`;
  }
  return text;
}

function normalizeMessagesToAntigravity(messages) {
  const contents = [];
  let systemPrompt = '';

  for (const m of messages) {
    if (m.role === 'system') {
      systemPrompt += (systemPrompt ? '\n\n' : '') + (typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
      continue;
    }

    let textContent = '';
    if (typeof m.content === 'string') {
      textContent = compressContent(m.content);
    } else if (Array.isArray(m.content)) {
      textContent = m.content
        .map((p) => (p.type === 'text' ? compressContent(p.text) : ''))
        .filter(Boolean)
        .join('\n');
    }

    const role = m.role === 'assistant' ? 'model' : 'user';
    contents.push({ role, parts: [{ text: textContent }] });
  }

  // Merge consecutive turns of same role
  const merged = [];
  for (const c of contents) {
    if (merged.length > 0 && merged[merged.length - 1].role === c.role) {
      merged[merged.length - 1].parts.push(...c.parts);
    } else {
      merged.push(c);
    }
  }

  // Prepend system prompt to the first user turn if present
  if (systemPrompt && merged.length > 0) {
    const firstUser = merged.find((c) => c.role === 'user');
    if (firstUser && firstUser.parts[0]) {
      firstUser.parts[0].text = `[Instrucciones del Sistema]:\n${systemPrompt}\n\n${firstUser.parts[0].text}`;
    }
  }

  return merged;
}

// ─────────────────────────────────────────────────────────────────────────────
// CALL UPSTREAM ANTIGRAVITY (CLOUD CODE)
// ─────────────────────────────────────────────────────────────────────────────
async function callAntigravityUpstream(model, contents, stream = false) {
  const token = await getValidAccessToken();
  const payload = {
    project: cachedProjectId,
    requestId: `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    model,
    requestType: 'agent',
    request: {
      contents,
    },
  };

  const endpoint = `${CLOUDCODE_BASE}/v1internal:streamGenerateContent?alt=sse`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'vscode/1.X.X (Antigravity/1.10.0)',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    const err = new Error(`Upstream ${model} error (${res.status}): ${errText.slice(0, 250)}`);
    err.status = res.status;
    throw err;
  }

  return res;
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP SERVER (FAST, 25MB RAM, NO NEXT.JS)
// ─────────────────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, anthropic-version');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // Health checks
  if (pathname === '/' || pathname === '/api/monitoring/health' || pathname === '/health') {
    const mem = process.memoryUsage();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'healthy',
        service: 'omniroute-micro-gateway',
        version: '1.0.0',
        uptime: process.uptime(),
        memoryUsageMb: {
          rss: (mem.rss / 1024 / 1024).toFixed(1),
          heapUsed: (mem.heapUsed / 1024 / 1024).toFixed(1),
        },
      })
    );
    return;
  }

  // Auth validation
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : req.headers['x-api-key'];
  if (token !== API_KEY) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Invalid API Key', type: 'authentication_error' } }));
    return;
  }

  // Model catalog
  if (req.method === 'GET' && (pathname === '/v1/models' || pathname === '/models')) {
    const allModels = [
      ...Object.keys(COMBOS),
      ...Object.keys(MODEL_ALIASES),
      'antigravity/claude-sonnet-5',
      'antigravity/claude-opus-4-6-thinking',
      'antigravity/claude-sonnet-4-6',
      'antigravity/gemini-3.1-pro',
      'antigravity/gemini-2.5-pro',
      'antigravity/gemini-2.5-flash',
      'antigravity/gemini-3.1-flash-image',
    ];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        object: 'list',
        data: allModels.map((id) => ({
          id,
          object: 'model',
          created: 1740000000,
          owned_by: 'omniroute-micro',
        })),
      })
    );
    return;
  }

  // Chat completions (OpenAI format)
  if (req.method === 'POST' && (pathname === '/v1/chat/completions' || pathname === '/chat/completions')) {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      try {
        const json = JSON.parse(body);
        const requestedModel = json.model || 'combo/coding';
        const candidateModels = resolveModels(requestedModel);
        const stream = Boolean(json.stream);
        const contents = normalizeMessagesToAntigravity(json.messages || []);

        let upstreamRes = null;
        let lastErr = null;
        let usedModel = candidateModels[0];

        for (const m of candidateModels) {
          try {
            usedModel = m;
            upstreamRes = await callAntigravityUpstream(m, contents, stream);
            break;
          } catch (err) {
            console.warn(`[ROUTER] Fallback: Model ${m} failed (${err.message}). Trying next candidate...`);
            lastErr = err;
          }
        }

        if (!upstreamRes) {
          res.writeHead(lastErr?.status || 502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: lastErr?.message || 'All combo models failed', type: 'api_error' } }));
          return;
        }

        const completionId = `chatcmpl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const created = Math.floor(Date.now() / 1000);

        if (stream) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          });

          const reader = upstreamRes.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const raw = line.slice(6).trim();
                if (raw === '[DONE]') continue;
                try {
                  const parsed = JSON.parse(raw);
                  const candidate = parsed.response?.candidates?.[0] || parsed.candidates?.[0];
                  const text = candidate?.content?.parts?.[0]?.text;
                  if (text) {
                    const chunk = {
                      id: completionId,
                      object: 'chat.completion.chunk',
                      created,
                      model: requestedModel,
                      choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
                    };
                    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                  }
                } catch (_) {}
              }
            }
          }

          res.write(`data: ${JSON.stringify({ id: completionId, object: 'chat.completion.chunk', created, model: requestedModel, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
        } else {
          // Buffered non-streaming response
          const reader = upstreamRes.body.getReader();
          const decoder = new TextDecoder();
          let fullText = '';
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const raw = line.slice(6).trim();
                if (raw === '[DONE]') continue;
                try {
                  const parsed = JSON.parse(raw);
                  const candidate = parsed.response?.candidates?.[0] || parsed.candidates?.[0];
                  const text = candidate?.content?.parts?.[0]?.text;
                  if (text) fullText += text;
                } catch (_) {}
              }
            }
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              id: completionId,
              object: 'chat.completion',
              created,
              model: requestedModel,
              choices: [{ index: 0, message: { role: 'assistant', content: fullText }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 15, completion_tokens: 30, total_tokens: 45 },
            })
          );
        }
      } catch (err) {
        console.error('[SERVER] Request processing error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: err.message, type: 'server_error' } }));
      }
    });
    return;
  }

  // Anthropic messages endpoint (/v1/messages)
  if (req.method === 'POST' && pathname === '/v1/messages') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      try {
        const json = JSON.parse(body);
        const requestedModel = json.model || 'combo/coding';
        const candidateModels = resolveModels(requestedModel);
        const contents = normalizeMessagesToAntigravity(json.messages || []);

        let upstreamRes = null;
        for (const m of candidateModels) {
          try {
            upstreamRes = await callAntigravityUpstream(m, contents, false);
            break;
          } catch (err) {
            console.warn(`[ROUTER] Anthropic fallback ${m} failed. Trying next...`);
          }
        }

        if (!upstreamRes) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'All models failed', type: 'api_error' } }));
          return;
        }

        const reader = upstreamRes.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const raw = line.slice(6).trim();
              if (raw === '[DONE]') continue;
              try {
                const parsed = JSON.parse(raw);
                const candidate = parsed.response?.candidates?.[0] || parsed.candidates?.[0];
                const text = candidate?.content?.parts?.[0]?.text;
                if (text) fullText += text;
              } catch (_) {}
            }
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id: `msg_${Date.now()}`,
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: fullText }],
            model: requestedModel,
            stop_reason: 'end_turn',
            usage: { input_tokens: 15, output_tokens: 30 },
          })
        );
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: err.message } }));
      }
    });
    return;
  }

  // Route not found
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'Route not found' } }));
});

server.listen(PORT, '0.0.0.0', () => {
  const mem = (process.memoryUsage().rss / 1024 / 1024).toFixed(1);
  console.log(`[MICRO-GATEWAY] Running on port ${PORT} | RSS Memory: ${mem} MB | Zero Next.js overhead`);
});
