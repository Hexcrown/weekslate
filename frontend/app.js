/* Weekslate wall display logic. Plain JavaScript, no dependencies.
   All text from the calendar/API is inserted with textContent (never innerHTML),
   so a malicious calendar entry can't inject markup. */
(function () {
  'use strict';

  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const IDLE_RESET_MS = 120000;   // wander off to another week? snap back to today after 2 min
  const TICK_MS = 15000;          // housekeeping tick: clock, midnight rollover, polling

  // ---------- small helpers ----------

  const $ = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parseYmd = (s) => { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  let weekStart = 0;   // 0 = Sunday, 1 = Monday (a setting)
  const startOfWeek = (d) => addDays(startOfDay(d), -((d.getDay() - weekStart + 7) % 7));
  const dowOrder = () => DOW.slice(weekStart).concat(DOW.slice(0, weekStart));
  const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
  const endOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

  function h(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function fmtTime(t) {
    if (!t) return '';
    const p = t.split(':').map(Number);
    const hr = p[0] % 12 || 12;
    const ap = p[0] >= 12 ? 'PM' : 'AM';
    return p[1] ? hr + ':' + pad(p[1]) + ' ' + ap : hr + ' ' + ap;
  }

  // Compact time for tight spots (month chips): "6p", "8:30a".
  function fmtTimeShort(t) {
    if (!t) return '';
    const p = t.split(':').map(Number);
    const hr = p[0] % 12 || 12;
    return (p[1] ? hr + ':' + pad(p[1]) : String(hr)) + (p[0] >= 12 ? 'p' : 'a');
  }

  // An event takes its person's color; events for nobody in particular ("everyone") get the neutral family color.
  function evColor(ev) {
    return safeColor(ev.color) || 'var(--everyone)';
  }

  function safeColor(c) {
    return /^#[0-9a-f]{3,8}$/i.test(c || '') ? c : '';
  }

  async function getJSON(path) {
    const r = await fetch(path, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  // ---------- state ----------

  const now0 = new Date();
  const state = {
    view: 'week',
    anchor: startOfDay(now0),
    today: ymd(now0),
    events: [],
    chores: [],
    scores: [],
    cal: { configured: null, last_error: null },
    apiDown: false,
    calError: false,
    lastTouch: Date.now(),
    sig: { cal: '', chores: '', scores: '' },
  };

  // ---------- date ranges ----------

  function visibleRange() {
    if (state.view === 'week') {
      const s = startOfWeek(state.anchor);
      return { start: s, end: addDays(s, 6) };
    }
    const first = startOfMonth(state.anchor);
    const last = endOfMonth(state.anchor);
    return { start: startOfWeek(first), end: addDays(startOfWeek(last), 6) };
  }

  function rangeLabel() {
    const r = visibleRange();
    if (state.view === 'month') {
      return state.anchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
    const m1 = r.start.toLocaleDateString('en-US', { month: 'short' });
    const m2 = r.end.toLocaleDateString('en-US', { month: 'short' });
    return m1 === m2
      ? m1 + ' ' + r.start.getDate() + ' – ' + r.end.getDate()
      : m1 + ' ' + r.start.getDate() + ' – ' + m2 + ' ' + r.end.getDate();
  }

  function inCurrentPeriod() {
    const t = parseYmd(state.today);
    if (state.view === 'week') return ymd(startOfWeek(state.anchor)) === ymd(startOfWeek(t));
    return state.anchor.getFullYear() === t.getFullYear() && state.anchor.getMonth() === t.getMonth();
  }

  function groupByDate(events) {
    const m = {};
    events.forEach((e) => { (m[e.date] = m[e.date] || []).push(e); });
    return m;
  }

  // ---------- rendering: calendar ----------

  function eventEl(ev) {
    const e = h('div', 'ev' + (ev.all_day ? ' allday' : ''));
    e.style.setProperty('--c', evColor(ev));
    if (!ev.all_day) e.appendChild(h('span', 't', fmtTime(ev.start_time)));
    e.appendChild(h('span', 'n', ev.title));
    return e;
  }

  function buildWeek() {
    const start = startOfWeek(state.anchor);
    const by = groupByDate(state.events);
    const wrap = h('div', 'week');
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, i);
      const key = ymd(d);
      const col = h('div', 'day' + (key === state.today ? ' today' : '') + (key < state.today ? ' past' : ''));
      const head = h('div', 'day-head');
      head.appendChild(h('span', 'dow', DOW[d.getDay()]));
      head.appendChild(h('span', 'dnum', String(d.getDate())));
      const list = h('div', 'events');
      (by[key] || []).forEach((ev) => list.appendChild(eventEl(ev)));
      col.appendChild(head);
      col.appendChild(list);
      wrap.appendChild(col);
    }
    return wrap;
  }

  function buildMonth() {
    const r = visibleRange();
    const weeks = Math.round(((r.end - r.start) / 86400000 + 1) / 7);
    const by = groupByDate(state.events);
    const wrap = h('div', 'month');
    wrap.style.setProperty('--weeks', String(weeks));
    dowOrder().forEach((n) => wrap.appendChild(h('div', 'mdow', n)));

    for (let i = 0; i < weeks * 7; i++) {
      const d = addDays(r.start, i);
      const key = ymd(d);
      const cell = h('button', 'cell' +
        (key === state.today ? ' today' : '') +
        (d.getMonth() !== state.anchor.getMonth() ? ' other' : ''));
      cell.type = 'button';
      const label = d.getDate() === 1
        ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : String(d.getDate());
      cell.appendChild(h('span', 'num', label));

      const list = by[key] || [];
      const cap = weeks >= 6 ? 3 : 4;   // taller cells in 5-week months fit one more
      const shown = list.length <= cap ? list : list.slice(0, cap - 1);
      shown.forEach((ev) => {
        const chip = h('div', 'chip' + (ev.all_day ? ' allday' : ''),
          ev.all_day ? ev.title : fmtTimeShort(ev.start_time) + ' ' + ev.title);
        chip.style.setProperty('--c', evColor(ev));
        cell.appendChild(chip);
      });
      if (list.length > shown.length) {
        cell.appendChild(h('div', 'more', '+' + (list.length - shown.length) + ' more'));
      }
      cell.addEventListener('click', () => openDay(key));
      wrap.appendChild(cell);
    }
    return wrap;
  }

  function renderCalendar(force) {
    const sig = [state.view, ymd(state.anchor), state.today, JSON.stringify(state.events)].join('|');
    $('range').textContent = rangeLabel();
    $('v-week').setAttribute('aria-pressed', String(state.view === 'week'));
    $('v-month').setAttribute('aria-pressed', String(state.view === 'month'));
    if (!force && sig === state.sig.cal) return;   // nothing changed: keep scroll positions
    state.sig.cal = sig;
    $('cal').replaceChildren(state.view === 'week' ? buildWeek() : buildMonth());
  }

  // ---------- rendering: chores and scores ----------

  function renderChores(force) {
    const sig = JSON.stringify(state.chores);
    if (!force && sig === state.sig.chores) return;
    state.sig.chores = sig;

    const ul = $('chores');
    ul.replaceChildren();
    const left = state.chores.filter((c) => !c.done).length;
    $('choreCount').textContent = state.chores.length === 0 ? '' : (left === 0 ? 'All done' : left + ' left');

    if (state.chores.length === 0) {
      const li = h('li');
      li.appendChild(h('p', 'empty', 'Nothing due today.'));
      ul.appendChild(li);
      return;
    }

    state.chores.forEach((c) => {
      const li = h('li');
      const btn = h('button', 'chore' + (c.done ? ' done' : ''));
      btn.type = 'button';
      btn.setAttribute('role', 'checkbox');
      btn.setAttribute('aria-checked', String(!!c.done));
      const col = safeColor(c.person_color);
      if (col) btn.style.setProperty('--p', col);
      btn.appendChild(h('span', 'box'));
      const text = h('span', 'chore-text');
      text.appendChild(h('span', 'chore-title', c.title));
      if (c.person_name) text.appendChild(h('span', 'chore-who', c.person_name));
      btn.appendChild(text);
      btn.addEventListener('click', () => toggleChore(c));
      li.appendChild(btn);
      ul.appendChild(li);
    });
  }

  function renderScores() {
    const sig = JSON.stringify(state.scores);
    if (sig === state.sig.scores) return;
    state.sig.scores = sig;

    const ul = $('scores');
    ul.replaceChildren();
    if (state.scores.length === 0) {
      const li = h('li');
      li.appendChild(h('p', 'empty', 'Add people to start a weekly scoreboard.'));
      ul.appendChild(li);
      return;
    }
    const max = Math.max(1, ...state.scores.map((s) => s.points));
    state.scores.forEach((s) => {
      const li = h('li', 'score-row');
      const col = safeColor(s.color);
      if (col) li.style.setProperty('--p', col);
      li.appendChild(h('span', 'score-name', s.name));
      const bar = h('div', 'bar');
      const fill = h('i');
      fill.style.width = Math.round((s.points / max) * 100) + '%';
      bar.appendChild(fill);
      li.appendChild(bar);
      li.appendChild(h('span', 'score-pts', String(s.points)));
      ul.appendChild(li);
    });
  }

  function renderClock() {
    const n = new Date();
    $('bigdate').textContent = n.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    $('clock').textContent = n.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function updateBanner() {
    let msg = '';
    if (state.apiDown) {
      msg = "Can't reach Weekslate. Trying again every minute.";
    } else if (state.cal.configured === 0) {
      msg = 'No calendar linked yet. Add your calendar link to the .env file, then restart Weekslate.';
    } else if (state.calError || state.cal.last_error) {
      msg = "Can't load the calendar. Showing the last events that loaded.";
    }
    const b = $('banner');
    b.textContent = msg;
    b.hidden = !msg;
  }

  // ---------- day sheet (month view) ----------

  function openDay(key) {
    const list = groupByDate(state.events)[key] || [];
    $('modalTitle').textContent = parseYmd(key).toLocaleDateString('en-US',
      { weekday: 'long', month: 'long', day: 'numeric' });
    const body = $('modalBody');
    body.replaceChildren();
    if (list.length === 0) body.appendChild(h('p', 'empty', 'Nothing planned.'));
    list.forEach((ev) => {
      const row = h('div', 'mrow');
      row.style.setProperty('--c', evColor(ev));
      const when = ev.all_day ? 'All day'
        : fmtTime(ev.start_time) + (ev.end_time ? ' – ' + fmtTime(ev.end_time) : '');
      row.appendChild(h('div', 'mwhen', when));
      const what = h('div', 'mwhat');
      what.appendChild(h('div', 'mname', ev.title));
      if (ev.person) what.appendChild(h('div', 'mloc', ev.person));
      if (ev.location) what.appendChild(h('div', 'mloc', ev.location));
      row.appendChild(what);
      body.appendChild(row);
    });
    $('modal').hidden = false;
  }

  function closeDay() { $('modal').hidden = true; }

  // ---------- data ----------

  async function refreshCalendar() {
    const r = visibleRange();
    const key = state.view + ymd(r.start) + ymd(r.end);
    try {
      const events = await getJSON('/api/calendar?start=' + ymd(r.start) + '&end=' + ymd(r.end));
      const nowR = visibleRange();
      if (key !== state.view + ymd(nowR.start) + ymd(nowR.end)) return;   // user moved on; drop stale reply
      state.events = events;
      state.calError = false;
      state.apiDown = false;
    } catch (e) {
      if (e instanceof TypeError) state.apiDown = true; else state.calError = true;
    }
    try { state.cal = await getJSON('/api/calendar/status'); } catch (_) { /* banner covers it */ }
    renderCalendar();
    updateBanner();
  }

  async function refreshScores() {
    try { state.scores = await getJSON('/api/scores?days=7'); } catch (_) { /* keep last */ }
    renderScores();
  }

  async function refreshChores() {
    try {
      state.chores = await getJSON('/api/chores/day?day=' + state.today);
      state.apiDown = false;
    } catch (e) {
      if (e instanceof TypeError) state.apiDown = true;
    }
    renderChores();
    updateBanner();
    refreshScores();
  }

  async function toggleChore(c) {
    const want = !c.done;
    c.done = want;
    renderChores(true);
    try {
      const r = await fetch('/api/chores/' + c.id + '/complete?day=' + encodeURIComponent(c.date),
        { method: want ? 'POST' : 'DELETE' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      refreshScores();
    } catch (_) {
      c.done = !want;          // roll back so the wall never lies about what's done
      renderChores(true);
    }
  }

  function refreshAll() {
    renderClock();
    renderCalendar(true);
    refreshCalendar();
    refreshChores();
  }

  // ---------- navigation ----------

  function shift(dir) {
    if (state.view === 'week') {
      state.anchor = addDays(state.anchor, 7 * dir);
    } else {
      state.anchor = new Date(state.anchor.getFullYear(), state.anchor.getMonth() + dir, 1);
    }
    renderCalendar();
    refreshCalendar();
  }

  function goToday() {
    state.anchor = startOfDay(new Date());
    renderCalendar();
    refreshCalendar();
  }

  function setView(v) {
    if (state.view === v) return;
    state.view = v;
    renderCalendar();
    refreshCalendar();
  }

  // ---------- housekeeping ----------

  let tickCount = 0;

  function nightlyReload(n) {
    // One fresh page load around 3 AM keeps a never-sleeping iPad tidy.
    if (n.getHours() !== 3) return;
    try {
      if (localStorage.getItem('weekslate.reload') === state.today) return;
      localStorage.setItem('weekslate.reload', state.today);
      location.reload();
    } catch (_) { /* no storage: skip rather than risk a reload loop */ }
  }

  function tick() {
    tickCount++;
    const n = new Date();
    renderClock();

    const today = ymd(n);
    if (today !== state.today) {                    // midnight passed
      const followed = inCurrentPeriod();
      state.today = today;
      if (followed) state.anchor = startOfDay(n);
      refreshAll();
      return;
    }

    if (!inCurrentPeriod() && Date.now() - state.lastTouch > IDLE_RESET_MS) {
      state.anchor = startOfDay(n);
      renderCalendar();
      closeDay();
    }

    if (tickCount % 4 === 0) { loadSettings(); refreshCalendar(); }   // about every minute
    if (tickCount % 2 === 0) refreshChores();       // about every 30 seconds
    nightlyReload(n);
  }

  // ---------- start ----------

  function bind() {
    $('prev').addEventListener('click', () => shift(-1));
    $('next').addEventListener('click', () => shift(1));
    $('today').addEventListener('click', goToday);
    $('v-week').addEventListener('click', () => setView('week'));
    $('v-month').addEventListener('click', () => setView('month'));
    $('modalClose').addEventListener('click', closeDay);
    $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeDay(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDay(); });
    document.addEventListener('pointerdown', () => { state.lastTouch = Date.now(); }, true);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshAll(); });
  }

  // ---------- settings (chosen on the Settings page) ----------

  function applySettings(s) {
    document.documentElement.setAttribute('data-theme', s.theme === 'light' ? 'light' : 'dark');
    $('scoresPanel').hidden = !s.show_points;
    const ws = s.week_start === 1 ? 1 : 0;
    if (ws !== weekStart) {                       // week now starts on a different day
      weekStart = ws;
      renderCalendar(true);
      refreshCalendar();
    }
  }

  // Returns false when first-run setup is still needed (and sends the person there).
  async function loadSettings() {
    try {
      const s = await getJSON('/api/settings');
      if (!s.setup_complete) { location.replace('/settings.html'); return false; }
      applySettings(s);
      return s;
    } catch (_) {
      return null;                                // server unreachable: keep what we have
    }
  }

  async function start() {
    bind();
    const s = await loadSettings();
    if (s === false) return;
    if (s) state.view = s.default_view === 'month' ? 'month' : 'week';
    refreshAll();
    setInterval(tick, TICK_MS);
  }

  start();
})();
