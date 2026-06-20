// auth.js — loaded on every page
const API = '';

function getToken() {
  try { return localStorage.getItem('ifiToken'); } catch(e) {}
  return null;
}

function getUser() {
  try {
    const u = localStorage.getItem('ifiUser');
    if (u) return JSON.parse(u);
  } catch(e) {}
  return null;
}

function clearAuth() {
  try {
    localStorage.removeItem('ifiToken');
    localStorage.removeItem('ifiUser');
  } catch(e) {}
}

function initNav() {
  const nav = document.querySelector('nav');
  if (!nav) return;
  const user = getUser();
  const badge = document.createElement('div');
  badge.style.cssText = 'margin-left:auto;display:flex;align-items:center;gap:10px;';
  if (user) {
    badge.innerHTML =
      '<span style="font-family:\'Barlow Condensed\',sans-serif;font-size:0.8rem;letter-spacing:0.08em;text-transform:uppercase;color:#8a8a96;">' + user.username + '</span>' +
      '<button onclick="logout()" style="font-family:\'Barlow Condensed\',sans-serif;font-weight:700;font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;background:transparent;border:1px solid #2e2e33;color:#5a5a66;border-radius:4px;padding:4px 12px;cursor:pointer;">Sign Out</button>';
  } else {
    badge.innerHTML =
      '<a href="login.html" style="font-family:\'Barlow Condensed\',sans-serif;font-weight:700;font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;background:#c0201a;color:#f4f4f6;border-radius:4px;padding:5px 14px;text-decoration:none;">Sign In</a>';
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

async function savePullToServer(cards) {
  const token = getToken();
  if (!token) return;
  try {
    await fetch(API + '/api/collect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ cards })
    });
  } catch(e) {
    console.warn('Could not save pull to server:', e.message);
  }
}

async function migrateLocalToServer(token) {
  let local = [];
  try {
    const s = localStorage.getItem('ifiCol');
    if (s) local = JSON.parse(s);
  } catch(e) {}
  if (!local.length) return;
  try {
    await fetch(API + '/api/collect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ cards: local })
    });
    localStorage.removeItem('ifiCol');
  } catch(e) {
    console.warn('Migration failed:', e.message);
  }
}

// Run immediately — auth.js is at end of body so DOM is ready
initNav();
