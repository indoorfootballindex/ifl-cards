// IFL Cards API Worker
// Handles: signup, login, logout, pack pulls, collection fetch

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function err(msg, status = 400) {
  return json({ error: msg }, status);
}

// Simple hash using Web Crypto (no bcrypt available in Workers)
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'ifl-cards-salt-2025');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Generate a random session token
function generateToken() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Get user from session token
async function getUserFromToken(token, db) {
  if (!token) return null;
  const session = await db.prepare(
    'SELECT s.user_id, s.expires_at, u.email, u.username FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ?'
  ).bind(token).first();
  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) return null;
  return session;
}

// Extract token from Authorization header
function getToken(request) {
  const auth = request.headers.get('Authorization') || '';
  return auth.replace('Bearer ', '').trim() || null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // ── POST /api/signup ──
    if (path === '/api/signup' && request.method === 'POST') {
      const { email, username, password } = await request.json();

      if (!email || !username || !password)
        return err('Email, username and password are required');
      if (password.length < 6)
        return err('Password must be at least 6 characters');
      if (username.length < 3)
        return err('Username must be at least 3 characters');

      const hash = await hashPassword(password);

      try {
        const result = await env.DB.prepare(
          'INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)'
        ).bind(email.toLowerCase(), username, hash).run();

        const userId = result.meta.last_row_id;
        const token = generateToken();
        const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

        await env.DB.prepare(
          'INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)'
        ).bind(userId, token, expires).run();

        return json({ token, username, email: email.toLowerCase() });
      } catch (e) {
        if (e.message.includes('UNIQUE')) {
          if (e.message.includes('email')) return err('Email already in use');
          if (e.message.includes('username')) return err('Username already taken');
        }
        return err('Signup failed: ' + e.message, 500);
      }
    }

    // ── POST /api/login ──
    if (path === '/api/login' && request.method === 'POST') {
      const { email, password } = await request.json();
      if (!email || !password) return err('Email and password are required');

      const hash = await hashPassword(password);
      const user = await env.DB.prepare(
        'SELECT id, username, email FROM users WHERE email = ? AND password_hash = ?'
      ).bind(email.toLowerCase(), hash).first();

      if (!user) return err('Invalid email or password', 401);

      const token = generateToken();
      const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      await env.DB.prepare(
        'INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)'
      ).bind(user.id, token, expires).run();

      return json({ token, username: user.username, email: user.email });
    }

    // ── POST /api/logout ──
    if (path === '/api/logout' && request.method === 'POST') {
      const token = getToken(request);
      if (token) {
        await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
      }
      return json({ ok: true });
    }

    // ── GET /api/me ──
    if (path === '/api/me' && request.method === 'GET') {
      const user = await getUserFromToken(getToken(request), env.DB);
      if (!user) return err('Not logged in', 401);
      return json({ username: user.username, email: user.email });
    }

    // ── GET /api/collection ──
    if (path === '/api/collection' && request.method === 'GET') {
      const user = await getUserFromToken(getToken(request), env.DB);
      if (!user) return err('Not logged in', 401);

      const { results } = await env.DB.prepare(
        'SELECT card_file, pack_id, pack_name, pulled_at FROM collections WHERE user_id = ? ORDER BY pulled_at DESC'
      ).bind(user.user_id).all();

      return json({ cards: results });
    }

    // ── POST /api/collect ──
    // Called after a pack is opened — saves all 5 cards
    if (path === '/api/collect' && request.method === 'POST') {
      const user = await getUserFromToken(getToken(request), env.DB);
      if (!user) return err('Not logged in', 401);

      const { cards } = await request.json();
      if (!cards || !Array.isArray(cards)) return err('Invalid cards data');

      const stmt = env.DB.prepare(
        'INSERT INTO collections (user_id, card_file, pack_id, pack_name) VALUES (?, ?, ?, ?)'
      );

      await env.DB.batch(
        cards.map(c => stmt.bind(user.user_id, c.file, c.packId, c.packName))
      );

      return json({ ok: true, saved: cards.length });
    }

    // ── 404 ──
    return err('Not found', 404);
  }
};
