(function () {
  'use strict';
  const $ = (id) => document.getElementById(id),
    O = NightSky.Observing;
  const escape = (s) =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  const storage = {
    get(key, fallback) {
      try {
        return JSON.parse(localStorage.getItem('nightsky:' + key)) ?? fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem('nightsky:' + key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
  };
  const state = {
    location: storage.get('location', null),
    date: new Date(),
    tab: 'sky',
    sky: null,
    query: '',
    plan: storage.get('plan', null),
    config: {},
    focus: null,
    request: 0,
    night: false,
  };
  if (!O.validLocation(state.location)) state.location = null;
  if (
    !state.plan ||
    !Array.isArray(state.plan.steps) ||
    !O.validLocation(state.plan.location) ||
    state.plan.steps.some((s) => !s || !O.entries.some((c) => c.key === s.key))
  )
    state.plan = null;
  const formatDate = (date) =>
    new Date(date).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  const timeInput = (date) => {
    const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
  };
  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { ...options.headers, 'X-NightSky-Request': '1' },
      signal: AbortSignal.timeout(path === '/api/plan' ? 95000 : 20000),
    });
    let data;
    try {
      data = await response.json();
    } catch {
      throw Error(
        'The guide service is unavailable. Run NightSky with npm start for connected features.',
      );
    }
    if (!response.ok) throw Error(data.error || 'This service is unavailable. Please try again.');
    return data;
  }
  function message(id, text) {
    $(id).textContent = text;
  }
  function jumpToEvening() {
    const start = new Date();
    if (state.location) {
      for (let hour = 0; hour < 25; hour++) {
        const date = new Date(+start + hour * 3600000);
        if (O.snapshot(state.location, date, false).sun.alt < -12) {
          state.date = date;
          updateSky();
          return;
        }
      }
    }
    state.date = start;
    state.date.setHours(21, 0, 0, 0);
    updateSky();
  }
  function setLocation(location) {
    state.location = location;
    state.request++;
    storage.set('location', location);
    $('locationPanel').hidden = true;
    $('locationToggle').setAttribute('aria-expanded', 'false');
    message('locationMessage', '');
    message('nearbyMessage', '');
    $('nearbyResults').replaceChildren();
    updateSky();
  }
  function toggleLocation(force) {
    const open = typeof force === 'boolean' ? force : $('locationPanel').hidden;
    $('locationPanel').hidden = !open;
    $('locationToggle').setAttribute('aria-expanded', String(open));
    if (open) $('citySearch').focus();
  }
  function updateSky() {
    state.nightScan = state.tab === 'atlas';
    $('observeTime').value = timeInput(state.date);
    $('locationLabel').textContent = state.location?.name || 'Choose your location ↗';
    $('locationEmpty').hidden = !!state.location;
    $('localSkyContent').hidden = !state.location;
    if (state.location) {
      state.sky = O.snapshot(state.location, state.date, state.tab === 'atlas');
      if (state.tab === 'sky') renderChart();
    } else {
      state.sky = null;
    }
    $('catalogSection').hidden = state.tab !== 'atlas';
    renderCatalog();
  }
  function setTab(tab) {
    if (!['sky', 'atlas', 'plan', 'nearby', 'journal', 'settings'].includes(tab)) return;
    $('aiSettings').hidden = tab !== 'settings';
    if (tab === 'settings') $('locationPanel').hidden = true;
    state.tab = tab;
    $('skyGuide').dataset.view = tab;
    document
      .querySelectorAll('.guide-tabs button')
      .forEach((b) => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'));
    $('skySection').hidden = tab !== 'sky';
    $('catalogSection').hidden = tab !== 'atlas';
    $('planSection').hidden = tab !== 'plan';
    $('nearbySection').hidden = tab !== 'nearby';
    $('journalSection').hidden = tab !== 'journal';
    if (tab === 'atlas' && state.sky && !state.nightScan) {
      state.sky = O.snapshot(state.location, state.date);
      state.nightScan = true;
    }
    if (tab === 'sky' && state.sky) renderChart();
    if (tab === 'journal') renderJournal();
    renderCatalog();
    if (tab === 'plan') renderPlan();
  }
  function pattern(entry) {
    return `<img class="mini-pattern" src="${NightSky.Data.getPatternSymbolUrl(entry.key)}" alt="">`;
  }

  function card(entry) {
    const field = NightSky.FieldContent[entry.key],
      bearing = state.sky ? entry.direction + ' · ' + Math.round(entry.alt) + '°' : 'Explore';
    return `<details class="constellation-card" data-key="${entry.key}"><summary><div class="card-top"><div><span class="card-number">${entry.id}</span><h4>${escape(entry.name)}</h4></div>${pattern(entry)}</div><div class="card-status"><span>${state.sky ? { above: 'Above horizon', partial: 'Partly risen', below: 'Below horizon' }[entry.status] : 'Read about this constellation'}</span><b>${bearing} ↗</b></div></summary><div class="card-detail"><p>${escape(field.intro)}</p><h5>STORY & HISTORY</h5><p>${escape(field.story)}</p><p>${escape(field.history)}</p><h5>HOW TO FIND IT</h5><p>${escape(field.recognise)}</p><h5>WHAT YOU CAN SEE</h5><p>${escape(field.see)}</p>${entry.best ? `<p class="fine-print">Best viewing time: ${formatDate(entry.best.date)} · ${Math.round(entry.best.alt)}° ${entry.best.direction}</p>` : ''}<div class="card-actions"><button class="text-button" data-visit="${entry.key}">Read about it ↗</button><button class="text-button" data-log="${entry.key}">+ Log a sighting</button></div></div></details>`;
  }
  function renderCatalog() {
    if (state.tab !== 'atlas') return;
    const all = state.sky?.constellations || O.entries;
    const rows = all.filter((c) =>
      (c.name + ' ' + c.id + ' ' + c.label).toLowerCase().includes(state.query),
    );
    const displayRows = rows.slice(0, state.catalogLimit || 12);
    const openKeys = new Set(
      [...document.querySelectorAll('.constellation-card[open]')].map((el) => el.dataset.key),
    );
    $('constellationCards').innerHTML = rows.length
      ? displayRows.map(card).join('') +
        (rows.length > displayRows.length
          ? '<button class="field-button" id="showMorePatterns">Show more ↓</button>'
          : '')
      : '<div class="quiet-empty"><h3>No matching constellations</h3><p>Try another name.</p></div>';
    document.querySelectorAll('.constellation-card').forEach((el) => {
      if (openKeys.has(el.dataset.key)) el.open = true;
    });
  }
  function renderChart() {
    const sky = state.sky,
      ctx = O.context(state.location, state.date),
      R = 158;
    const project = (p) => {
      const r = (R * (90 - p.alt)) / 90,
        a = (p.az * Math.PI) / 180;
      return [190 - r * Math.sin(a), 190 - r * Math.cos(a)];
    };
    let svg =
      '<svg viewBox="0 0 380 380" role="img" aria-label="Constellation patterns above your local horizon. North at top, east at left."><defs><radialGradient id="skyGlow"><stop stop-color="#193449" stop-opacity=".5"/><stop offset="1" stop-color="#071019"/></radialGradient><clipPath id="horizonClip"><circle cx="190" cy="190" r="158"/></clipPath></defs><circle cx="190" cy="190" r="158" fill="url(#skyGlow)" stroke="#58768e" stroke-width=".8"/>';
    for (const r of [53, 105])
      svg += `<circle cx="190" cy="190" r="${r}" fill="none" stroke="#395164" stroke-width=".6" stroke-dasharray="2 5"/>`;
    svg +=
      '<path d="M32 190H348M190 32V348" stroke="#365064" stroke-width=".5"/><g clip-path="url(#horizonClip)">';
    for (const entry of sky.constellations.filter((c) => c.status !== 'below')) {
      svg += `<g data-sky-key="${entry.key}" role="button" tabindex="0" aria-label="Read about ${escape(entry.name)}">`;
      for (const line of entry.lines) {
        const points = line.map((p) => O.horizontal(p, ctx));
        for (let i = 1; i < points.length; i++)
          if (points[i - 1].alt >= 0 && points[i].alt >= 0) {
            const p = project(points[i - 1]),
              q = project(points[i]);
            svg += `<path d="M${p.join(' ')}L${q.join(' ')}" stroke="#789fb9" opacity=".4" fill="none" stroke-width=".65"/>`;
          }
      }
      for (const point of entry.points) {
        if (point.alt < 0) continue;
        const [x, y] = project(point);
        svg += `<circle cx="${x}" cy="${y}" r="1.3" fill="#d9e9f7"/>`;
      }
      svg += '</g>';
    }
    const labels = [];
    for (const entry of [...sky.constellations]
      .filter((c) => c.alt > 12)
      .sort((a, b) => b.score - a.score)) {
      const [x, y] = project(entry);
      if (labels.some((p) => Math.hypot(p[0] - x, p[1] - y) < 40)) continue;
      labels.push([x, y]);
      if (labels.length <= 9)
        svg += `<text x="${x}" y="${y - 7}" text-anchor="middle" fill="#a9c4dc" font-family="Manrope,sans-serif" font-size="8">${escape(entry.name)}</text>`;
    }
    if (sky.moon.alt > 0) {
      const [x, y] = project(sky.moon);
      svg += `<circle cx="${x}" cy="${y}" r="4" fill="#ede4c7"/><text x="${x + 8}" y="${y + 3}" fill="#ede4c7" font-size="8">Moon</text>`;
    }
    svg +=
      '</g><g fill="#abc5dc" font-family="Manrope,sans-serif" font-size="11" text-anchor="middle"><text x="190" y="20">N</text><text x="190" y="371">S</text><text x="15" y="194">E</text><text x="365" y="194">W</text></g><circle cx="190" cy="190" r="2" fill="#d5e4f0"/></svg>';
    $('localSkyChart').innerHTML = svg;
  }

  function planOptions() {
    return {
      minutes: Number($('planDuration').value),
      equipment: $('planEquipment').value,
      direction: $('planDirection').value,
      target: state.planTarget || '',
    };
  }
  function buildPlan() {
    if (!state.sky) {
      message('planMessage', 'Choose a location first.');
      toggleLocation(true);
      return false;
    }
    state.plan = O.fieldPlan(state.sky, planOptions());
    renderPlan();
    message('planMessage', '');
    return true;
  }
  function renderPlan() {
    if (!state.plan) return;
    const p = state.plan;
    $('planOutput').innerHTML =
      `<div class="plan-cover"><span class="field-eyebrow">${escape(p.source)} · ${escape(p.minutes)} MINUTES</span><h4>${escape(p.location.name || 'Your observing location')}</h4><p>${formatDate(p.date)} · device timezone · ${escape(p.introduction)}</p></div>${p.steps.map((s, i) => `<article class="plan-step"><span>${String(i + 1).padStart(2, '0')}</span><div><h4>${escape(s.name)}</h4><p>${escape(s.instruction)}</p><p class="plan-task">${escape(s.task)}</p><button class="text-button" data-plan-card="${escape(s.key)}">View constellation ↗</button></div><div class="plan-bearing">${escape(s.direction)} · ${escape(s.alt)}°<small>above the horizon</small></div></article>`).join('')}`;
    $('planActions').hidden = !p.steps.length;
    if (p.place) {
      const note = document.createElement('p');
      note.className = 'plan-task';
      const link = document.createElement('a');
      link.href = safeUrl(p.place.url);
      link.textContent = p.place.title;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      note.append('Nearby: ', link, '. Check night access with the venue.');
      $('planOutput').append(note);
    }
  }
  function planText() {
    const p = state.plan;
    return (
      `NIGHTSKY — FIELD NOTES\n${p.location.name || 'Observing location'} (${p.location.lat.toFixed(3)}, ${p.location.lon.toFixed(3)})\n${formatDate(p.date)} — device timezone\n${p.source} · ${p.minutes} minutes\n\n${p.introduction}\n\n` +
      p.steps
        .map(
          (s, i) =>
            `${i + 1}. ${s.name} — ${s.direction}, ${s.alt}° above horizon\n${s.instruction}\n${s.task}`,
        )
        .join('\n\n') +
      (p.place
        ? `\n\nNearby: ${p.place.title}\n${p.place.url}\nCheck night access with the venue.`
        : '') +
      '\n\nPositions are for the saved time. Check local conditions and evening access before going out.\n'
    );
  }
  function open(tab = 'sky') {
    state.focus = document.activeElement;
    state.tab = tab;
    $('skyGuide').hidden = false;
    document.body.classList.add('guide-open');
    for (const el of document.body.children)
      if (el !== $('skyGuide') && el.tagName !== 'SCRIPT') {
        if (!el.inert) {
          el.inert = true;
          el.dataset.guideInert = 'true';
        }
      }
    NightSky.App?.setPaused(true);
    updateSky();
    setTab(tab);
    NightSky.GuideStars.open();
    $('skyGuide').scrollTop = 0;
    $('guideClose').focus();
  }
  function close() {
    NightSky.GuideStars.close();
    $('skyGuide').hidden = true;
    document.body.classList.remove('guide-open');
    document.querySelectorAll('[data-guide-inert]').forEach((el) => {
      el.inert = false;
      delete el.dataset.guideInert;
    });
    NightSky.App?.setPaused(false);
    window.speechSynthesis?.cancel();
    state.focus?.focus();
  }
  function visit(keys, key) {
    close();
    NightSky.App.setAtlasFilter(keys);
    NightSky.App.enterAtlas(key);
    if (key)
      NightSky.App.readingOverlay.open(
        NightSky.Data.CONSTELLATIONS.findIndex((c) => c.key === key),
        NightSky.App.state.reduced,
      );
  }
  function safeUrl(value) {
    try {
      const u = new URL(value);
      return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : '';
    } catch {
      return '';
    }
  }
  async function nearby(kind, button) {
    if (!state.location) {
      message('nearbyMessage', 'Choose your observing location first.');
      toggleLocation(true);
      return;
    }
    document.querySelectorAll('.nearby-controls button').forEach((b) => {
      b.classList.toggle('primary', b === button);
      b.setAttribute('aria-pressed', String(b === button));
    });
    const request = ++state.request;
    button.disabled = true;
    message(
      'nearbyMessage',
      kind === 'events' ? 'Looking for public astronomy events…' : 'Looking for observing places…',
    );
    try {
      const result = await api('/api/places?' + new URLSearchParams({ ...state.location, kind }));
      if (request !== state.request) return;
      message(
        'nearbyMessage',
        `${result.results.length} results · searched ${formatDate(result.retrievedAt)}. Verify dates and evening access with the organiser.`,
      );
      $('nearbyResults').innerHTML = result.results.length
        ? result.results
            .map(
              (p) =>
                `<article class="place-card"><p class="field-eyebrow">${kind === 'events' ? 'ASTRONOMY SEARCH' : 'OBSERVING PLACE'}</p><h4>${escape(p.title)}</h4><p>${escape(p.address)}</p><p class="fine-print">${escape(p.hours)} · Darkness and night access are not verified.</p>${safeUrl(p.url) ? `<a class="text-button" href="${escape(safeUrl(p.url))}" target="_blank" rel="noopener">Check details ↗</a>` : ''}${Number.isFinite(p.lat) && Number.isFinite(p.lon) ? `<button class="text-button" data-site-lat="${p.lat}" data-site-lon="${p.lon}" data-site-name="${escape(p.title)}">Show the sky here ↗</button>` : ''}</article>`,
            )
            .join('')
        : '<div class="quiet-empty"><h3>No places found this time.</h3><p>Try another nearby town, or plan from your own observing spot.</p></div>';
    } catch (e) {
      if (request === state.request) message('nearbyMessage', e.message);
    } finally {
      button.disabled = false;
    }
  }
  let journal = storage.get('journal', []);
  journal = Array.isArray(journal)
    ? journal.filter(
        (n) =>
          n &&
          typeof n.id === 'string' &&
          typeof n.date === 'string' &&
          Number.isFinite(new Date(n.date).getTime()) &&
          O.entries.some((c) => c.key === n.key),
      )
    : [];
  const savedProvider = storage.get('provider', {});
  let provider = {
    provider: savedProvider?.provider === 'ollama' ? 'ollama' : 'google',
    url: typeof savedProvider?.url === 'string' ? savedProvider.url : 'http://localhost:11434',
    model: typeof savedProvider?.model === 'string' ? savedProvider.model : 'gemma4',
  };
  function renderJournal() {
    $('journalCount').textContent = journal.length;
    $('journalEntries').innerHTML = journal.length
      ? [...journal]
          .sort((a, b) => b.date.localeCompare(a.date))
          .map((n) => {
            const c = O.entries.find((c) => c.key === n.key);
            return `<article class="journal-entry"><p class="field-eyebrow">${escape(n.status === 'found' ? 'FOUND IT' : n.status === 'partial' ? 'PARTLY FOUND' : 'ANOTHER NIGHT')} · ${formatDate(n.date)}</p><h4>${escape(c?.name || n.key)}</h4><p>${escape(n.text || 'No notes added.')}</p><div class="card-actions"><button class="text-button" data-edit-note="${escape(n.id)}">Edit</button><button class="text-button" data-delete-note="${escape(n.id)}">Delete</button></div></article>`;
          })
          .join('')
      : '<div class="quiet-empty"><span>✧</span><h3>No observations yet</h3><p>Add a constellation you observed.</p></div>';
  }
  function editNote(key = '', id = '') {
    setTab('journal');
    const n = journal.find((n) => n.id === id);
    $('noteConstellation').innerHTML = O.entries
      .map((c) => `<option value="${c.key}">${escape(c.name)}</option>`)
      .join('');
    $('noteId').value = n?.id || '';
    $('noteConstellation').value = n?.key || key || O.entries[0].key;
    $('noteDate').value = timeInput(n ? new Date(n.date) : state.date);
    $('noteStatus').value = n?.status || 'found';
    $('noteText').value = n?.text || '';
    $('noteEditor').hidden = false;
    $('noteConstellation').focus();
  }
  function saveNote(e) {
    e.preventDefault();
    const date = new Date($('noteDate').value);
    if (!Number.isFinite(date.getTime())) return;
    const n = {
      id: $('noteId').value || crypto.randomUUID(),
      key: $('noteConstellation').value,
      date: date.toISOString(),
      status: $('noteStatus').value,
      text: $('noteText').value.trim(),
    };
    journal = journal.filter((v) => v.id !== n.id);
    journal.push(n);
    const saved = storage.set('journal', journal);
    message(
      'noteMessage',
      saved
        ? 'Observation saved on this device.'
        : 'Storage unavailable. Keep this page open to retain your note.',
    );
    $('noteEditor').hidden = true;
    renderJournal();
  }
  function setupSettings() {
    $('aiProvider').value = provider.provider;
    $('ollamaUrl').value = provider.url;
    $('ollamaModel').value = provider.model;
    const change = () => {
      provider = {
        provider: $('aiProvider').value,
        url: $('ollamaUrl').value.trim(),
        model: $('ollamaModel').value.trim(),
      };
      storage.set('provider', provider);
      $('ollamaSettings').hidden = provider.provider !== 'ollama';
      $('providerHint').textContent =
        provider.provider === 'google'
          ? 'Gemma uses the app’s server connection. No API key needed here.'
          : 'Requests go directly to your Ollama endpoint. Choose an installed model that can return JSON.';
      $('personalisePlan').textContent =
        provider.provider === 'google' ? 'Personalise with Gemma ✧' : 'Personalise with my model ✧';
      updateModelStatus();
    };
    change();
    ['aiProvider', 'ollamaUrl', 'ollamaModel'].forEach((id) =>
      $(id).addEventListener('change', change),
    );
    $('planModelSettings').onclick = () => {
      setTab('settings');
      $('aiProvider').focus();
    };
    $('testOllama').onclick = async () => {
      change();
      const button = $('testOllama');
      button.disabled = true;
      message('ollamaMessage', 'Checking connection…');
      try {
        const models = await NightSky.ModelClient.models(modelConfig());
        $('installedModels').innerHTML = models
          .map((name) => `<option value="${escape(name)}"></option>`)
          .join('');
        message(
          'ollamaMessage',
          models.includes(provider.model)
            ? 'Connected. This model is available.'
            : models.length
              ? 'Available models: ' + models.join(', ')
              : 'Connected, but no models are installed.',
        );
      } catch (e) {
        message('ollamaMessage', e.message);
      } finally {
        button.disabled = false;
      }
    };
  }
  function modelConfig() {
    return { provider: 'ollama', url: provider.url, model: provider.model };
  }
  function updateModelStatus() {
    $('gemmaStatus').textContent =
      provider.provider === 'google'
        ? state.config.gemma
          ? 'Using the app’s Gemma connection'
          : 'Gemma is unavailable. You can use Ollama in Settings.'
        : provider.model
          ? 'Using ' + provider.model
          : 'Choose your model in Settings';
  }
  async function personalisePlan() {
    if (!buildPlan() || !state.plan.steps.length) return;
    const button = $('personalisePlan'),
      context = state.sky.date + JSON.stringify(state.location);
    button.disabled = true;
    message('planMessage', 'Preparing your observing guide…');
    try {
      const plan =
        provider.provider === 'google'
          ? await api('/api/plan', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                location: state.location,
                date: state.date.toISOString(),
                ...planOptions(),
              }),
            })
          : await NightSky.ModelClient.generate(state.plan, modelConfig(), planOptions().equipment);
      if (context !== state.sky.date + JSON.stringify(state.location)) {
        message('planMessage', 'Your location or time changed. Create a fresh plan.');
        return;
      }
      state.plan = plan;
      renderPlan();
      message('planMessage', 'Your personalised guide is ready.');
    } catch (e) {
      message('planMessage', e.message);
    } finally {
      button.disabled = false;
    }
  }
  function init() {
    ['buildPlan', 'newNote'].forEach((id) => NightSky.ReadingView?.ButtonGlow.attach($(id)));
    $('touchGrass').addEventListener('click', () => window.close());
    $('constellationCards').addEventListener(
      'toggle',
      (e) => {
        if (e.target.open)
          document.querySelectorAll('.constellation-card[open]').forEach((card) => {
            if (card !== e.target) card.open = false;
          });
      },
      true,
    );
    $('guideBtn').addEventListener('click', () => open());
    $('heroGuide')?.addEventListener('click', () => open());
    $('guideClose').addEventListener('click', close);
    $('guideHome').addEventListener('click', (e) => {
      e.preventDefault();
      close();
    });
    $('locationToggle').addEventListener('click', () => toggleLocation());
    $('chooseLocation').addEventListener('click', () => toggleLocation(true));
    $('skyGuide').addEventListener('click', (e) => {
      if (e.target.closest('#showMorePatterns')) {
        state.catalogLimit = (state.catalogLimit || 12) + 12;
        renderCatalog();
      }
      const tab = e.target.closest('[data-tab]');
      if (tab) setTab(tab.dataset.tab);
      const skyTarget = e.target.closest('[data-sky-key]');
      if (skyTarget) visit(null, skyTarget.dataset.skyKey);
      const log = e.target.closest('[data-log]');
      if (log) editNote(log.dataset.log);
      const edit = e.target.closest('[data-edit-note]');
      if (edit) editNote('', edit.dataset.editNote);
      const del = e.target.closest('[data-delete-note]');
      if (del) {
        journal = journal.filter((n) => n.id !== del.dataset.deleteNote);
        storage.set('journal', journal);
        renderJournal();
      }
      const visitBtn = e.target.closest('[data-visit]');
      if (visitBtn) visit(null, visitBtn.dataset.visit);
      const patternBtn = e.target.closest('[data-plan-card]');
      if (patternBtn) {
        const key = patternBtn.dataset.planCard;
        $('constellationSearch').value = '';
        state.query = '';
        state.catalogLimit = Math.max(
          state.catalogLimit || 12,
          O.entries.findIndex((c) => c.key === key) + 1,
        );
        setTab('atlas');
        const card = document.querySelector(`[data-key="${key}"]`);
        if (!card) return;
        card.open = true;
        card.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
      const site = e.target.closest('[data-site-lat]');
      if (site) {
        setLocation({
          lat: Number(site.dataset.siteLat),
          lon: Number(site.dataset.siteLon),
          name: site.dataset.siteName,
        });
        setTab('sky');
        $('skyGuide').scrollTop = 0;
      }
      e.stopPropagation();
    });
    for (const event of ['pointerdown', 'pointerup', 'wheel'])
      $('skyGuide').addEventListener(event, (e) => e.stopPropagation());
    $('skyGuide').addEventListener('keydown', (e) => {
      e.stopPropagation();
      const skyTarget = e.target.closest('[data-sky-key]');
      if (skyTarget && ['Enter', ' '].includes(e.key)) {
        e.preventDefault();
        visit(null, skyTarget.dataset.skyKey);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
      if (e.key === 'Tab') {
        const items = [
          ...$('skyGuide').querySelectorAll(
            'button:not(:disabled),a[href],input,select,textarea,summary',
          ),
        ].filter((el) => el.getClientRects().length);
        const first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });
    $('useLocation').addEventListener('click', () => {
      if (!navigator.geolocation) {
        message('locationMessage', 'Location is unavailable. Search a city or enter coordinates.');
        return;
      }
      $('useLocation').disabled = true;
      message('locationMessage', 'Waiting for your location…');
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude, name: 'My location' });
          $('useLocation').disabled = false;
        },
        () => {
          message(
            'locationMessage',
            'Location could not be obtained. Search a city or enter coordinates instead.',
          );
          $('useLocation').disabled = false;
        },
        { timeout: 12000, maximumAge: 300000 },
      );
    });
    $('cityForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const button = e.submitter;
      button.disabled = true;
      message('locationMessage', 'Finding your city…');
      try {
        const result = await api('/api/geocode?q=' + encodeURIComponent($('citySearch').value));
        $('cityResults').replaceChildren();
        for (const loc of result.results) {
          const btn = document.createElement('button');
          btn.textContent = loc.name;
          btn.addEventListener('click', () => setLocation(loc));
          $('cityResults').append(btn);
        }
        message(
          'locationMessage',
          result.results.length
            ? 'Choose your city from the results.'
            : 'No cities found. Try a nearby town or enter coordinates.',
        );
      } catch (err) {
        message('locationMessage', err.message);
      } finally {
        button.disabled = false;
      }
    });
    $('coordinateForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const lat = Number($('latitude').value),
        lon = Number($('longitude').value);
      if (O.validLocation({ lat, lon }))
        setLocation({
          lat,
          lon,
          name: `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? 'E' : 'W'}`,
        });
    });
    $('observeTime').value = timeInput(state.date);
    $('observeTime').addEventListener('change', () => {
      const date = new Date($('observeTime').value);
      if (!Number.isFinite(date.getTime()) || !$('observeTime').checkValidity()) {
        message('guideMessage', 'Choose a valid date between 2000 and 2100.');
        return;
      }
      state.date = date;
      message('guideMessage', '');
      updateSky();
    });
    $('timeNow').addEventListener('click', () => {
      state.date = new Date();
      updateSky();
    });
    $('constellationSearch').addEventListener('input', (e) => {
      state.query = e.target.value.trim().toLowerCase();
      state.catalogLimit = 12;
      renderCatalog();
    });
    $('nightMode').addEventListener('click', () => {
      state.night = !state.night;
      $('skyGuide').classList.toggle('night-light', state.night);
      $('nightMode').setAttribute('aria-pressed', String(state.night));
    });
    $('buildPlan').addEventListener('click', buildPlan);
    $('personalisePlan').addEventListener('click', personalisePlan);
    $('savePlan').addEventListener('click', () =>
      message(
        'planMessage',
        storage.set('plan', state.plan)
          ? 'Saved on this device. Download a copy to take outside.'
          : 'Storage is unavailable. Download your field notes instead.',
      ),
    );
    $('downloadPlan').addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([planText()], { type: 'text/plain;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'nightsky-field-notes.txt';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    $('listenPlan').addEventListener('click', () => {
      if (!window.speechSynthesis) {
        message('planMessage', 'Voice is unavailable in this browser.');
        return;
      }
      if (speechSynthesis.speaking) {
        speechSynthesis.cancel();
        $('listenPlan').textContent = 'Listen to the plan ▷';
        return;
      }
      const u = new SpeechSynthesisUtterance(planText());
      u.rate = 0.85;
      u.onend = u.onerror = () => {
        $('listenPlan').textContent = 'Listen to the plan ▷';
      };
      speechSynthesis.speak(u);
      $('listenPlan').textContent = 'Stop listening □';
    });
    $('findPlaces').addEventListener('click', (e) => nearby('places', e.currentTarget));
    $('findEvents').addEventListener('click', (e) => nearby('events', e.currentTarget));
    api('/api/config')
      .then((config) => {
        state.config = config;
        updateModelStatus();
      })
      .catch(() =>
        message('gemmaStatus', 'Calculated plans work. Google AI Studio needs npm start.'),
      );
    setupSettings();
    renderJournal();
    $('newNote').onclick = () => editNote();
    $('cancelNote').onclick = () => {
      $('noteEditor').hidden = true;
    };
    $('noteEditor').onsubmit = saveNote;
    $('timeTonight').onclick = jumpToEvening;
    $('clearPlanTarget').onclick = () => {
      state.planTarget = '';
      $('planTarget').hidden = true;
      buildPlan();
    };
    function observe(key) {
      const target = O.entries.find((c) => c.key === key);
      if (!target) return;
      state.planTarget = key;
      $('planTargetName').textContent = 'Planning for ' + target.name;
      $('planTarget').hidden = false;
      $('planDirection').value = '';
      open('plan');
      buildPlan();
    }
    NightSky.Guide = { open, close, observe, state };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
