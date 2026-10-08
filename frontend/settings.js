/* Weekslate settings page: first-run setup for new installs, a settings list after that.
   Everything typed by a person or read from the server goes in with textContent
   (the h() helper), never innerHTML. */
(function () {
  'use strict';

  const PEOPLE_COLORS = ['#8ecfc0', '#f2a58e', '#9db8f0', '#f0d37a', '#c9a6e8', '#a9d98b', '#f08fb0', '#b8c4cc'];
  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];   // 0 = Monday, like the server
  const root = document.getElementById('root');

  const state = {
    settings: null,
    calendars: [],
    people: [],
    chores: [],
    mode: 'manage',        // 'wizard' on a brand-new install
    step: 0,
    open: new Set(),       // which settings cards are expanded
    editing: null,         // e.g. 'cal-3' while that row is being edited
  };

  // ---------- helpers ----------

  let idCounter = 0;
  const uid = (p) => p + '-' + (++idCounter);
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parseYmd = (s) => { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
  const weekdayIndex = (d) => (d.getDay() + 6) % 7;     // Monday = 0

  function append(parent, kid) {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) kid.forEach((k) => append(parent, k));
    else parent.append(kid);
  }

  function h(tag, props) {
    const e = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach((k) => {
        const v = props[k];
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k === 'on') Object.keys(v).forEach((n) => e.addEventListener(n, v[n]));
        else if (k === 'attrs') Object.keys(v).forEach((n) => e.setAttribute(n, v[n]));
        else if (k === 'vars') Object.keys(v).forEach((n) => e.style.setProperty(n, v[n]));
        else e[k] = v;
      });
    }
    for (let i = 2; i < arguments.length; i++) append(e, arguments[i]);
    return e;
  }

  class ApiError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }

  function errText(data, status) {
    if (data && typeof data.detail === 'string') return data.detail;
    if (data && Array.isArray(data.detail) && data.detail[0] && data.detail[0].msg) return data.detail[0].msg;
    return 'Something went wrong (' + status + ').';
  }

  async function api(method, path, body) {
    const opt = { method: method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) {
      opt.headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(body);
    }
    const r = await fetch(path, opt);
    if (r.status === 401) { showLock(); throw new ApiError(401, 'PIN required'); }
    let data = null;
    try { data = await r.json(); } catch (_) { /* empty body */ }
    if (!r.ok) throw new ApiError(r.status, errText(data, r.status));
    return data;
  }

  let toastTimer;
  function toast(msg, bad) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast' + (bad ? ' bad' : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
  }

  function fail(e) {
    if (e && e.status === 401) return;          // the lock screen is already showing
    toast(e && e.message ? e.message : 'Something went wrong.', true);
  }

  function field(labelText, input) {
    if (!input.id) input.id = uid('f');
    return h('div', null, h('label', { htmlFor: input.id, text: labelText }), input);
  }

  function groupField(labelText, control) {
    const id = uid('g');
    control.setAttribute('role', 'group');
    control.setAttribute('aria-labelledby', id);
    return h('div', null, h('div', { class: 'label', id: id, text: labelText }), control);
  }

  function swatches(name, options, selected) {      // options: [{ value, css, label }]
    const wrap = h('div', { class: 'swatches', attrs: { role: 'radiogroup' } });
    let current = selected;
    options.forEach((o) => {
      const input = h('input', {
        type: 'radio', name: name, value: String(o.value),
        checked: String(o.value) === String(selected),
        attrs: { 'aria-label': o.label },
      });
      input.addEventListener('change', () => { current = o.value; });
      wrap.append(h('label', { class: 'sw', vars: { '--p': o.css } }, input, h('span')));
    });
    return { el: wrap, get: () => current };
  }

  function segmented(options, value, onPick) {      // options: [[value, label], ...]
    const wrap = h('div', { class: 'seg' });
    options.forEach((o) => {
      wrap.append(h('button', {
        type: 'button', text: o[1],
        attrs: { 'aria-pressed': String(o[0] === value) },
        on: { click: () => onPick(o[0]) },
      }));
    });
    return wrap;
  }

  function messageLine() {
    const el = h('p', { attrs: { role: 'status' } });
    return {
      el: el,
      say: (text, bad) => { el.textContent = text || ''; el.className = text ? (bad ? 'err' : 'ok') : ''; },
    };
  }

  // ---------- loading ----------

  async function loadSettings() {
    state.settings = await api('GET', '/api/settings');
    document.documentElement.setAttribute('data-theme', state.settings.theme === 'light' ? 'light' : 'dark');
  }

  async function loadData() {
    const all = await Promise.all([
      api('GET', '/api/calendars'), api('GET', '/api/people'), api('GET', '/api/chores'),
    ]);
    state.calendars = all[0];
    state.people = all[1];
    state.chores = all[2];
  }

  async function refresh() {
    await loadSettings();
    await loadData();
    render();
  }

  function edit(key) { state.editing = key; render(); }

  // ---------- calendars ----------

  // "Whose calendar is this?" Everyone = the neutral family color.
  function ownerSelect(selected) {
    const sel = h('select');
    sel.append(h('option', { value: '', text: 'Everyone (family)' }));
    state.people.forEach((p) => sel.append(h('option', { value: String(p.id), text: p.name })));
    sel.value = selected == null ? '' : String(selected);
    return { el: sel, get: () => (sel.value === '' ? null : Number(sel.value)) };
  }

  const ownerOf = (c) => state.people.find((p) => p.id === c.person_id) || null;

  function renderCalendars() {
    const box = h('div');
    if (!state.calendars.length) box.append(h('p', { class: 'empty', text: 'No calendars linked yet.' }));
    state.calendars.forEach((c) => box.append(state.editing === 'cal-' + c.id ? calendarEditForm(c) : calendarRow(c)));
    box.append(addCalendarForm());
    return box;
  }

  function calendarRow(c) {
    return h('div', { class: 'item' },
      h('span', { class: 'dot', vars: { '--p': ownerOf(c) ? ownerOf(c).color : 'var(--everyone)' } }),
      h('div', { class: 'item-main' },
        h('div', { class: 'item-title', text: c.name }),
        h('div', { class: 'item-sub', text: ownerOf(c) ? ownerOf(c).name + "'s events" : 'Everyone' }),
        h('div', { class: 'item-sub', text: c.url }),
        c.error ? h('div', { class: 'item-err', text: c.error }) : null),
      h('div', { class: 'item-actions' },
        h('button', { class: 'btn small', type: 'button', text: 'Edit', on: { click: () => edit('cal-' + c.id) } }),
        h('button', { class: 'btn small danger', type: 'button', text: 'Remove', on: { click: () => removeCalendar(c) } })));
  }

  async function removeCalendar(c) {
    if (!confirm('Remove "' + c.name + '"? Its events will disappear from the wall display.')) return;
    try { await api('DELETE', '/api/calendars/' + c.id); toast('Calendar removed'); await refresh(); } catch (e) { fail(e); }
  }

  function calendarEditForm(c) {
    const name = h('input', { type: 'text', value: c.name, maxLength: 60, autocomplete: 'off' });
    const owner = ownerSelect(c.person_id);
    const msg = messageLine();
    return h('form', {
      class: 'form', noValidate: true,
      on: {
        submit: async (ev) => {
          ev.preventDefault();
          if (!name.value.trim()) { msg.say('Give this calendar a name.', true); return; }
          try {
            await api('PUT', '/api/calendars/' + c.id, { name: name.value.trim(), person_id: owner.get() });
            state.editing = null; toast('Calendar saved'); await refresh();
          } catch (e) { fail(e); msg.say(e.message, true); }
        },
      },
    },
      h('h3', { text: 'Edit calendar' }),
      field('Name', name),
      field('Whose events are these?', owner.el),
      msg.el,
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'submit', text: 'Save' }),
        h('button', { class: 'btn', type: 'button', text: 'Cancel', on: { click: () => edit(null) } })),
      h('p', { class: 'note', text: 'To change the link itself, remove this calendar and add it again.' }));
  }

  function addCalendarForm() {
    const name = h('input', { type: 'text', maxLength: 60, placeholder: 'Family', autocomplete: 'off' });
    const url = h('input', {
      type: 'url', placeholder: 'webcal://… or https://…', autocomplete: 'off',
      inputMode: 'url', spellcheck: false, attrs: { autocapitalize: 'off', autocorrect: 'off' },
    });
    const owner = ownerSelect(null);
    const msg = messageLine();
    const addBtn = h('button', { class: 'btn primary', type: 'submit', text: 'Add calendar' });
    const anywayBtn = h('button', { class: 'btn', type: 'button', text: 'Add it anyway', hidden: true });

    async function add(skipCheck) {
      const n = name.value.trim();
      const u = url.value.trim();
      if (!n) { msg.say('Give this calendar a name, like Family.', true); return; }
      if (!u) { msg.say('Paste the calendar link.', true); return; }
      addBtn.disabled = true;
      anywayBtn.hidden = true;
      msg.say('Checking the link…');
      try {
        let found = null;
        if (!skipCheck) {
          const t = await api('POST', '/api/calendars/test', { url: u });
          if (!t.ok) {
            msg.say("Couldn't read that link. " + t.error, true);
            anywayBtn.hidden = false;
            return;
          }
          found = t.events;
        }
        await api('POST', '/api/calendars', { name: n, url: u, person_id: owner.get() });
        toast(found == null ? 'Calendar added' : 'Calendar added. Found ' + found + (found === 1 ? ' event' : ' events') + ' in the next 30 days.');
        await refresh();
      } catch (e) {
        fail(e);
        msg.say(e.message, true);
      } finally {
        addBtn.disabled = false;
      }
    }

    anywayBtn.addEventListener('click', () => add(true));

    return h('form', { class: 'form', noValidate: true, on: { submit: (ev) => { ev.preventDefault(); add(false); } } },
      h('h3', { text: 'Add a calendar' }),
      field('Name', name),
      field('Calendar link', url),
      field('Whose events are these?', owner.el),
      h('p', { class: 'note', text: 'Their color on the wall. Pick Everyone for shared things like trips. An event whose title includes a name, like "Ava dance recital", takes that person’s color.' }),
      h('details', { class: 'help' },
        h('summary', { text: 'Where do I find my link?' }),
        h('ul', null,
          h('li', { text: 'Apple Calendar on iPhone or iPad: open Calendar, tap Calendars, tap the (i) next to the calendar, turn on Public Calendar, then tap Share Link and copy it.' }),
          h('li', { text: 'Google Calendar on a computer: open the calendar’s settings and copy the Secret address in iCal format.' }),
          h('li', { text: 'Anyone with the link can read that calendar, so use a calendar made just for the family.' }))),
      msg.el,
      h('div', { class: 'row' }, addBtn, anywayBtn));
  }

  // ---------- people ----------

  const nextPersonColor = () => {
    const used = new Set(state.people.map((p) => p.color.toLowerCase()));
    return PEOPLE_COLORS.find((c) => !used.has(c)) || PEOPLE_COLORS[0];
  };
  const personSwatchOptions = () => PEOPLE_COLORS.map((c, i) => ({ value: c, css: c, label: 'Color ' + (i + 1) }));

  function renderPeople() {
    const box = h('div');
    if (!state.people.length) box.append(h('p', { class: 'empty', text: 'No one added yet.' }));
    state.people.forEach((p) => box.append(state.editing === 'person-' + p.id ? personForm(p) : personRow(p)));
    box.append(personForm(null));
    return box;
  }

  function personRow(p) {
    const n = state.chores.filter((c) => c.person_id === p.id).length;
    return h('div', { class: 'item' },
      h('span', { class: 'dot', vars: { '--p': p.color } }),
      h('div', { class: 'item-main' },
        h('div', { class: 'item-title', text: p.name }),
        h('div', { class: 'item-sub', text: n === 1 ? '1 chore' : n + ' chores' })),
      h('div', { class: 'item-actions' },
        h('button', { class: 'btn small', type: 'button', text: 'Edit', on: { click: () => edit('person-' + p.id) } }),
        h('button', { class: 'btn small danger', type: 'button', text: 'Remove', on: { click: () => removePerson(p) } })));
  }

  async function removePerson(p) {
    if (!confirm('Remove ' + p.name + '? Their chores stay, but no one will be assigned to them.')) return;
    try { await api('DELETE', '/api/people/' + p.id); toast('Removed'); await refresh(); } catch (e) { fail(e); }
  }

  function personForm(p) {
    const name = h('input', { type: 'text', value: p ? p.name : '', maxLength: 40, placeholder: 'Ava', autocomplete: 'off' });
    const pick = swatches(uid('pc'), personSwatchOptions(), p ? p.color : nextPersonColor());
    const msg = messageLine();
    return h('form', {
      class: p ? 'form' : 'form', noValidate: true,
      on: {
        submit: async (ev) => {
          ev.preventDefault();
          if (!name.value.trim()) { msg.say('Type a name.', true); return; }
          const body = { name: name.value.trim(), color: pick.get() };
          try {
            if (p) await api('PUT', '/api/people/' + p.id, body); else await api('POST', '/api/people', body);
            state.editing = null; toast(p ? 'Saved' : name.value.trim() + ' added'); await refresh();
          } catch (e) { fail(e); msg.say(e.message, true); }
        },
      },
    },
      h('h3', { text: p ? 'Edit person' : 'Add a person' }),
      field('Name', name),
      groupField('Color', pick.el),
      msg.el,
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'submit', text: p ? 'Save' : 'Add person' }),
        p ? h('button', { class: 'btn', type: 'button', text: 'Cancel', on: { click: () => edit(null) } }) : null));
  }

  // ---------- chores ----------

  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function describeChore(c) {
    const r = c.rule || { type: 'none' };
    const start = parseYmd(c.start_date);
    if (r.type === 'daily') return r.interval > 1 ? 'Every ' + r.interval + ' days' : 'Every day';
    if (r.type === 'weekly') {
      const days = (r.days && r.days.length ? r.days : [weekdayIndex(start)]).slice().sort((a, b) => a - b);
      return 'Every ' + (r.interval > 1 ? 'other ' : '') + 'week on ' + days.map((d) => WEEKDAYS[d]).join(', ');
    }
    if (r.type === 'monthly') return 'Monthly on the ' + ordinal(start.getDate());
    return 'Once on ' + start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function renderChores() {
    const box = h('div');
    if (!state.chores.length) box.append(h('p', { class: 'empty', text: 'No chores yet.' }));
    state.chores.forEach((c) => box.append(state.editing === 'chore-' + c.id ? choreForm(c) : choreRow(c)));
    box.append(choreForm(null));
    return box;
  }

  function choreRow(c) {
    const person = state.people.find((p) => p.id === c.person_id);
    const sub = describeChore(c) + (person ? ', ' + person.name : '') +
      (state.settings.show_points ? ', ' + c.points + (c.points === 1 ? ' point' : ' points') : '');
    return h('div', { class: 'item' },
      h('span', { class: 'dot', vars: { '--p': person ? person.color : 'var(--chalk-dim)' } }),
      h('div', { class: 'item-main' },
        h('div', { class: 'item-title', text: c.title }),
        h('div', { class: 'item-sub', text: sub })),
      h('div', { class: 'item-actions' },
        h('button', { class: 'btn small', type: 'button', text: 'Edit', on: { click: () => edit('chore-' + c.id) } }),
        h('button', { class: 'btn small danger', type: 'button', text: 'Delete', on: { click: () => removeChore(c) } })));
  }

  async function removeChore(c) {
    if (!confirm('Delete "' + c.title + '"? Its history goes with it.')) return;
    try { await api('DELETE', '/api/chores/' + c.id); toast('Chore deleted'); await refresh(); } catch (e) { fail(e); }
  }

  function choreForm(chore) {
    const rule = chore ? chore.rule : { type: 'daily', interval: 1 };
    const startDefault = chore ? chore.start_date : ymd(new Date());
    const repeatNow = rule.type === 'weekly' ? (rule.interval > 1 ? 'biweekly' : 'weekly')
      : rule.type === 'monthly' ? 'monthly' : rule.type === 'none' ? 'once' : 'daily';
    const days = new Set(rule.type === 'weekly' && rule.days && rule.days.length
      ? rule.days : [weekdayIndex(parseYmd(startDefault))]);

    const title = h('input', { type: 'text', value: chore ? chore.title : '', maxLength: 80, placeholder: 'Feed the dog', autocomplete: 'off' });
    const who = h('select', null,
      h('option', { value: '', text: 'Anyone' }),
      state.people.map((p) => h('option', { value: String(p.id), text: p.name })));
    who.value = chore && chore.person_id ? String(chore.person_id) : '';

    const repeat = h('select', null, [
      ['daily', 'Every day'], ['weekly', 'Every week, on certain days'],
      ['biweekly', 'Every other week, on certain days'], ['monthly', 'Once a month'], ['once', 'Just once'],
    ].map((o) => h('option', { value: o[0], text: o[1] })));
    repeat.value = repeatNow;

    const order = state.settings.week_start === 1 ? [0, 1, 2, 3, 4, 5, 6] : [6, 0, 1, 2, 3, 4, 5];
    const dayBox = h('div', { class: 'days' }, order.map((i) => h('button', {
      class: 'daybtn', type: 'button', text: WEEKDAYS[i],
      attrs: { 'aria-pressed': String(days.has(i)) },
      on: {
        click: (ev) => {
          if (days.has(i)) days.delete(i); else days.add(i);
          ev.currentTarget.setAttribute('aria-pressed', String(days.has(i)));
        },
      },
    })));
    const daysField = groupField('On these days', dayBox);

    const startIn = h('input', { type: 'date', value: startDefault });
    startIn.id = uid('f');
    const startLabel = h('label', { htmlFor: startIn.id, text: 'Starts on' });
    const startNote = h('p', { class: 'note', text: 'Every-other-week chores count their weeks from this date.' });

    const points = h('select', null, [1, 2, 3, 4, 5].map((n) => h('option', { value: String(n), text: String(n) })));
    if (chore && chore.points > 5) points.append(h('option', { value: String(chore.points), text: String(chore.points) }));
    points.value = String(chore ? chore.points : 1);

    function sync() {
      const v = repeat.value;
      daysField.hidden = !(v === 'weekly' || v === 'biweekly');
      startLabel.textContent = v === 'once' ? 'Date' : 'Starts on';
      startNote.hidden = v !== 'biweekly';
    }
    repeat.addEventListener('change', sync);
    sync();

    const msg = messageLine();

    async function submit() {
      const t = title.value.trim();
      if (!t) { msg.say('Give the chore a name.', true); return; }
      if (!startIn.value) { msg.say('Pick a start date.', true); return; }
      const v = repeat.value;
      let rulePayload;
      if (v === 'daily') rulePayload = { type: 'daily', interval: 1 };
      else if (v === 'weekly' || v === 'biweekly') {
        if (!days.size) { msg.say('Pick at least one day.', true); return; }
        rulePayload = { type: 'weekly', interval: v === 'biweekly' ? 2 : 1, days: Array.from(days).sort((a, b) => a - b) };
      } else if (v === 'monthly') rulePayload = { type: 'monthly', interval: 1 };
      else rulePayload = { type: 'none' };
      const payload = {
        title: t, start_date: startIn.value, rule: rulePayload,
        person_id: who.value ? Number(who.value) : null, points: Number(points.value),
      };
      try {
        if (chore) await api('PUT', '/api/chores/' + chore.id, payload); else await api('POST', '/api/chores', payload);
        state.editing = null;
        toast(chore ? 'Chore saved' : 'Chore added');
        await refresh();
      } catch (e) { fail(e); msg.say(e.message, true); }
    }

    return h('form', { class: 'form', noValidate: true, on: { submit: (ev) => { ev.preventDefault(); submit(); } } },
      h('h3', { text: chore ? 'Edit chore' : 'Add a chore' }),
      field('What needs doing?', title),
      field('Who does it?', who),
      field('How often?', repeat),
      daysField,
      h('div', null, startLabel, startIn),
      startNote,
      state.settings.show_points ? field('Points', points) : null,
      msg.el,
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'submit', text: chore ? 'Save' : 'Add chore' }),
        chore ? h('button', { class: 'btn', type: 'button', text: 'Cancel', on: { click: () => edit(null) } }) : null));
  }

  // ---------- display ----------

  async function save(patch) {
    try { await api('PUT', '/api/settings', patch); toast('Saved'); await refresh(); } catch (e) { fail(e); }
  }

  function renderDisplay() {
    const s = state.settings;
    return h('div', null,
      groupField('Theme', segmented([['dark', 'Dark'], ['light', 'Light']], s.theme, (v) => save({ theme: v }))),
      groupField('Open on', segmented([['week', 'Week'], ['month', 'Month']], s.default_view, (v) => save({ default_view: v }))),
      groupField('Week starts on', segmented([[0, 'Sunday'], [1, 'Monday']], s.week_start, (v) => save({ week_start: v }))),
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: !!s.show_points, on: { change: (ev) => save({ show_points: ev.target.checked }) } }),
        h('span', { text: 'Show points and the weekly scoreboard' })),
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: !!s.match_names, on: { change: (ev) => save({ match_names: ev.target.checked }) } }),
        h('span', { text: 'Color an event by any name in its title' })));
  }

  // ---------- security ----------

  function renderSecurity() {
    const s = state.settings;
    const pin1 = h('input', { type: 'password', inputMode: 'numeric', pattern: '[0-9]*', maxLength: 8, autocomplete: 'new-password' });
    const pin2 = h('input', { type: 'password', inputMode: 'numeric', pattern: '[0-9]*', maxLength: 8, autocomplete: 'new-password' });
    const msg = messageLine();

    async function setPin() {
      if (!/^\d{4,8}$/.test(pin1.value)) { msg.say('Use 4 to 8 digits.', true); return; }
      if (pin1.value !== pin2.value) { msg.say("The two PINs don't match.", true); return; }
      try { await api('POST', '/api/auth/pin', { pin: pin1.value }); toast(s.pin_set ? 'PIN changed' : 'PIN set'); await refresh(); } catch (e) { fail(e); msg.say(e.message, true); }
    }

    async function removePin() {
      if (!confirm('Remove the PIN? Anyone on your network will be able to change settings.')) return;
      try { await api('POST', '/api/auth/pin', { pin: null }); toast('PIN removed'); await refresh(); } catch (e) { fail(e); }
    }

    return h('div', null,
      h('p', {
        class: 'note',
        text: s.pin_set
          ? 'A PIN protects these settings. Chores can still be checked off on the wall display.'
          : 'No PIN is set. Anyone on your network who opens this page can change settings.',
      }),
      h('form', { noValidate: true, on: { submit: (ev) => { ev.preventDefault(); setPin(); } } },
        field(s.pin_set ? 'New PIN (4 to 8 digits)' : 'PIN (4 to 8 digits)', pin1),
        field('Type it again', pin2),
        msg.el,
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', type: 'submit', text: s.pin_set ? 'Change PIN' : 'Set PIN' }),
          s.pin_set ? h('button', { class: 'btn danger', type: 'button', text: 'Remove PIN', on: { click: removePin } }) : null)));
  }

  // ---------- page structure ----------

  const countText = (n, one, many) => n === 0 ? 'None yet' : n + ' ' + (n === 1 ? one : many);

  const SECTIONS = {
    calendars: { title: 'Calendars', meta: () => countText(state.calendars.length, 'calendar', 'calendars'), render: renderCalendars, count: () => state.calendars.length },
    people: { title: 'People', meta: () => countText(state.people.length, 'person', 'people'), render: renderPeople, count: () => state.people.length },
    chores: { title: 'Chores', meta: () => countText(state.chores.length, 'chore', 'chores'), render: renderChores, count: () => state.chores.length },
    display: { title: 'Display', meta: () => '', render: renderDisplay, count: () => 1 },
    security: { title: 'PIN', meta: () => state.settings.pin_set ? 'On' : 'Off', render: renderSecurity, count: () => state.settings.pin_set ? 1 : 0 },
  };
  const MANAGE_ORDER = ['calendars', 'people', 'chores', 'display', 'security'];

  const STEPS = [
    { id: 'people', title: 'Add your household', blurb: 'Everyone who has chores or events, with a color each.' },
    { id: 'calendars', title: 'Link your calendar', blurb: 'Weekslate shows the events from the calendar you already use. You can add more than one, for example one per person.' },
    { id: 'chores', title: 'Add a few chores', blurb: 'They show up on the wall display each day they are due, and anyone can tap to check them off.' },
    { id: 'security', title: 'Protect your settings', blurb: 'A PIN means only adults can change things. Everyone can still check off chores on the wall.' },
  ];

  function manageView() {
    const wrap = h('div');
    wrap.append(h('header', { class: 'head' },
      h('h1', { text: 'Weekslate settings' }),
      h('div', { class: 'head-links' },
        h('a', { class: 'btn small', href: '/', text: 'Back to display' }),
        state.settings.pin_set ? h('button', { class: 'btn small', type: 'button', text: 'Lock', on: { click: lock } }) : null)));

    MANAGE_ORDER.forEach((id) => {
      const sec = SECTIONS[id];
      const d = h('details', { class: 'card' });
      d.open = state.open.has(id);
      d.addEventListener('toggle', () => { if (d.open) state.open.add(id); else state.open.delete(id); });
      d.append(h('summary', null, h('span', { text: sec.title }), h('span', { class: 'meta', text: sec.meta() })));
      d.append(h('div', { class: 'card-body' }, sec.render()));
      wrap.append(d);
    });
    return wrap;
  }

  function wizardView() {
    const step = STEPS[state.step];
    const sec = SECTIONS[step.id];
    const last = state.step === STEPS.length - 1;
    const hasData = sec.count() > 0;

    async function finish() {
      try { await api('PUT', '/api/settings', { setup_complete: true }); location.href = '/'; } catch (e) { fail(e); }
    }

    return h('div', null,
      h('header', { class: 'head' }, h('h1', { text: 'Welcome to Weekslate' })),
      h('p', { class: 'steps', text: 'Step ' + (state.step + 1) + ' of ' + STEPS.length }),
      h('section', { class: 'panel' },
        h('h2', { text: step.title }),
        h('p', { class: 'note', text: step.blurb }),
        sec.render()),
      h('div', { class: 'row end' },
        state.step > 0
          ? h('button', { class: 'btn', type: 'button', text: 'Back', on: { click: () => { state.step--; state.editing = null; render(); window.scrollTo(0, 0); } } })
          : h('span'),
        h('button', {
          class: 'btn' + (hasData ? ' primary' : ''), type: 'button',
          text: hasData ? (last ? 'Finish' : 'Next') : (last ? 'Skip and finish' : 'Skip for now'),
          on: { click: () => { if (last) finish(); else { state.step++; state.editing = null; render(); window.scrollTo(0, 0); } } },
        })));
  }

  function render() {
    const y = window.scrollY;
    root.replaceChildren(state.mode === 'wizard' ? wizardView() : manageView());
    window.scrollTo(0, y);
  }

  // ---------- lock screen ----------

  async function lock() {
    try { await api('POST', '/api/auth/logout'); } catch (_) { /* fall through to the lock screen */ }
    showLock();
  }

  function showLock(message) {
    const pin = h('input', { type: 'password', inputMode: 'numeric', pattern: '[0-9]*', maxLength: 8, autocomplete: 'current-password' });
    const err = h('p', { class: 'err', attrs: { role: 'alert' }, text: message || '' });
    const form = h('form', {
      class: 'lock', noValidate: true,
      on: {
        submit: async (ev) => {
          ev.preventDefault();
          err.textContent = '';
          try {
            const r = await fetch('/api/auth/login', {
              method: 'POST', credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ pin: pin.value }),
            });
            let data = null;
            try { data = await r.json(); } catch (_) { /* empty */ }
            if (!r.ok) { err.textContent = errText(data, r.status); pin.value = ''; pin.focus(); return; }
            await init();
          } catch (_) {
            err.textContent = "Can't reach Weekslate. Check that it's running.";
          }
        },
      },
    },
      h('h1', { text: 'Settings are locked' }),
      h('p', { class: 'note', text: 'Enter the PIN to change settings.' }),
      field('PIN', pin),
      err,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit', text: 'Unlock' }),
        h('a', { class: 'btn', href: '/', text: 'Back to display' })));
    root.replaceChildren(form);
    pin.focus();
  }

  // ---------- start ----------

  async function init() {
    try {
      await loadSettings();
    } catch (e) {
      if (e.status === 401) return;
      root.replaceChildren(h('p', { class: 'err', text: "Can't reach Weekslate. Check that it's running, then reload this page." }));
      return;
    }
    if (state.settings.pin_set && !state.settings.authed) { showLock(); return; }
    try {
      await loadData();
    } catch (e) {
      if (e.status !== 401) root.replaceChildren(h('p', { class: 'err', text: e.message }));
      return;
    }
    state.mode = state.settings.setup_complete ? 'manage' : 'wizard';
    render();
  }

  init();
})();
