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

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth radius in meters
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
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

    // ── GET /api/cards/limits ──
    // Returns pull counts for cards that have limits, keyed by file|rarity
    if (path === '/api/cards/limits' && request.method === 'GET') {
      const packId = url.searchParams.get('packId') || '';
      const { results } = await env.DB.prepare(
        `SELECT card_file, card_rarity, COUNT(*) as pull_count
         FROM collections
         WHERE pack_id = ?
         GROUP BY card_file, card_rarity`
      ).bind(packId).all();

      const counts = {};
      results.forEach(r => {
        counts[r.card_file + '|' + r.card_rarity] = r.pull_count;
      });

      return json({ counts }, 200, origin);
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

      // Filter out cards that have hit their qty limit
      const toSave = [];
      for (const c of cards) {
        if (c.qty) {
          const row = await env.DB.prepare(
            'SELECT COUNT(*) as count FROM collections WHERE card_file = ? AND pack_id = ? AND card_rarity = ?'
          ).bind(c.file, c.packId || c.pack_id, c.rarity || 'c').first();
          if ((row?.count || 0) >= c.qty) continue; // skip — limit reached
        }
        toSave.push(c);
      }

      if (toSave.length) {
        const stmt = env.DB.prepare(
          'INSERT INTO collections (user_id, card_file, pack_id, pack_name, card_rarity) VALUES (?, ?, ?, ?, ?)'
        );
        await env.DB.batch(
          toSave.map(c => stmt.bind(user.user_id, c.file, c.packId || c.pack_id, c.packName || c.pack_name, c.rarity || 'c'))
        );
      }

      await env.DB.prepare(
        'UPDATE users SET packs_opened = packs_opened + 1 WHERE id = ?'
      ).bind(user.user_id).run();
      return json({ ok: true, saved: toSave.length, skipped: cards.length - toSave.length }, 200, origin);
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

    // ── GET /api/redeem/history ──
    if (path === '/api/redeem/history' && request.method === 'GET') {
      const user = await getUserFromToken(getToken(request), env.DB);
      if (!user) return err('Not logged in', 401, origin);
      const { results } = await env.DB.prepare(
        `SELECT rc.pack_name, ru.redeemed_at
         FROM redeem_uses ru JOIN redeem_codes rc ON ru.code_id = rc.id
         WHERE ru.user_id = ? ORDER BY ru.redeemed_at DESC`
      ).bind(user.user_id).all();
      return json({ history: results }, 200, origin);
    }

    // ── POST /api/redeem ──
    // Redeem a code, pull cards from exclusive pack CSV, save to collection
    if (path === '/api/redeem' && request.method === 'POST') {
      const user = await getUserFromToken(getToken(request), env.DB);
      if (!user) return err('Not logged in', 401, origin);

      const { code, lat, lng } = await request.json();
      if (!code) return err('No code provided', 400, origin);

      // Look up code
      const codeRow = await env.DB.prepare(
        'SELECT id, pack_id, pack_name, description, active, geo_lat, geo_lng, geo_name FROM redeem_codes WHERE code = ?'
      ).bind(code.trim().toUpperCase()).first();

      if (!codeRow) return err('Invalid code', 404, origin);
      if (!codeRow.active) return err('This code is no longer active', 400, origin);

      // Geo check if code has location
      if (codeRow.geo_lat && codeRow.geo_lng) {
        const userLat = typeof lat === 'number' ? lat : parseFloat(lat);
        const userLng = typeof lng === 'number' ? lng : parseFloat(lng);
        if (!lat || !lng || isNaN(userLat) || isNaN(userLng)) {
          return err('Location required to redeem this code. Please enable location access and try again.', 403, origin);
        }
        const dist = haversineMeters(userLat, userLng, codeRow.geo_lat, codeRow.geo_lng);
        console.log(`Geo check: user=(${userLat},${userLng}) venue=(${codeRow.geo_lat},${codeRow.geo_lng}) dist=${dist}m`);
        const ONE_MILE = 1609;
        if (dist > ONE_MILE) {
          return err('You must be at ' + (codeRow.geo_name || 'the venue') + ' to redeem this code', 403, origin);
        }
      }

      // Check if already redeemed by this user
      const already = await env.DB.prepare(
        'SELECT id FROM redeem_uses WHERE user_id = ? AND code_id = ?'
      ).bind(user.user_id, codeRow.id).first();
      if (already) return err('You have already redeemed this code', 400, origin);

      // Fetch exclusive pack cards CSV
      const csvUrl = `https://raw.githubusercontent.com/indoorfootballindex/ifl-cards/main/exclusive_packs/${codeRow.pack_id}/cards.csv`;
      let cards = [];
      try {
        const csvRes = await fetch(csvUrl);
        if (!csvRes.ok) return err(`Pack CSV fetch failed: ${csvRes.status} ${csvUrl}`, 500, origin);
        const csvText = await csvRes.text();
        console.log('CSV text:', csvText.slice(0, 200));

        // Parse CSV (handle Windows line endings)
        const lines = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n');
        const headers = lines[0].split(',').map(h => h.trim());
        const rows = lines.slice(1).filter(l => l.trim()).map(l => {
          const vals = l.split(',').map(v => v.trim());
          return Object.fromEntries(headers.map((h, i) => [h, vals[i] || '']));
        });

        if (!rows.length) return err('Pack has no cards', 500, origin);

        // Separate by rarity, respecting qty limits
        const byRarity = { c: [], u: [], r: [], sr: [] };

        // Get current pull counts for limited cards
        const limitedFiles = rows.filter(r => r.qty).map(r => r.file + '|' + (r.rarity||'c').toLowerCase());
        let pullCounts = {};
        if (limitedFiles.length) {
          const { results: counts } = await env.DB.prepare(
            `SELECT card_file, card_rarity, COUNT(*) as pull_count FROM collections WHERE pack_id = ? GROUP BY card_file, card_rarity`
          ).bind(codeRow.pack_id).all();
          counts.forEach(c => { pullCounts[c.card_file + '|' + c.card_rarity] = c.pull_count; });
        }

        rows.forEach(r => {
          const rar = (r.rarity || 'c').toLowerCase();
          if (!byRarity[rar]) return;
          // Check qty limit
          if (r.qty) {
            const pulled = pullCounts[r.file + '|' + rar] || 0;
            if (pulled >= r.qty) return; // skip exhausted cards
          }
          if (byRarity[rar]) byRarity[rar].push(r);
        });

        function pick(arr) {
          return arr.length ? arr[Math.floor(Math.random() * arr.length)] : null;
        }
        function shuffle(arr) {
          const a = [...arr];
          for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
          }
          return a;
        }

        // Guaranteed slots: 3 commons, 1 uncommon, 1 rare — no duplicates
        const rShuffle = (arr) => {
          const a = [...arr];
          for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
          }
          return a;
        };
        const rPick = (arr) => arr.length ? arr[Math.floor(Math.random() * arr.length)] : null;

        const commons   = rShuffle(byRarity.c);
        const uncommons = rShuffle(byRarity.u);
        const rares     = rShuffle([...byRarity.r, ...byRarity.sr]);

        const slot1 = commons[0]   || rPick(rows);
        const slot2 = commons[1]   || commons[0] || rPick(rows);
        const slot3 = commons[2]   || commons[0] || rPick(rows);
        const slot4 = uncommons[0] || rPick(byRarity.c) || rPick(rows);
        const slot5 = rares[0]     || rPick(byRarity.u) || rPick(rows);

        cards = [slot1, slot2, slot3, slot4, slot5].filter(Boolean);

      } catch(e) {
        return err('Failed to load pack: ' + e.message, 500, origin);
      }

      // Record redemption
      const now = new Date().toISOString();
      await env.DB.prepare(
        'INSERT INTO redeem_uses (user_id, code_id, redeemed_at) VALUES (?, ?, ?)'
      ).bind(user.user_id, codeRow.id, now).run();

      // Save cards to collection
      const stmt = env.DB.prepare(
        'INSERT INTO collections (user_id, card_file, pack_id, pack_name, card_rarity) VALUES (?, ?, ?, ?, ?)'
      );
      await env.DB.batch(
        cards.map(c => stmt.bind(user.user_id, c.file, codeRow.pack_id, codeRow.pack_name, c.rarity))
      );

      return json({
        ok: true,
        pack_id: codeRow.pack_id,
        pack_name: codeRow.pack_name,
        description: codeRow.description,
        cards: cards.map(c => ({
          file: c.file, name: c.name, team: c.team,
          rarity: c.rarity, position: c.position || ''
        }))
      }, 200, origin);
    }

    // ── GET /api/admin/stats ──
    if (path === '/api/admin/stats' && request.method === 'GET') {
      const user = await getUserFromToken(getToken(request), env.DB);
      if (!user) return err('Not logged in', 401, origin);
      if (user.email !== 'indoorfootballindex@gmail.com') return err('Forbidden', 403, origin);

      // Recent pack opens: timestamp, pack name, username
      const { results: opens } = await env.DB.prepare(`
        SELECT c.pulled_at, c.pack_name, u.username
        FROM collections c
        JOIN users u ON c.user_id = u.id
        GROUP BY c.user_id, c.pack_name, SUBSTR(c.pulled_at, 1, 16)
        ORDER BY c.pulled_at DESC
        LIMIT 200
      `).all();

      // Card pull counts: card file, pack, rarity, total pulls
      const { results: cards } = await env.DB.prepare(`
        SELECT card_file, pack_name, card_rarity, COUNT(*) as pull_count
        FROM collections
        GROUP BY card_file, pack_name, card_rarity
        ORDER BY pull_count DESC
      `).all();

      // Total stats
      const totals = await env.DB.prepare(`
        SELECT 
          COUNT(DISTINCT user_id) as total_users,
          COUNT(*) as total_cards,
          COUNT(*) / 5 as total_packs
        FROM collections
      `).first();

      return json({ opens, cards, totals }, 200, origin);
    }

    // ── GET /api/admin/users ──
    if (path === '/api/admin/users' && request.method === 'GET') {
      const user = await getUserFromToken(getToken(request), env.DB);
      if (!user) return err('Not logged in', 401, origin);
      if (user.email !== 'indoorfootballindex@gmail.com') return err('Forbidden', 403, origin);

      const { results } = await env.DB.prepare(`
        SELECT u.username, u.email, u.packs_opened,
          COUNT(c.id) as cards_collected
        FROM users u
        LEFT JOIN collections c ON c.user_id = u.id
        GROUP BY u.id
        ORDER BY u.packs_opened DESC
      `).all();

      return json({ users: results }, 200, origin);
    }

    // ── GET /api/leaderboard ──
    if (path === '/api/leaderboard' && request.method === 'GET') {
      const { results: userRows } = await env.DB.prepare(`
        SELECT 
          u.id,
          u.username,
          u.packs_opened,
          COUNT(DISTINCT c.card_file || '|' || c.card_rarity || '|' || c.pack_id) as unique_cards
        FROM users u
        LEFT JOIN collections c ON c.user_id = u.id
        GROUP BY u.id
        ORDER BY u.packs_opened DESC
        LIMIT 100
      `).all();

      // Numbered cards per user (cards with total pull count <= 500 as a proxy for limited cards)
      // Better: count cards that appear fewer times globally than some threshold
      // We track this simply as cards where global pull count indicates it's limited
      // For now count all cards pulled by each user grouped
      const { results: numberedRows } = await env.DB.prepare(`
        SELECT c.user_id, COUNT(*) as numbered_count
        FROM collections c
        INNER JOIN (
          SELECT card_file, pack_id, card_rarity
          FROM collections
          GROUP BY card_file, pack_id, card_rarity
          HAVING COUNT(*) <= 500
        ) limited ON c.card_file = limited.card_file 
          AND c.pack_id = limited.pack_id 
          AND c.card_rarity = limited.card_rarity
        GROUP BY c.user_id
      `).all();
      const numberedMap = {};
      numberedRows.forEach(r => { numberedMap[r.user_id] = r.numbered_count; });

      // Sets per user
      const { results: setsRows } = await env.DB.prepare(`
        SELECT user_id, pack_id, COUNT(DISTINCT card_file || '|' || card_rarity) as owned_unique
        FROM collections
        GROUP BY user_id, pack_id
      `).all();
      const setsMap = {};
      setsRows.forEach(r => {
        if (!setsMap[r.user_id]) setsMap[r.user_id] = {};
        setsMap[r.user_id][r.pack_id] = r.owned_unique;
      });

      const globalRes = await env.DB.prepare(`
        SELECT 
          COUNT(DISTINCT id) as total_users,
          COALESCE(SUM(packs_opened), 0) as total_packs,
          (SELECT COUNT(*) FROM collections) as total_cards
        FROM users
      `).first();

      const leaderboard = userRows.map(u => ({
        username: u.username,
        user_id: u.id,
        packs_opened: u.packs_opened || 0,
        unique_cards: u.unique_cards || 0,
        numbered_cards: numberedMap[u.id] || 0,
        user_sets: setsMap[u.id] || {},
      }));

      return json({
        leaderboard,
        global: {
          total_users: globalRes?.total_users || 0,
          total_packs: globalRes?.total_packs || 0,
          total_cards: globalRes?.total_cards || 0,
        }
      }, 200, origin);
    }

    // ── GET /api/leaderboard/sets ──
    if (path === '/api/leaderboard/sets' && request.method === 'GET') {
      const { results } = await env.DB.prepare(`
        SELECT user_id, pack_id, COUNT(DISTINCT card_file || '|' || card_rarity) as owned_unique
        FROM collections
        GROUP BY user_id, pack_id
      `).all();
      return json({ sets: results }, 200, origin);
    }

    return err('Not found', 404, origin);
  }
};
