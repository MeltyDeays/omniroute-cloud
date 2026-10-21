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

const GROQ_KEYS = (process.env.GROQ_API_KEYS || unmask([
  8,30,5,54,68,11,69,56,85,121,73,52,52,41,31,36,88,38,83,4,90,92,8,16,56,50,16,28,79,67,51,59,60,11,9,103,5,95,41,33,41,43,11,9,18,34,53,93,66,77,49,5,37,8,124,44,29,8,30,5,54,29,43,69,0,38,93,57,38,82,25,93,37,100,53,67,45,5,62,81,23,56,50,16,28,79,67,51,59,92,46,51,74,37,75,44,5,8,10,49,44,27,46,6,105,51,0,23,93,48,6,29,33,29,8,30,5,54,6,59,29,27,32,98,67,66,1,46,51,54,87,52,105,1,24,35,47,40,56,50,16,28,79,67,51,59,32,0,36,106,1,73,6,0,47,10,53,40,54,2,81,67,32,54,50,38,44,6,74,14,29,8,30,5,54,35,8,33,46,22,127,52,36,1,7,95,23,99,32,119,31,40,41,1,16,56,50,16,28,79,67,51,59,61,7,82,25,23,120,3,26,88,45,57,55,37,71,32,20,36,4,39,60,36,51,66,64
])).split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);

let groqKeyIndex = 0;
function getGroqKey() {
  if (GROQ_KEYS.length === 0) return null;
  const k = GROQ_KEYS[groqKeyIndex % GROQ_KEYS.length];
  groqKeyIndex++;
  return k;
}

const GROQ_MODELS = new Set([
  'qwen/qwen3.8-27b',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'allam-2-7b',
  'meta-llama/llama-prompt-guard-2-86m',
]);

const POLLINATIONS_MODELS = new Set([
  'openai-fast',
  'free/openai',
  'free/chatgpt',
]);

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || unmask([
  28,6,67,6,0,66,3,69,72,31,22,22,1,92,80,87,26,78,8,90,14,93,11,74,92,19,68,83,73,20,76,86,93,8,86,78,65,3,9,8,90,89,64,87,71,16,84,27,22,68,84,14,88,90,75,16,5,92,14,13,15,67,90,68,76,0,24,73,76,7,92,12,82
]);

const OPENROUTER_MODELS = new Set([
  'openrouter/free',
  'openrouter/auto',
  'openrouter/google/gemma-4-31b-it:free',
  'openrouter/nvidia/nemotron-3.5-lightning:free',
  'openrouter/minimax/minimax-m3.1-flash:free',
  'openrouter/poolside/laguna-s-2.1:free',
]);

function isOpenRouterModel(model) {
  return model.startsWith('openrouter/') || model.includes(':free') || OPENROUTER_MODELS.has(model);
}

async function callOpenRouterUpstream(model, messages, stream = false, maxTokens = null) {
  if (!OPENROUTER_API_KEY) throw new Error('No OpenRouter API key available');
  let targetModel = model;
  if (targetModel.startsWith('openrouter/') && targetModel !== 'openrouter/free' && targetModel !== 'openrouter/auto') {
    targetModel = targetModel.slice('openrouter/'.length);
  }
  const payload = {
    model: targetModel,
    messages,
    stream,
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
  };
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://omniroute.ai',
      'X-Title': 'OmniRoute Cloud Gateway',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text();
    const err = new Error(`OpenRouter ${targetModel} error (${res.status}): ${txt.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res;
}

async function callGroqUpstream(model, messages, stream = false, maxTokens = null) {
  const apiKey = getGroqKey();
  if (!apiKey) throw new Error('No Groq API key available');
  const payload = {
    model,
    messages,
    stream,
    max_tokens: maxTokens || 1024,
  };
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text();
    const err = new Error(`Groq ${model} error (${res.status}): ${txt.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res;
}

async function callPollinationsUpstream(model, messages) {
  const res = await fetch('https://text.pollinations.ai/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, model: 'openai-fast' }),
  });
  if (!res.ok) {
    const txt = await res.text();
    const err = new Error(`Pollinations error (${res.status}): ${txt.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res;
}

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
  'combo/coding': ['claude-sonnet-5', 'claude-sonnet-4-6', 'openrouter/free', 'qwen/qwen3.8-27b', 'openai-fast'],
  'combo/documents': ['gemini-3.1-pro', 'claude-sonnet-4-6', 'openrouter/free', 'openai/gpt-oss-120b', 'openai-fast'],
  'combo/deep-reasoning': ['claude-opus-4-6-thinking', 'claude-sonnet-5', 'openrouter/free', 'openai/gpt-oss-120b'],
  'combo/fast-review': ['claude-sonnet-4-6', 'gemini-3.1-pro', 'openrouter/free', 'qwen/qwen3.8-27b', 'openai-fast'],
  'combo/free': ['openrouter/free', 'qwen/qwen3.8-27b', 'openai/gpt-oss-120b', 'openai-fast'],
  'coding': ['claude-sonnet-5', 'claude-sonnet-4-6', 'openrouter/free', 'qwen/qwen3.8-27b'],
  'documents': ['gemini-3.1-pro', 'claude-sonnet-4-6', 'openrouter/free', 'openai/gpt-oss-120b'],
  'deep-reasoning': ['claude-opus-4-6-thinking', 'claude-sonnet-5', 'openrouter/free', 'openai/gpt-oss-120b'],
  'fast-review': ['claude-sonnet-4-6', 'gemini-3.1-pro', 'openrouter/free', 'qwen/qwen3.8-27b'],
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
  'qwen': 'qwen/qwen3.8-27b',
  'groq/qwen': 'qwen/qwen3.8-27b',
  'gpt-oss': 'openai/gpt-oss-120b',
  'groq/gpt-oss': 'openai/gpt-oss-120b',
  'free/qwen': 'qwen/qwen3.8-27b',
  'free/gpt-oss': 'openai/gpt-oss-120b',
  'free/openai': 'openai-fast',
  'free/chatgpt': 'openai-fast',
  'openrouter': 'openrouter/free',
  'or/free': 'openrouter/free',
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
      'openrouter/free',
      'openrouter/auto',
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
        let providerType = 'antigravity';

        for (const m of candidateModels) {
          try {
            usedModel = m;
            if (GROQ_MODELS.has(m)) {
              providerType = 'groq';
              upstreamRes = await callGroqUpstream(m, json.messages || [], stream, json.max_tokens || json.max_completion_tokens);
            } else if (isOpenRouterModel(m)) {
              providerType = 'openrouter';
              upstreamRes = await callOpenRouterUpstream(m, json.messages || [], stream, json.max_tokens || json.max_completion_tokens);
            } else if (POLLINATIONS_MODELS.has(m)) {
              providerType = 'pollinations';
              upstreamRes = await callPollinationsUpstream(m, json.messages || []);
            } else {
              providerType = 'antigravity';
              upstreamRes = await callAntigravityUpstream(m, contents, stream);
            }
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

        if (providerType === 'groq' || providerType === 'openrouter') {
          if (stream) {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
            });
            const reader = upstreamRes.body.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              res.write(value);
            }
            res.end();
            return;
          } else {
            const outJson = await upstreamRes.json();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(outJson));
            return;
          }
        }

        if (providerType === 'pollinations') {
          const fullText = await upstreamRes.text();
          if (stream) {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
            });
            const chunk = {
              id: completionId,
              object: 'chat.completion.chunk',
              created,
              model: requestedModel,
              choices: [{ index: 0, delta: { content: fullText }, finish_reason: null }],
            };
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            res.write(`data: ${JSON.stringify({ id: completionId, object: 'chat.completion.chunk', created, model: requestedModel, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          } else {
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
            return;
          }
        }

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
        let providerType = 'antigravity';
        let fullText = '';

        for (const m of candidateModels) {
          try {
            if (GROQ_MODELS.has(m)) {
              providerType = 'groq';
              const r = await callGroqUpstream(m, json.messages || [], false, json.max_tokens || 1024);
              const d = await r.json();
              fullText = d.choices?.[0]?.message?.content || '';
              upstreamRes = r;
            } else if (isOpenRouterModel(m)) {
              providerType = 'openrouter';
              const r = await callOpenRouterUpstream(m, json.messages || [], false, json.max_tokens || 1024);
              const d = await r.json();
              fullText = d.choices?.[0]?.message?.content || '';
              upstreamRes = r;
            } else if (POLLINATIONS_MODELS.has(m)) {
              providerType = 'pollinations';
              const r = await callPollinationsUpstream(m, json.messages || []);
              fullText = await r.text();
              upstreamRes = r;
            } else {
              providerType = 'antigravity';
              upstreamRes = await callAntigravityUpstream(m, contents, false);
            }
            break;
          } catch (err) {
            console.warn(`[ROUTER] Anthropic fallback ${m} failed (${err.message}). Trying next...`);
          }
        }

        if (!upstreamRes) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'All models failed', type: 'api_error' } }));
          return;
        }

        if (providerType === 'antigravity') {
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
                  if (text) fullText += text;
                } catch (_) {}
              }
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
