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

function initNav() {
  const nav = document.querySelector('nav');
  if (!nav) return;
  const user = getUser();

  // Desktop badge
  const badge = document.createElement('div');
  badge.style.cssText = 'margin-left:auto;display:flex;align-items:center;gap:10px;flex-shrink:0;';
  if (user) {
    badge.innerHTML =
      '<span id="navCoins" style="font-family:\'Barlow Condensed\',sans-serif;font-size:0.8rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#c8980a;display:none;">🪙 –</span>' +
      '<span style="font-family:\'Barlow Condensed\',sans-serif;font-size:0.8rem;letter-spacing:0.08em;text-transform:uppercase;color:#8a8a96;">' + user.username + '</span>' +
      '<button onclick="logout()" style="font-family:\'Barlow Condensed\',sans-serif;font-weight:700;font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;background:transparent;border:1px solid #2e2e33;color:#5a5a66;border-radius:4px;padding:4px 12px;cursor:pointer;touch-action:manipulation;">Sign Out</button>';
    const token = getToken();
    if (token) {
      fetch('https://api.cards.indoorfootballindex.com/api/coins', {
        headers: { 'Authorization': 'Bearer ' + token }
      }).then(r => r.json()).then(d => {
        const el = document.getElementById('navCoins');
        if (el) { el.textContent = '🪙 ' + (d.coins || 0).toLocaleString(); el.style.display = 'inline'; }
      }).catch(() => {});
    }
  } else {
    badge.innerHTML =
      '<a href="login.html" style="font-family:\'Barlow Condensed\',sans-serif;font-weight:700;font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;background:#6b7c3f;color:#f0f0ee;border-radius:4px;padding:5px 14px;text-decoration:none;touch-action:manipulation;">Sign In</a>';
  }
  nav.appendChild(badge);

  // Hamburger — use existing if page has one, otherwise create
  let burger = document.getElementById('navHamburger') || nav.querySelector('.nav-hamburger');
  if (!burger) {
    burger = document.createElement('button');
    burger.className = 'nav-hamburger';
    burger.id = 'navHamburger';
    burger.setAttribute('aria-label', 'Menu');
    burger.innerHTML = '<span></span><span></span><span></span>';
    nav.appendChild(burger);
  }

  // Mobile menu
  let menu = document.getElementById('authMobileMenu');
  if (!menu) {
    menu = document.createElement('div');
    menu.className = 'nav-mobile-menu';
    menu.id = 'authMobileMenu';

    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    const links = [
      ['index.html','Open Packs'],['collection.html','My Collection'],
      ['browse.html','Browse'],['trivia.html','Trivia'],['redeem.html','Redeem'],
      ['leaderboard.html','Leaderboard'],['marketplace.html','Marketplace'],
    ];

    if (user) {
      const userDiv = document.createElement('div');
      userDiv.className = 'mobile-user';
      const coinsSpan = document.createElement('span');
      coinsSpan.id = 'mobileNavCoins';
      coinsSpan.textContent = '';
      userDiv.appendChild(document.createTextNode(user.username + ' '));
      userDiv.appendChild(coinsSpan);
      menu.appendChild(userDiv);
      // Fetch coins for mobile too
      const token = getToken();
      if (token) {
        fetch('https://api.cards.indoorfootballindex.com/api/coins', {
          headers: { 'Authorization': 'Bearer ' + token }
        }).then(r => r.json()).then(d => {
          const el = document.getElementById('mobileNavCoins');
          if (el) el.textContent = '· 🪙 ' + (d.coins || 0).toLocaleString();
        }).catch(() => {});
      }
    }

    links.forEach(([href, label]) => {
      const a = document.createElement('a');
      a.href = href; a.textContent = label;
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
      signIn.href = 'login.html'; signIn.textContent = 'Sign In';
      signIn.className = 'mobile-signin';
      menu.appendChild(signIn);
    }
    document.body.appendChild(menu);
  }

  burger.addEventListener('click', (e) => {
    e.stopPropagation();
    burger.classList.toggle('open');
    menu.classList.toggle('open');
  });
  menu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
    burger.classList.remove('open'); menu.classList.remove('open');
  }));
  document.addEventListener('click', e => {
    if (!nav.contains(e.target) && !menu.contains(e.target)) {
      burger.classList.remove('open'); menu.classList.remove('open');
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
