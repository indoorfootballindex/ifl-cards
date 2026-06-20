// auth.js — loaded on every page
// Handles: reading auth state, nav user display, collection API calls

const API = 'https://ifl-cards-api.indoorfootballindex.workers.dev';

// ── TOKEN STORAGE ──
function getToken() {
  let t = sessionStorage.getItem('ifiToken');
  if (t) return t;
  try {
    const m = document.cookie.split(';').find(c => c.trim().startsWith('ifiToken='));
    if (m) return m.split('=')[1].trim();
  } catch(e) {}
  return null;
}

function getUser() {
  let u = sessionStorage.getItem('ifiUser');
  if (u) { try { return JSON.parse(u); } catch(e) {} }
  try {
    const m = document.cookie.split(';').find(c => c.trim().startsWith('ifiUser='));
    if (m) return JSON.parse(decodeURIComponent(m.split('=')[1]));
  } catch(e) {}
  return null;
}

function clearAuth() {
  sessionStorage.removeItem('ifiToken');
  sessionStorage.removeItem('ifiUser');
  try {
    document.cookie = 'ifiToken=; path=/; max-age=0';
    document.cookie = 'ifiUser=; path=/; max-age=0';
  } catch(e) {}
}

// ── NAV USER BADGE ──
// Call this after nav is in the DOM
function initNav() {
  const nav = document.querySelector('nav');
  if (!nav) return;

  const user = getUser();
  const badge = document.createElement('div');
  badge.style.cssText = 'margin-left:auto; display:flex; align-items:center; gap:10px;';

  if (user) {
    badge.innerHTML = `
      <span style="font-family:'Barlow Condensed',sans-serif;font-size:0.8rem;letter-spacing:0.08em;text-transform:uppercase;color:#8a8a96;">
        ${user.username}
      </span>
      <button onclick="logout()" style="font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;background:transparent;border:1px solid #2e2e33;color:#5a5a66;border-radius:4px;padding:4px 12px;cursor:pointer;">
        Sign Out
      </button>`;
  } else {
    badge.innerHTML = `
      <a href="login.html" style="font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;background:#c0201a;color:#f4f4f6;border-radius:4px;padding:5px 14px;text-decoration:none;">
        Sign In
      </a>`;
  }
  nav.appendChild(badge);
}

async function logout() {
  const token = getToken();
  if (token) {
    try {
      await fetch(API + '/api/logout', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token }
      });
    } catch(e) {}
  }
  clearAuth();
  window.location.href = 'login.html';
}

// ── COLLECTION — reads from API if logged in, falls back to local ──
async function loadCollection() {
  const token = getToken();
  if (token) {
    try {
      const res = await fetch(API + '/api/collection', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (res.ok) {
        const data = await res.json();
        // normalize API format to match local format
        return data.cards.map(c => ({
          file: c.card_file,
          packId: c.pack_id,
          packName: c.pack_name,
        }));
      }
    } catch(e) {}
  }
  // fallback to local storage
  let s = sessionStorage.getItem('ifiCol');
  if (s) { try { return JSON.parse(s); } catch(e) {} }
  try {
    const m = document.cookie.split(';').find(c => c.trim().startsWith('ifiCol='));
    if (m) return JSON.parse(decodeURIComponent(m.split('=')[1]));
  } catch(e) {}
  return [];
}

// ── SAVE COLLECTION — sends to API if logged in, also saves local ──
async function saveCollection(col) {
  // always save locally as backup
  const str = JSON.stringify(col);
  sessionStorage.setItem('ifiCol', str);
  try { document.cookie = 'ifiCol=' + encodeURIComponent(str) + '; path=/; max-age=31536000'; } catch(e) {}
}

// Save a pack pull to the server
async function savePullToServer(cards) {
  const token = getToken();
  if (!token) return;
  try {
    await fetch(API + '/api/collect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
      },
      body: JSON.stringify({ cards })
    });
  } catch(e) {
    console.warn('Could not save pull to server:', e.message);
  }
}

// ── MIGRATE local cards to server after login ──
// Call this right after a successful login if the user had local cards
async function migrateLocalToServer(token) {
  let local = [];
  try {
    let s = sessionStorage.getItem('ifiCol');
    if (s) local = JSON.parse(s);
    else {
      const m = document.cookie.split(';').find(c => c.trim().startsWith('ifiCol='));
      if (m) local = JSON.parse(decodeURIComponent(m.split('=')[1]));
    }
  } catch(e) {}

  if (!local.length) return;

  try {
    await fetch(API + '/api/collect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
      },
      body: JSON.stringify({ cards: local })
    });
    // clear local after successful migration
    sessionStorage.removeItem('ifiCol');
    try { document.cookie = 'ifiCol=; path=/; max-age=0'; } catch(e) {}
    console.log('Migrated ' + local.length + ' local cards to account');

// Run on every page load
document.addEventListener('DOMContentLoaded', initNav);
