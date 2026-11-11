// Davina & David wedding site — Express server with JSON-file storage.
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 4826;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const CONFIG_DIR = path.join(__dirname, 'config');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

fs.mkdirSync(DATA_DIR, { recursive: true });
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
let db = readJSON(DB_FILE, { rsvps: [], quizScores: [] });
function saveDb() { const tmp = DB_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(db, null, 2)); fs.renameSync(tmp, DB_FILE); }
const siteConfig = () => readJSON(path.join(CONFIG_DIR, 'site.json'), {});
const quizConfig = () => readJSON(path.join(CONFIG_DIR, 'quiz.json'), { questions: [] });
const clean = (v, max = 300) => String(v ?? '').trim().slice(0, max);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

// ---- simple per-IP rate limit for write endpoints
const hits = new Map();
function limit(max, windowMs) {
  return (req, res, next) => {
    const k = (req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']?.split(',')[0] || req.ip) + req.path, now = Date.now();
    const arr = (hits.get(k) || []).filter(t => now - t < windowMs);
    if (arr.length >= max) return res.status(429).json({ error: 'Too many requests, please try again shortly.' });
    arr.push(now); hits.set(k, arr); next();
  };
}

// ---- public config
app.get('/api/config', (req, res) => {
  const c = siteConfig();
  res.json({ weddingDateISO: c.weddingDateISO, payments: c.payments || {} });
});

// ---- song search: Spotify (client credentials) or iTunes fallback
let spotifyToken = null, spotifyExp = 0;
async function getSpotifyToken() {
  if (spotifyToken && Date.now() < spotifyExp - 60000) return spotifyToken;
  const id = process.env.SPOTIFY_CLIENT_ID, secret = process.env.SPOTIFY_CLIENT_SECRET;
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(id + ':' + secret).toString('base64') },
    body: 'grant_type=client_credentials'
  });
  if (!r.ok) throw new Error('Spotify auth failed ' + r.status);
  const j = await r.json();
  spotifyToken = j.access_token; spotifyExp = Date.now() + j.expires_in * 1000;
  return spotifyToken;
}
app.get('/api/songs/search', async (req, res) => {
  const q = clean(req.query.q, 100);
  if (q.length < 2) return res.json({ source: null, tracks: [] });
  try {
    if (process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET) {
      const token = await getSpotifyToken();
      const r = await fetch('https://api.spotify.com/v1/search?type=track&limit=8&q=' + encodeURIComponent(q), { headers: { Authorization: 'Bearer ' + token } });
      const j = await r.json();
      return res.json({ source: 'spotify', tracks: (j.tracks?.items || []).map(t => ({
        id: 'spotify:' + t.id, title: t.name, artist: t.artists.map(a => a.name).join(', '),
        album: t.album?.name, art: t.album?.images?.[t.album.images.length > 1 ? 1 : 0]?.url || '', url: t.external_urls?.spotify || '' })) });
    }
    const r = await fetch('https://itunes.apple.com/search?media=music&entity=song&limit=8&term=' + encodeURIComponent(q));
    const j = await r.json();
    res.json({ source: 'itunes', tracks: (j.results || []).map(t => ({
      id: 'itunes:' + t.trackId, title: t.trackName, artist: t.artistName, album: t.collectionName,
      art: (t.artworkUrl100 || '').replace('100x100', '200x200'), url: t.trackViewUrl || '' })) });
  } catch (e) {
    console.error('song search error', e.message);
    res.status(502).json({ error: 'Song search is unavailable right now.', tracks: [] });
  }
});

// ---- RSVP
app.post('/api/rsvp', limit(10, 60 * 60 * 1000), (req, res) => {
  const b = req.body || {};
  const name = clean(b.name, 120), email = clean(b.email, 160).toLowerCase();
  if (!name) return res.status(400).json({ error: 'Please enter your name.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email.' });
  if (!['yes', 'no'].includes(b.attending)) return res.status(400).json({ error: 'Please let us know if you can attend.' });
  const partySize = b.attending === 'yes' ? Math.min(Math.max(parseInt(b.partySize, 10) || 1, 1), 10) : 0;
  let song = null;
  if (b.song && b.song.title) song = { id: clean(b.song.id, 80), title: clean(b.song.title, 200), artist: clean(b.song.artist, 200), album: clean(b.song.album, 200), art: clean(b.song.art, 400), url: clean(b.song.url, 400) };
  const entry = { id: crypto.randomUUID(), name, email, attending: b.attending, partySize, dietary: clean(b.dietary, 500), message: clean(b.message, 800), song, createdAt: new Date().toISOString() };
  // Same email re-submitting replaces their earlier RSVP
  db.rsvps = db.rsvps.filter(r => r.email !== email);
  db.rsvps.push(entry); saveDb();
  res.json({ ok: true, id: entry.id });
});

// ---- Quiz
app.get('/api/quiz', (req, res) => {
  res.json({ questions: quizConfig().questions.map(({ q, options }) => ({ q, options })) });
});
const leaderboard = () => [...db.quizScores].sort((a, b) => b.score - a.score || a.createdAt.localeCompare(b.createdAt)).slice(0, 15)
  .map(({ name, score, total, createdAt }) => ({ name, score, total, createdAt }));
app.get('/api/leaderboard', (req, res) => res.json({ leaderboard: leaderboard() }));
app.post('/api/quiz/submit', limit(15, 60 * 60 * 1000), (req, res) => {
  const name = clean(req.body?.name, 40);
  const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
  if (!name) return res.status(400).json({ error: 'Please enter your name.' });
  const qs = quizConfig().questions;
  const results = qs.map((q, i) => ({ correct: Number(answers[i]) === q.answer, answer: q.answer }));
  const score = results.filter(r => r.correct).length;
  db.quizScores.push({ id: crypto.randomUUID(), name, score, total: qs.length, createdAt: new Date().toISOString() }); saveDb();
  const lb = leaderboard();
  res.json({ score, total: qs.length, results, rank: [...db.quizScores].sort((a, b) => b.score - a.score).findIndex(s => s.score === score) + 1, leaderboard: lb });
});

// ---- Admin (HTTP Basic auth, password from ADMIN_PASSWORD env)
function adminAuth(req, res, next) {
  if (!ADMIN_PASSWORD) return res.status(503).send('Admin disabled: set ADMIN_PASSWORD env var.');
  const [scheme, enc] = (req.headers.authorization || '').split(' ');
  const pass = scheme === 'Basic' && enc ? Buffer.from(enc, 'base64').toString().split(':').slice(1).join(':') : '';
  const a = Buffer.from(pass), b = Buffer.from(ADMIN_PASSWORD);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
  res.set('WWW-Authenticate', 'Basic realm="Wedding admin"').status(401).send('Authentication required.');
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
app.get('/admin', adminAuth, (req, res) => {
  const rs = [...db.rsvps].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const yes = rs.filter(r => r.attending === 'yes'), heads = yes.reduce((s, r) => s + r.partySize, 0);
  const rows = rs.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.email)}</td><td class="${r.attending}">${r.attending === 'yes' ? 'Yes' : 'No'}</td><td>${r.partySize}</td><td>${esc(r.dietary)}</td>
    <td>${r.song ? `<div class="song">${r.song.art ? `<img src="${esc(r.song.art)}" alt="">` : ''}<div><b>${esc(r.song.title)}</b><br><small>${esc(r.song.artist)}</small></div></div>` : '—'}</td><td>${esc(r.message)}</td><td><small>${new Date(r.createdAt).toLocaleString('en-US', { timeZone: 'America/New_York' })}</small></td></tr>`).join('');
  const lb = leaderboard().map((s, i) => `<li>${i + 1}. ${esc(s.name)} — ${s.score}/${s.total}</li>`).join('');
  res.send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin · Davina & David</title>
<style>body{font-family:system-ui,sans-serif;margin:24px;color:#1d1d1b}h1{font-weight:500}.stats{display:flex;gap:16px;flex-wrap:wrap;margin:16px 0}.stats div{background:#f3f5ef;border-radius:10px;padding:12px 18px}.stats b{display:block;font-size:24px}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{border-bottom:1px solid #eee;padding:8px;text-align:left;vertical-align:top}th{background:#fafafa}.yes{color:#4d6b44;font-weight:600}.no{color:#b5654a}.song{display:flex;gap:8px;align-items:center}.song img{width:40px;height:40px;border-radius:4px}
a.btn{display:inline-block;background:#6f8466;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none}.wrap{overflow-x:auto}</style>
<h1>Davina &amp; David — RSVPs</h1><div class="stats"><div><b>${rs.length}</b>responses</div><div><b>${yes.length}</b>attending (parties)</div><div><b>${heads}</b>total guests</div><div><b>${rs.filter(r => r.song).length}</b>song requests</div></div>
<p><a class="btn" href="/admin/rsvps.csv">Download CSV</a></p><div class="wrap"><table><tr><th>Name</th><th>Email</th><th>Attending</th><th>Party</th><th>Meal / dietary</th><th>Song request</th><th>Message</th><th>Submitted (ET)</th></tr>${rows || '<tr><td colspan=8>No RSVPs yet.</td></tr>'}</table></div>
<h2>Quiz leaderboard</h2><ol style="list-style:none;padding:0">${lb || 'No scores yet.'}</ol>`);
});
app.get('/admin/rsvps.csv', adminAuth, (req, res) => {
  const q = v => '"' + String(v ?? '').replace(/^([=+\-@])/, "'$1").replace(/"/g, '""') + '"';
  const head = ['Name', 'Email', 'Attending', 'Party size', 'Meal/dietary', 'Song title', 'Song artist', 'Song link', 'Message', 'Submitted'];
  const lines = db.rsvps.map(r => [r.name, r.email, r.attending, r.partySize, r.dietary, r.song?.title, r.song?.artist, r.song?.url, r.message, r.createdAt].map(q).join(','));
  res.set('Content-Type', 'text/csv').set('Content-Disposition', 'attachment; filename="rsvps.csv"').send([head.map(q).join(','), ...lines].join('\n'));
});

app.listen(PORT, () => console.log(`Wedding site on http://localhost:${PORT} (song search: ${process.env.SPOTIFY_CLIENT_ID ? 'Spotify' : 'iTunes fallback'})`));
