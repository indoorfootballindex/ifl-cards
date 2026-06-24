// auth.js — loaded on every page
const API = 'https://api.cards.indoorfootballindex.com';

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

function injectNavStyles() {
  if (document.getElementById('auth-nav-styles')) return;
  const style = document.createElement('style');
  style.id = 'auth-nav-styles';
  style.textContent = `
    .nav-hamburger {
      display: none; margin-left: auto; background: none; border: none;
      cursor: pointer; padding: 8px; color: #8a9a80; flex-direction: column;
      gap: 5px; align-items: center; justify-content: center;
    }
    .nav-hamburger span {
      display: block; width: 22px; height: 2px; background: currentColor;
      border-radius: 2px; transition: transform 0.2s, opacity 0.2s;
    }
    .nav-hamburger.open span:nth-child(1) { transform: translateY(7px) rotate(45deg); }
    .nav-hamburger.open span:nth-child(2) { opacity: 0; }
    .nav-hamburger.open span:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }

    .nav-mobile-menu {
      display: none; position: fixed; top: 80px; left: 0; right: 0;
      background: #111410; border-bottom: 1px solid #2a2e24;
      flex-direction: column; z-index: 999; padding: 0.5rem 0;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5);
    }
    .nav-mobile-menu.open { display: flex; }
    .nav-mobile-menu a, .nav-mobile-menu button {
      font-family: 'Barlow Condensed', sans-serif; font-weight: 700;
      font-size: 1rem; letter-spacing: 0.1em; text-transform: uppercase;
      color: #8a9a80; text-decoration: none; padding: 0.85rem 1.5rem;
      border: none; background: none; text-align: left; cursor: pointer;
      border-bottom: 1px solid #1a1e18; width: 100%;
      transition: color 0.12s, background 0.12s;
    }
    .nav-mobile-menu a:last-child, .nav-mobile-menu button:last-child { border-bottom: none; }
    .nav-mobile-menu a:hover, .nav-mobile-menu button:hover { color: #f0f0ee; background: #181c16; }
    .nav-mobile-menu a.active { color: #f0f0ee; border-left: 3px solid #6b7c3f; padding-left: calc(1.5rem - 3px); }
    .nav-mobile-menu .mobile-user {
      font-size: 0.72rem; color: #5a6650; padding: 0.6rem 1.5rem 0.25rem;
      border-bottom: 1px solid #1a1e18; letter-spacing: 0.1em; text-transform: uppercase;
    }
    .nav-mobile-menu .mobile-signin {
      color: #6b7c3f !important;
    }

    @media (max-width: 768px) {
      nav .nav-tab { display: none !important; }
      nav .packs-badge { display: none !important; }
      .nav-hamburger { display: flex !important; }
    }
  `;
  document.head.appendChild(style);
}

function initNav() {
  const nav = document.querySelector('nav');
  if (!nav) return;

  injectNavStyles();

  const user = getUser();

  // Desktop: user badge (existing behaviour)
  const badge = document.createElement('div');
  badge.style.cssText = 'margin-left:auto;display:flex;align-items:center;gap:10px;';
  if (user) {
    badge.innerHTML =
      '<span style="font-family:\'Barlow Condensed\',sans-serif;font-size:0.8rem;letter-spacing:0.08em;text-transform:uppercase;color:#8a8a96;">' + user.username + '</span>' +
      '<button onclick="logout()" style="font-family:\'Barlow Condensed\',sans-serif;font-weight:700;font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;background:transparent;border:1px solid #2e2e33;color:#5a5a66;border-radius:4px;padding:4px 12px;cursor:pointer;">Sign Out</button>';
  } else {
    badge.innerHTML =
      '<a href="login.html" style="font-family:\'Barlow Condensed\',sans-serif;font-weight:700;font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;background:#6b7c3f;color:#f0f0ee;border-radius:4px;padding:5px 14px;text-decoration:none;">Sign In</a>';
  }
  nav.appendChild(badge);

  // Hamburger button
  const burger = document.createElement('button');
  burger.className = 'nav-hamburger';
  burger.setAttribute('aria-label', 'Menu');
  burger.innerHTML = '<span></span><span></span><span></span>';
  nav.appendChild(burger);

  // Mobile menu
  const menu = document.createElement('div');
  menu.className = 'nav-mobile-menu';

  // Figure out current page for active state
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';

  const links = [
    { href: 'index.html',      label: 'Open Packs' },
    { href: 'collection.html', label: 'My Collection' },
    { href: 'browse.html',     label: 'Browse' },
    { href: 'trivia.html',     label: 'Trivia' },
    { href: 'redeem.html',     label: 'Redeem' },
  ];

  if (user) {
    const userDiv = document.createElement('div');
    userDiv.className = 'mobile-user';
    userDiv.textContent = user.username;
    menu.appendChild(userDiv);
  }

  links.forEach(({ href, label }) => {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = label;
    if (href === currentPage) a.className = 'active';
    menu.appendChild(a);
  });

  if (user) {
    const signOut = document.createElement('button');
    signOut.textContent = 'Sign Out';
    signOut.onclick = logout;
    menu.appendChild(signOut);
  } else {
    const signIn = document.createElement('a');
    signIn.href = 'login.html';
    signIn.textContent = 'Sign In';
    signIn.className = 'mobile-signin';
    menu.appendChild(signIn);
  }

  document.body.appendChild(menu);

  burger.addEventListener('click', () => {
    burger.classList.toggle('open');
    menu.classList.toggle('open');
  });

  // Close menu when a link is clicked
  menu.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => {
      burger.classList.remove('open');
      menu.classList.remove('open');
    });
  });

  // Close on outside click
  document.addEventListener('click', e => {
    if (!nav.contains(e.target) && !menu.contains(e.target)) {
      burger.classList.remove('open');
      menu.classList.remove('open');
    }
  });
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
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
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
