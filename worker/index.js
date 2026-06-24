// IFL Cards – single Worker for both static assets and API
// API routes: /api/signup, /api/login, /api/logout, /api/me, /api/collection, /api/collect

const ALLOWED_ORIGINS = [
  'https://cards.indoorfootballindex.com',
  'http://cards.indoorfootballindex.com',
  'https://ifl-cards.indoorfootballindex.workers.dev',
  'http://localhost',
  'null',
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(data, status = 200, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

function err(msg, status = 400, origin) {
  return json({ error: msg }, status, origin);
}

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'ifl-cards-salt-2025');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateToken() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getUserFromToken(token, db) {
  if (!token) return null;
  const session = await db.prepare(
    'SELECT s.user_id, s.expires_at, u.email, u.username FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ?'
  ).bind(token).first();
  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) return null;
  return session;
}

function getToken(request) {
  const auth = request.headers.get('Authorization') || '';
  return auth.replace('Bearer ', '').trim() || null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const origin = request.headers.get('Origin') || '*';

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // ── Static assets — pass through to ASSETS binding ──
    if (!path.startsWith('/api/')) {
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return new Response('Not found', { status: 404 });
    }

    // ── POST /api/signup ──
    if (path === '/api/signup' && request.method === 'POST') {
      const { email, username, password } = await request.json();
      if (!email || !username || !password) return err('Email, username and password are required', 400, origin);
      if (password.length < 6) return err('Password must be at least 6 characters', 400, origin);
      if (username.length < 3) return err('Username must be at least 3 characters', 400, origin);
      const hash = await hashPassword(password);
      try {
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        const result = await env.DB.prepare(
          'INSERT INTO users (email, username, password_hash, packs_remaining, last_pack_reset) VALUES (?, ?, ?, 5, ?)'
        ).bind(email.toLowerCase(), username, hash, yesterday).run();
        const userId = result.meta.last_row_id;
        const token = generateToken();
        const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        await env.DB.prepare(
          'INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)'
        ).bind(userId, token, expires).run();
        return json({ token, username, email: email.toLowerCase() }, 200, origin);
      } catch (e) {
        if (e.message.includes('UNIQUE')) {
          if (e.message.includes('email')) return err('Email already in use', 400, origin);
          if (e.message.includes('username')) return err('Username already taken', 400, origin);
        }
        return err('Signup failed: ' + e.message, 500, origin);
      }
    }

    // ── POST /api/login ──
    if (path === '/api/login' && request.method === 'POST') {
      const { email, password } = await request.json();
      if (!email || !password) return err('Email and password are required', 400, origin);
      const hash = await hashPassword(password);
      const user = await env.DB.prepare(
        'SELECT id, username, email FROM users WHERE email = ? AND password_hash = ?'
      ).bind(email.toLowerCase(), hash).first();
      if (!user) return err('Invalid email or password', 401, origin);
      const token = generateToken();
      const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      await env.DB.prepare(
        'INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)'
      ).bind(user.id, token, expires).run();
      return json({ token, username: user.username, email: user.email }, 200, origin);
    }

    // ── POST /api/logout ──
    if (path === '/api/logout' && request.method === 'POST') {
      const token = getToken(request);
      if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
      return json({ ok: true }, 200, origin);
    }

    // ── GET /api/me ──
    if (path === '/api/me' && request.method === 'GET') {
      const user = await getUserFromToken(getToken(request), env.DB);
      if (!user) return err('Not logged in', 401, origin);
      return json({ username: user.username, email: user.email }, 200, origin);
    }

    // ── GET /api/collection ──
    if (path === '/api/collection' && request.method === 'GET') {
      const user = await getUserFromToken(getToken(request), env.DB);
      if (!user) return err('Not logged in', 401, origin);
      const { results } = await env.DB.prepare(
        'SELECT card_file, pack_id, pack_name, card_rarity, pulled_at FROM collections WHERE user_id = ? ORDER BY pulled_at DESC'
      ).bind(user.user_id).all();
      const userData = await env.DB.prepare(
        'SELECT packs_opened FROM users WHERE id = ?'
      ).bind(user.user_id).first();
      return json({ cards: results, packs_opened: userData?.packs_opened || 0 }, 200, origin);
    }

    // ── GET /api/packs ──
    // Returns packs_remaining for logged-in users, resets daily.
    if (path === '/api/packs' && request.method === 'GET') {
      const user = await getUserFromToken(getToken(request), env.DB);
      if (!user) return json({ packs_remaining: null, guest: true }, 200, origin);

      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
      const row = await env.DB.prepare(
        'SELECT packs_remaining, last_pack_reset FROM users WHERE id = ?'
      ).bind(user.user_id).first();

      let remaining = row?.packs_remaining ?? 5;
      const lastReset = row?.last_pack_reset || '';

      if (lastReset !== today) {
        remaining = 5;
        await env.DB.prepare(
          'UPDATE users SET packs_remaining = 5, last_pack_reset = ? WHERE id = ?'
        ).bind(today, user.user_id).run();
      }

      return json({ packs_remaining: remaining, reset_date: today }, 200, origin);
    }

    // ── POST /api/packs/consume ──
    // Call this when a user opens a pack. Decrements packs_remaining by 1.
    if (path === '/api/packs/consume' && request.method === 'POST') {
      const user = await getUserFromToken(getToken(request), env.DB);
      if (!user) return err('Not logged in', 401, origin);

      const today = new Date().toISOString().slice(0, 10);
      const row = await env.DB.prepare(
        'SELECT packs_remaining, last_pack_reset FROM users WHERE id = ?'
      ).bind(user.user_id).first();

      let remaining = row?.packs_remaining ?? 5;
      const lastReset = row?.last_pack_reset || '';

      // Reset if new day
      if (lastReset !== today) {
        remaining = 5;
        await env.DB.prepare(
          'UPDATE users SET packs_remaining = 5, last_pack_reset = ? WHERE id = ?'
        ).bind(today, user.user_id).run();
      }

      if (remaining <= 0) {
        return err('No packs remaining today', 403, origin);
      }

      await env.DB.prepare(
        'UPDATE users SET packs_remaining = packs_remaining - 1 WHERE id = ?'
      ).bind(user.user_id).run();

      return json({ ok: true, packs_remaining: remaining - 1 }, 200, origin);
    }

    // ── POST /api/collect ──
    if (path === '/api/collect' && request.method === 'POST') {
      const user = await getUserFromToken(getToken(request), env.DB);
      if (!user) return err('Not logged in', 401, origin);
      const text = await request.text();
      let body;
      try { body = JSON.parse(text); } catch(e) { return err('Invalid JSON', 400, origin); }
      const cards = body.cards;
      if (!cards || !Array.isArray(cards)) return err('Invalid cards data', 400, origin);
      const stmt = env.DB.prepare(
        'INSERT INTO collections (user_id, card_file, pack_id, pack_name, card_rarity) VALUES (?, ?, ?, ?, ?)'
      );
      await env.DB.batch(
        cards.map(c => stmt.bind(user.user_id, c.file, c.packId || c.pack_id, c.packName || c.pack_name, c.rarity || 'c'))
      );
      await env.DB.prepare(
        'UPDATE users SET packs_opened = packs_opened + 1 WHERE id = ?'
      ).bind(user.user_id).run();
      return json({ ok: true, saved: cards.length }, 200, origin);
    }

    // ── GET /api/trivia/status ──
    // Returns how many trivia packs earned today and which question IDs answered
    if (path === '/api/trivia/status' && request.method === 'GET') {
      const user = await getUserFromToken(getToken(request), env.DB);
      if (!user) return err('Not logged in', 401, origin);

      const today = new Date().toISOString().slice(0, 10);
      const row = await env.DB.prepare(
        'SELECT trivia_packs_earned, last_trivia_reset FROM users WHERE id = ?'
      ).bind(user.user_id).first();

      let earned = row?.trivia_packs_earned ?? 0;
      const lastReset = row?.last_trivia_reset || '';

      if (lastReset !== today) {
        earned = 0;
        await env.DB.prepare(
          'UPDATE users SET trivia_packs_earned = 0, last_trivia_reset = ? WHERE id = ?'
        ).bind(today, user.user_id).run();
      }

      // Get answered question IDs for today
      const { results: answered } = await env.DB.prepare(
        'SELECT question_id FROM trivia_answers WHERE user_id = ? AND answered_date = ?'
      ).bind(user.user_id, today).all();

      return json({
        trivia_packs_earned: earned,
        trivia_limit: 5,
        answered_today: answered.map(r => r.question_id)
      }, 200, origin);
    }

    // ── POST /api/trivia/answer ──
    // Submit an answer; if correct and under limit, grant a pack
    if (path === '/api/trivia/answer' && request.method === 'POST') {
      const user = await getUserFromToken(getToken(request), env.DB);
      if (!user) return err('Not logged in', 401, origin);

      const { question_id, correct } = await request.json();
      if (question_id === undefined || correct === undefined) return err('Missing fields', 400, origin);

      const today = new Date().toISOString().slice(0, 10);

      // Check if already answered today
      const already = await env.DB.prepare(
        'SELECT id FROM trivia_answers WHERE user_id = ? AND question_id = ? AND answered_date = ?'
      ).bind(user.user_id, question_id, today).first();
      if (already) return err('Already answered today', 400, origin);

      // Record the answer
      await env.DB.prepare(
        'INSERT INTO trivia_answers (user_id, question_id, answered_date, correct) VALUES (?, ?, ?, ?)'
      ).bind(user.user_id, question_id, today, correct ? 1 : 0).run();

      if (!correct) return json({ ok: true, correct: false, pack_granted: false }, 200, origin);

      // Check trivia pack limit
      const row = await env.DB.prepare(
        'SELECT trivia_packs_earned, last_trivia_reset, packs_remaining FROM users WHERE id = ?'
      ).bind(user.user_id).first();

      let earned = row?.trivia_packs_earned ?? 0;
      const lastReset = row?.last_trivia_reset || '';
      let packsLeft = row?.packs_remaining ?? 0;

      if (lastReset !== today) {
        earned = 0;
      }

      if (earned >= 5) {
        return json({ ok: true, correct: true, pack_granted: false, reason: 'trivia_limit' }, 200, origin);
      }

      // Check total daily cap (10)
      const totalRow = await env.DB.prepare(
        'SELECT packs_remaining, last_pack_reset FROM users WHERE id = ?'
      ).bind(user.user_id).first();
      const totalRemaining = totalRow?.packs_remaining ?? 0;
      const totalReset = totalRow?.last_pack_reset || '';
      const effectiveTotal = totalReset !== today ? 5 : totalRemaining;

      if (effectiveTotal >= 10) {
        return json({ ok: true, correct: true, pack_granted: false, reason: 'daily_cap' }, 200, origin);
      }

      // Grant a pack
      await env.DB.prepare(
        'UPDATE users SET trivia_packs_earned = ?, last_trivia_reset = ?, packs_remaining = packs_remaining + 1 WHERE id = ?'
      ).bind(earned + 1, today, user.user_id).run();

      return json({ ok: true, correct: true, pack_granted: true, trivia_packs_earned: earned + 1 }, 200, origin);
    }

    return err('Not found', 404, origin);
  }
};
