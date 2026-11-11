(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = msg => { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); };
  const api = async (url, opts = {}) => {
    const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
    return j;
  };

  // NAV
  const nav = $('#nav'), toggle = $('.nav-toggle'), links = $('.nav-links');
  const onScroll = () => nav.classList.toggle('scrolled', scrollY > 40);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();
  toggle.addEventListener('click', () => { const o = links.classList.toggle('open'); toggle.setAttribute('aria-expanded', o); });
  links.addEventListener('click', e => { if (e.target.tagName === 'A') { links.classList.remove('open'); toggle.setAttribute('aria-expanded', false); } });

  // REVEAL
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .12 }) : null;
  document.querySelectorAll('.reveal').forEach(el => io ? io.observe(el) : el.classList.add('in'));

  // CONFIG + COUNTDOWN
  let target = new Date('2027-08-26T16:00:00-04:00');
  const tick = () => {
    let d = Math.max(0, target - Date.now()) / 1000;
    const v = { d: Math.floor(d / 86400), h: Math.floor(d % 86400 / 3600), m: Math.floor(d % 3600 / 60), s: Math.floor(d % 60) };
    for (const k in v) $(`#countdown [data-k=${k}]`).textContent = k === 'd' ? v[k] : String(v[k]).padStart(2, '0');
  };
  tick(); setInterval(tick, 1000);

  api('/api/config').then(c => {
    if (c.weddingDateISO) { target = new Date(c.weddingDateISO); tick(); }
    const p = c.payments || {};
    const vh = (p.venmoHandle || '').replace(/^@/, '');
    $('#venmo-handle').textContent = '@' + vh;
    $('#venmo-btn').href = `https://venmo.com/u/${encodeURIComponent(vh)}`;
    $('#zelle-recipient').textContent = p.zelleRecipient || '';
    $('#zelle-name').textContent = p.zelleName ? 'Account name: ' + p.zelleName : '';
    if (p.venmoQr) $('#venmo-qr').innerHTML = `<img src="${esc(p.venmoQr)}" alt="Venmo QR code">`;
    if (p.zelleQr) $('#zelle-qr').innerHTML = `<img src="${esc(p.zelleQr)}" alt="Zelle QR code">`;
    $('#stripe-btn').href = p.stripePaymentLink || '#';
    $('#zelle-copy').onclick = async () => {
      try { await navigator.clipboard.writeText(p.zelleRecipient || ''); toast('Zelle info copied'); } catch { toast(p.zelleRecipient); }
    };
  }).catch(() => {});

  // RSVP
  const form = $('#rsvp-form'), attendingOnly = $('.attending-only');
  form.addEventListener('change', e => { if (e.target.name === 'attending') attendingOnly.classList.toggle('off', e.target.value === 'no'); });
  let pickedSong = null, results = [], active = -1, searchTimer, searchSeq = 0;
  const songInput = $('#r-song'), list = $('#song-results'), picked = $('#song-picked');
  const showList = show => { list.hidden = !show; songInput.setAttribute('aria-expanded', show); };
  const renderResults = () => {
    list.innerHTML = results.length ? results.map((t, i) => `<li role="option" data-i="${i}" aria-selected="${i === active}">
      ${t.art ? `<img src="${esc(t.art)}" alt="" loading="lazy">` : '<img alt="">'}<div><div class="t">${esc(t.title)}</div><div class="a">${esc(t.artist)}${t.album ? ' · ' + esc(t.album) : ''}</div></div></li>`).join('')
      : '<li class="empty">No songs found. Try another search.</li>';
    showList(true);
  };
  const pick = t => {
    pickedSong = t; showList(false); songInput.value = ''; songInput.parentElement.hidden = true;
    picked.innerHTML = `${t.art ? `<img src="${esc(t.art)}" alt="">` : ''}<div><div class="t">${esc(t.title)}</div><div class="a">${esc(t.artist)}</div></div><button type="button" aria-label="Remove song">×</button>`;
    picked.hidden = false;
    picked.querySelector('button').onclick = () => { pickedSong = null; picked.hidden = true; songInput.parentElement.hidden = false; songInput.focus(); };
  };
  songInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = songInput.value.trim();
    if (q.length < 2) return showList(false);
    searchTimer = setTimeout(async () => {
      const seq = ++searchSeq;
      try {
        const j = await api('/api/songs/search?q=' + encodeURIComponent(q));
        if (seq !== searchSeq) return;
        results = j.tracks || []; active = -1; renderResults();
        $('#song-source').textContent = j.source === 'spotify' ? '· powered by Spotify' : '';
      } catch (e) { list.innerHTML = `<li class="empty">${esc(e.message)}</li>`; showList(true); }
    }, 280);
  });
  songInput.addEventListener('keydown', e => {
    if (list.hidden || !results.length) return;
    if (e.key === 'ArrowDown') { active = Math.min(active + 1, results.length - 1); renderResults(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); renderResults(); e.preventDefault(); }
    else if (e.key === 'Enter' && active >= 0) { pick(results[active]); e.preventDefault(); }
    else if (e.key === 'Escape') showList(false);
  });
  list.addEventListener('mousedown', e => { const li = e.target.closest('li[data-i]'); if (li) { e.preventDefault(); pick(results[+li.dataset.i]); } });
  songInput.addEventListener('blur', () => setTimeout(() => showList(false), 150));

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(form), msg = $('#rsvp-msg'), btn = form.querySelector('[type=submit]');
    const body = { name: fd.get('name'), email: fd.get('email'), attending: fd.get('attending'), partySize: fd.get('partySize'), dietary: fd.get('dietary'), message: fd.get('message'), song: fd.get('attending') === 'yes' ? pickedSong : null };
    msg.className = 'form-msg'; msg.textContent = ''; btn.disabled = true;
    try {
      await api('/api/rsvp', { method: 'POST', body: JSON.stringify(body) });
      msg.className = 'form-msg ok';
      msg.textContent = body.attending === 'yes' ? `Thank you, ${body.name.split(' ')[0]}! We can't wait to celebrate with you.` + (pickedSong ? ` "${pickedSong.title}" is on the list. 🎶` : '') : `Thank you for letting us know, ${body.name.split(' ')[0]}. You'll be missed!`;
      form.reset(); attendingOnly.classList.remove('off');
      if (pickedSong) { pickedSong = null; picked.hidden = true; songInput.parentElement.hidden = false; }
    } catch (err) { msg.className = 'form-msg err'; msg.textContent = err.message; }
    finally { btn.disabled = false; }
  });

  // QUIZ
  let questions = [], answers = [], qi = 0, player = '', myEntry = null;
  const renderBoard = lb => {
    $('#leaderboard').innerHTML = lb.length ? lb.map(s => {
      const me = myEntry && s.name === myEntry.name && s.createdAt === myEntry.createdAt;
      return `<li class="${me ? 'me' : ''}"><span class="nm">${esc(s.name)}</span><span class="sc">${s.score}/${s.total}</span></li>`;
    }).join('') : '<li class="muted">No scores yet. Be the first!</li>';
  };
  const loadBoard = () => api('/api/leaderboard').then(j => renderBoard(j.leaderboard)).catch(() => {});
  loadBoard();
  api('/api/quiz').then(j => { questions = j.questions; }).catch(() => {});

  const showQ = () => {
    const q = questions[qi];
    $('#q-count').textContent = `Question ${qi + 1} of ${questions.length}`;
    $('#q-text').textContent = q.q;
    $('#quiz-progress-bar').style.width = (qi / questions.length * 100) + '%';
    $('#q-options').innerHTML = q.options.map((o, i) => `<button type="button" data-i="${i}" class="${answers[qi] === i ? 'sel' : ''}"><b>${'ABCDEFGH'[i]}</b><span>${esc(o)}</span></button>`).join('');
    $('#q-back').style.visibility = qi ? 'visible' : 'hidden';
  };
  $('#quiz-name-form').addEventListener('submit', e => {
    e.preventDefault();
    player = $('#quiz-name').value.trim();
    if (!player || !questions.length) return;
    answers = []; qi = 0;
    $('#quiz-start').hidden = true; $('#quiz-result').hidden = true; $('#quiz-play').hidden = false; showQ();
  });
  $('#q-options').addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    answers[qi] = +b.dataset.i; b.classList.add('sel');
    if (qi < questions.length - 1) { setTimeout(() => { qi++; showQ(); }, 220); return; }
    $('#quiz-progress-bar').style.width = '100%';
    try {
      const r = await api('/api/quiz/submit', { method: 'POST', body: JSON.stringify({ name: player, answers }) });
      myEntry = r.leaderboard.find(s => s.name === player && s.score === r.score) || null;
      if (myEntry) myEntry = { name: myEntry.name, createdAt: r.leaderboard.filter(s => s.name === player && s.score === r.score).map(s => s.createdAt).sort().pop() };
      $('#quiz-score').textContent = `${r.score}/${r.total}`;
      const pct = r.score / r.total;
      $('#quiz-verdict').textContent = pct === 1 ? 'Perfect score! Are you secretly one of the couple?' : pct >= .7 ? 'Impressive! You clearly know Dave & Davina well.' : pct >= .4 ? 'Not bad! A few more dinners with the couple and you\'ll ace it.' : 'Time to catch up with Dave & Davina at the reception!';
      $('#quiz-play').hidden = true; $('#quiz-result').hidden = false;
      renderBoard(r.leaderboard);
    } catch (err) { toast(err.message); }
  });
  $('#q-back').addEventListener('click', () => { if (qi) { qi--; showQ(); } });
  $('#quiz-again').addEventListener('click', () => { $('#quiz-result').hidden = true; $('#quiz-start').hidden = false; });
})();
