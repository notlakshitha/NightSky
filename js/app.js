(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('./core/math.js'),
      require('./data/constellations.js'),
      require('./audio/sound-engine.js'),
      require('./render/sky-renderer.js'),
      require('./render/reading-view.js'),
    );
  } else {
    root.NightSky = root.NightSky || {};
    root.NightSky.App = factory(
      root.NightSky.Math,
      root.NightSky.Data,
      root.NightSky.Audio,
      root.NightSky.Renderer,
      root.NightSky.ReadingView,
    );
  }
})(
  typeof globalThis !== 'undefined' ? globalThis : window,
  function (MathUtils, DataUtils, SoundEngine, RendererModule, ReadingViewModule) {
    'use strict';

    const clamp = MathUtils.clamp;
    const lerp = MathUtils.lerp;
    const easeOutCubic = MathUtils.easeOutCubic;
    const resolveAsset = MathUtils.resolveAsset;

    const CONSTELLATIONS = DataUtils.CONSTELLATIONS;
    const WORLD_BOUNDS = DataUtils.WORLD_BOUNDS;

    const SkyRenderer = RendererModule.SkyRenderer;
    const ButtonGlow = ReadingViewModule.ButtonGlow;
    const createParticleSwirlEngine = ReadingViewModule.createParticleSwirlEngine;
    const createIntroController = ReadingViewModule.createIntroController;
    const ReadingOverlay = ReadingViewModule.ReadingOverlay;

    const $ = (selector) =>
      typeof document !== 'undefined' ? document.querySelector(selector) : null;

    let hintEl = null;
    let panelEl = null;
    let menuEl = null;
    let menuInnerEl = null;
    let mottoEl = null;
    let menuBtn = null;
    let closeBtn = null;
    let introEl = null;
    let loadingEl = null;
    let heroEl = null;
    let crestWrapEl = null;
    let a11yEl = null;

    function queryDOMElements() {
      if (typeof document === 'undefined') return;
      hintEl = $('#hint');
      panelEl = $('#panel');
      menuEl = $('#menu');
      menuInnerEl = $('#menuInner');
      mottoEl = $('#motto');
      menuBtn = $('#menuBtn');
      closeBtn = $('#closeBtn');
      introEl = $('#intro');
      loadingEl = $('#loading');
      heroEl = $('#hero');
      crestWrapEl = $('#crestWrap');
      a11yEl = $('#a11y');
    }

    const MENU_ITEM_HEIGHT = 117;
    const waitMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const constellationInstances = CONSTELLATIONS.map((item, index) => {
      const x = 1800 + 980 * index;
      const y =
        6200 - 80 * index + 920 * Math.sin(1.15 * index + 0.3) + 280 * Math.cos(0.72 * index);
      return {
        ...item,
        x: x,
        y: y,
        figKey: item.fig,
        fig: null,
        scale: 240 + ((7 * index) % 5) * 22,
        seen: false,
      };
    });
    const allConstellationInstances = [...constellationInstances];

    function setAtlasFilter(keys) {
      const selected = state.active >= 0 ? constellationInstances[state.active]?.key : null;
      const allowed = keys ? new Set(keys) : null;
      const next = allConstellationInstances.filter((c) => !allowed || allowed.has(c.key));
      if (!next.length) return false;
      if (state.mode === 'detail') closeDetail();
      if (state.mode === 'menu') closeMenu();
      constellationInstances.splice(0, constellationInstances.length, ...next);
      state.nav = state.navT = Math.max(
        0,
        next.findIndex((c) => c.key === selected),
      );
      state.active = state.hot = -1;
      state.menuT = state.menuF = state.nav;
      state.mottoIdx = -1;
      if (typeof document !== 'undefined') {
        initMenu();
        $('#hintTxt').textContent = 'Scroll to explore';
        let badge = $('#atlasFilterBadge');
        if (!badge) {
          badge = document.createElement('button');
          badge.id = 'atlasFilterBadge';
          badge.className = 'atlas-filter-badge';
          badge.addEventListener('click', () => setAtlasFilter(null));
          document.body.appendChild(badge);
        }
        badge.hidden = next.length === 88;
        badge.textContent = `${next.length} patterns in this view · Show all 88`;
      }
      return true;
    }

    function enterAtlas(key) {
      if (introController) introController.stop();
      document.body.classList.remove('introdark');
      introEl.classList.add('hid');
      state.mode = 'map';
      state.paused = false;
      setPhase('map');
      hintEl.classList.remove('off');
      const index = key
        ? constellationInstances.findIndex((c) => c.key === key)
        : Math.round(state.nav);
      if (index >= 0) {
        state.nav = state.navT = index;
        state.cam.x = constellationInstances[index].x;
        state.cam.y = constellationInstances[index].y;
        if (key) selectConstellation(index, true);
      }
    }

    if (constellationInstances.length > 0) {
      WORLD_BOUNDS.w = constellationInstances[constellationInstances.length - 1].x + 2400;
      WORLD_BOUNDS.h = 9000;
    }

    const initialCameraPos = {
      x: constellationInstances[0].x - 2300,
      y: constellationInstances[0].y - 2500,
    };

    const state = {
      mode: 'loading',
      nav: 0,
      navT: 0,
      cam: { x: initialCameraPos.x, y: initialCameraPos.y, z: 1 },
      camT: { x: initialCameraPos.x, y: initialCameraPos.y, z: 1 },
      hot: -1,
      active: -1,
      menuF: 0,
      menuT: 0,
      ring: 0,
      ringT: 0,
      heroRing: 0,
      crest: 0,
      vel: 0,
      velx: 0,
      vely: 0,
      warp: 0,
      t: 0,
      dt: 0,
      pointer: {
        x: typeof window !== 'undefined' ? window.innerWidth / 2 : 0,
        y: typeof window !== 'undefined' ? window.innerHeight / 2 : 0,
        down: false,
        moved: 0,
        sx: 0,
        sy: 0,
        nav0: 0,
      },
      reduced:
        typeof window !== 'undefined' &&
        window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      paused: false,
      lastMode: '',
      mottoIdx: -1,
      overUI: false,
      transit: false,
      transitTimer: null,
      mottoTimer: null,
    };

    const skyRenderer = new SkyRenderer();
    const readingOverlay = new ReadingOverlay();
    let swirlEngine = null;
    let introController = null;

    let menuItems = [];
    let railMarks = [];
    let railInitialized = false;

    function interpolateCameraPath(t) {
      const count = constellationInstances.length;
      const i = clamp(Math.floor(t), 0, count - 1);
      const frac = clamp(t - i, 0, 1);
      const getInst = (idx) => constellationInstances[clamp(idx, 0, count - 1)];

      const p0 = getInst(i - 1);
      const p1 = getInst(i);
      const p2 = getInst(i + 1);
      const p3 = getInst(i + 2);

      const f2 = frac * frac;
      const f3 = f2 * frac;

      return {
        x:
          0.5 *
          (2 * p1.x +
            (-p0.x + p2.x) * frac +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * f2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * f3),
        y:
          0.5 *
          (2 * p1.y +
            (-p0.y + p2.y) * frac +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * f2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * f3),
      };
    }

    const wrapIndex = (idx) => {
      const total = constellationInstances.length;
      return ((Math.round(idx) % total) + total) % total;
    };

    const targetMenuOffset = (target) => {
      const total = constellationInstances.length;
      return target + Math.round((state.menuT - target) / total) * total;
    };

    function updateCursor() {
      if (state.mode === 'map' && state.hot >= 0) {
        document.body.dataset.cursor = 'hot';
      } else if (state.mode === 'detail' && !state.overUI) {
        document.body.dataset.cursor = 'close';
      } else {
        document.body.dataset.cursor = '';
      }
    }

    function setPhase(phase) {
      if (typeof document === 'undefined') return;
      document.body.className =
        document.body.className.replace(/\bphase-\w+/g, '').trim() + ' phase-' + phase;
      if (phase === 'map' || phase === 'detail') {
        document.body.classList.remove('introdark');
      }
    }

    function animateTween(duration, onUpdate, easingFn) {
      return new Promise((resolve) => {
        const start = performance.now();
        function frame(time) {
          const progress = clamp((time - start) / duration, 0, 1);
          onUpdate(easingFn ? easingFn(progress) : progress);
          if (progress < 1) {
            requestAnimationFrame(frame);
          } else {
            resolve();
          }
        }
        requestAnimationFrame(frame);
      });
    }

    function initRail() {
      const railSvg = $('#railSvg');
      if (!railSvg) return;
      railSvg.innerHTML = `
            <g stroke="rgba(169,196,220,.42)" fill="none" stroke-width="1">
                <path d="M2,120 L27.5,262 L53,120" opacity=".34"/>
                <path d="M53,96 L27.5,-46 L2,96" opacity=".34"/>
                <rect x="4.5" y="4.5" width="46" height="207" rx="23"/>
            </g>
            <line id="rlLine" x1="27.5" y1="42" x2="27.5" y2="174" stroke="rgba(169,196,220,.85)" stroke-width="1.2"/>
            <g id="rlMarks" fill="#fff"></g>
        `;
      const marksGroup = railSvg.querySelector('#rlMarks');
      railMarks = [];
      for (let i = 0; i < 3; i++) {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('transform', `translate(27.5, ${68 + 40 * i})`);
        g.innerHTML =
          '<path class="s" d="M0,-6.4 Q1,-1 6.4,0 Q1,1 0,6.4 Q-1,1 -6.4,0 Q-1,-1 0,-6.4 Z"/><circle class="o" r="4.6" fill="none" stroke="#fff" stroke-width="1.1"/>';
        marksGroup.appendChild(g);
        railMarks.push(g);
      }
      railInitialized = true;
    }

    function updateRail() {
      if (!railInitialized) return;
      const total = constellationInstances.length;
      const currentNav = state.mode === 'menu' ? state.menuF : state.nav;
      const index = ((Math.round(currentNav) % total) + total) % total;
      const offset = currentNav - Math.round(currentNav);

      railMarks.forEach((mark, i) => {
        const isCenter = i === 1;
        mark.querySelector('.s').style.opacity = isCenter ? 0 : 0.92;
        mark.querySelector('.o').style.opacity = isCenter && state.active < 0 ? 0.92 : 0;
        mark.setAttribute('transform', `translate(27.5, ${68 + 40 * i - 40 * offset})`);
      });

      const railLine = $('#rlLine');
      if (railLine) {
        railLine.setAttribute(
          'stroke',
          `rgba(169,196,220,${(0.55 + 0.35 * Math.sin(0.9 * state.t)).toFixed(3)})`,
        );
      }
    }

    function initMenu() {
      if (!menuInnerEl) return;
      menuInnerEl.innerHTML = '';
      menuItems = constellationInstances.map((item, idx) => {
        const li = document.createElement('li');
        li.innerHTML = `<span class="txt" tabindex="0" role="link">${item.l1}</span>`;
        li.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            state.menuT = targetMenuOffset(idx);
            selectConstellation(idx, true);
          }
        });
        li.addEventListener('pointerup', (e) => {
          if (!e.target.closest('.txt')) return;
          if (state.pointer.moved > 6 || e.button !== 0) return;
          e.stopPropagation();
          state.menuT = targetMenuOffset(idx);
          selectConstellation(idx, true);
        });
        li.addEventListener('click', (e) => {
          if (e.target.closest('.txt')) e.stopPropagation();
        });
        menuInnerEl.appendChild(li);
        return li;
      });
    }

    function updateMenuWheel() {
      const total = constellationInstances.length;
      for (let i = 0; i < total; i++) {
        let offset = i - state.menuF;
        offset = ((((offset + total / 2) % total) + total) % total) - total / 2;
        const dist = Math.abs(offset);
        const el = menuItems[i];
        el.style.transform = `translateY(${(offset * MENU_ITEM_HEIGHT).toFixed(2)}px) scale(${(1 - 0.018 * Math.min(dist, 3)).toFixed(3)})`;
        el.style.opacity = clamp(1 - 0.33 * dist, 0, 1).toFixed(3);
        el.style.filter =
          dist > 1.5 ? `blur(${Math.min(3.2, 1.15 * (dist - 1.5)).toFixed(2)}px)` : 'none';
        el.style.pointerEvents = dist > 4.4 ? 'none' : 'auto';
        el.style.zIndex = String(20 - Math.round(dist));
      }

      const curIdx = ((Math.round(state.nav) % total) + total) % total;
      if (curIdx !== state.mottoIdx) {
        state.mottoIdx = curIdx;
        mottoEl.style.opacity = 0;
        clearTimeout(state.mottoTimer);
        state.mottoTimer = setTimeout(() => {
          mottoEl.textContent = constellationInstances[curIdx].motto;
          mottoEl.style.opacity = 1;
        }, 260);
      }
    }

    function openMenu() {
      if (state.mode === 'detail') closeDetail(true);
      state.mode = 'menu';
      state.menuT = state.menuF = targetMenuOffset(
        Math.round(state.nav) % constellationInstances.length,
      );
      menuEl.classList.add('on');
      $('#rail').classList.add('hide');
      menuBtn.classList.add('off');
      menuBtn.setAttribute('aria-expanded', 'true');
      closeBtn.classList.add('on');
      mottoEl.textContent = constellationInstances[wrapIndex(state.nav)].motto;
      updateMenuWheel();
    }

    function closeMenu() {
      if (state.mode !== 'menu') return;
      state.mode = 'map';
      menuEl.classList.remove('on');
      $('#rail').classList.remove('hide');
      menuBtn.classList.remove('off');
      menuBtn.setAttribute('aria-expanded', 'false');
      closeBtn.classList.remove('on');
      state.navT = wrapIndex(state.menuF);
    }

    function selectConstellation(index, instant) {
      const item = constellationInstances[index];
      if (!item) return;

      if (instant) {
        menuEl.classList.remove('on');
        $('#rail').classList.remove('hide');
      }

      state.active = index;
      state.mode = 'detail';
      state.transit = true;
      clearTimeout(state.transitTimer);
      state.transitTimer = setTimeout(() => {
        state.transit = false;
      }, 1350);

      state.navT = index;
      state.nav = instant ? index : state.nav;
      item.seen = true;

      $('#pT1').textContent = item.l1;
      $('#pT2').textContent = item.tag || item.l2 || '';
      $('#pT2').style.display = item.tag || item.l2 ? 'block' : 'none';
      $('#pBody').textContent = item.short || '';

      const glyphUrl = DataUtils.getPatternSymbolUrl(item.key);

      $('#pGlyph').src = glyphUrl;
      $('#railSym').src = glyphUrl;
      $('#pMottoTxt').textContent = '';

      panelEl.classList.add('on');
      document.body.classList.add('sign-on');
      panelEl.style.opacity = 1;

      hintEl.classList.add('off');
      menuBtn.classList.add('off');
      closeBtn.classList.add('on');
      a11yEl.textContent = `${item.l1}, ${item.tag}. ${item.short}`;

      if (SoundEngine && SoundEngine.playConstellationChime) {
        SoundEngine.playConstellationChime();
      }

      try {
        history.replaceState(null, '', '#' + item.key);
      } catch (_) {}
    }

    function closeDetail(skipModeChange) {
      if (state.active < 0) return;
      panelEl.classList.remove('on');
      document.body.classList.remove('sign-on');
      panelEl.style.opacity = 0;
      state.active = -1;
      state.transit = false;

      if (!skipModeChange) {
        state.mode = 'map';
        hintEl.classList.remove('off');
        menuBtn.classList.remove('off');
        closeBtn.classList.remove('on');
      }

      try {
        history.replaceState(null, '', location.pathname + location.search);
      } catch (_) {}
    }

    let toastTimer = null;
    function showToast(message) {
      let toastEl = $('#toast');
      if (!toastEl) {
        toastEl = document.createElement('div');
        toastEl.id = 'toast';
        toastEl.style.cssText =
          'position:fixed;z-index:80;right:64px;bottom:96px;font:400 13px/1 var(--sans);letter-spacing:.06em;color:#e8ecf4;opacity:0;transition:opacity .4s ease;pointer-events:none';
        document.body.appendChild(toastEl);
      }
      toastEl.textContent = message;
      toastEl.style.opacity = '1';
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toastEl.style.opacity = '0';
      }, 1700);
    }

    function initShare() {
      const shareRow = $('#shareRow');
      const shareToggle = $('#shareToggle');
      if (!shareRow || !shareToggle) return;

      const shareWrap = $('#shareWrap');
      const setOpen = (open) => {
        shareRow.classList.toggle('on', open);
        shareRow.inert = !open;
        shareToggle.setAttribute('aria-expanded', String(open));
      };
      setOpen(false);
      shareToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        setOpen(!shareRow.classList.contains('on'));
      });
      document.addEventListener('click', (e) => {
        if (!shareWrap.contains(e.target)) setOpen(false);
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && shareRow.classList.contains('on')) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          shareToggle.focus();
        }
      });

      shareRow.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-share]');
        if (!btn) return;
        const action = btn.dataset.share;
        const url = location.href;
        const title = 'NightSky — Explore the Night Sky';

        if (action === 'copy') {
          e.preventDefault();
          try {
            await navigator.clipboard.writeText(url);
            showToast('Link copied');
          } catch (_) {
            showToast('Copy failed');
          }
        } else if (action === 'native') {
          e.preventDefault();
          if (navigator.share) {
            try {
              await navigator.share({ title, url });
            } catch (_) {}
          } else {
            showToast('Sharing unavailable');
          }
        } else {
          const shareLinks = {
            fb: 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url),
            tw:
              'https://twitter.com/intent/tweet?url=' +
              encodeURIComponent(url) +
              '&text=' +
              encodeURIComponent(title),
            li: 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(url),
          };
          btn.href = shareLinks[action];
        }
      });
    }

    function initEventListeners() {
      const soundBtn = $('#sound');
      if (soundBtn) {
        soundBtn.addEventListener('click', () => {
          const nextState = !SoundEngine.isEnabled;
          SoundEngine.toggle(nextState);
          soundBtn.setAttribute('aria-pressed', String(nextState));
          $('#waves').classList.toggle('hid', !nextState);
          $('#mute').classList.toggle('hid', nextState);
        });
      }

      window.addEventListener(
        'pointermove',
        (e) => {
          state.pointer.x = e.clientX;
          state.pointer.y = e.clientY;
          const isHovering = !!e.target.closest('button,a,#menuInner li,#panel a');
          if (isHovering !== state.overUI) {
            state.overUI = isHovering;
            updateCursor();
          }
        },
        { passive: true },
      );

      window.addEventListener(
        'pointerdown',
        (e) => {
          if (readingOverlay.isOpen) return;
          state.pointer.down = true;
          state.pointer.sx = e.clientX;
          state.pointer.sy = e.clientY;
          state.pointer.moved = 0;
          state.pointer.nav0 = state.mode === 'menu' ? state.menuT : state.navT;
          state.pointer.patternHit =
            !e.target.closest('button,a,#menu .txt,#skyGuide') &&
            ['map', 'menu', 'detail'].includes(state.mode)
              ? NightSky.PatternHit.pick(
                  constellationInstances,
                  skyRenderer,
                  state.cam,
                  e.clientX,
                  e.clientY,
                )
              : -1;
        },
        true,
      );

      window.addEventListener(
        'pointerup',
        (e) => {
          const hit = state.pointer.patternHit;
          if (
            state.pointer.down &&
            state.pointer.moved <= 6 &&
            e.button === 0 &&
            hit >= 0 &&
            !readingOverlay.isOpen &&
            !e.target.closest('button,a,#menu .txt,#skyGuide')
          ) {
            selectConstellation(hit, true);
            readingOverlay.open(
              CONSTELLATIONS.findIndex((c) => c.key === constellationInstances[hit].key),
              state.reduced,
            );
          }
          state.pointer.down = false;
          state.pointer.patternHit = -1;
        },
        true,
      );

      window.addEventListener(
        'pointermove',
        (e) => {
          if (readingOverlay.isOpen || !state.pointer.down) return;
          const dy = e.clientY - state.pointer.sy;
          const dx = e.clientX - state.pointer.sx;
          state.pointer.moved = Math.max(state.pointer.moved, Math.abs(dy) + Math.abs(dx));

          if (state.mode === 'menu') {
            state.menuT = state.pointer.nav0 - 0.0085 * dy;
          } else if (state.mode === 'map') {
            state.navT = clamp(
              state.pointer.nav0 - 0.0042 * dy,
              0,
              constellationInstances.length - 1,
            );
          }
        },
        { passive: true },
      );

      window.addEventListener(
        'wheel',
        (e) => {
          if (
            readingOverlay.isOpen ||
            state.mode === 'loading' ||
            state.mode === 'hero' ||
            state.mode === 'crest'
          )
            return;
          const delta = e.deltaMode === 1 ? 16 * e.deltaY : e.deltaY;

          if (state.mode === 'menu') {
            state.menuT += 0.003 * delta;
          } else if (state.mode === 'detail') {
            if (Math.abs(delta) > 18) {
              closeDetail();
              state.navT = clamp(
                state.navT + 0.55 * Math.sign(delta),
                0,
                constellationInstances.length - 1,
              );
            }
          } else {
            state.navT = clamp(state.navT + 0.00155 * delta, 0, constellationInstances.length - 1);
          }
        },
        { passive: true },
      );

      window.addEventListener('click', (e) => {
        if (
          readingOverlay.isOpen ||
          e.target.closest('button,a,#menu .txt,#skyGuide') ||
          state.pointer.moved > 6 ||
          !['map', 'menu', 'detail'].includes(state.mode)
        )
          return;
        const hit = NightSky.PatternHit.pick(
          constellationInstances,
          skyRenderer,
          state.cam,
          e.clientX,
          e.clientY,
        );
        const index =
          hit >= 0
            ? hit
            : state.mode === 'detail' && e.target.closest('#panel')
              ? state.active
              : -1;
        if (index < 0) return;
        selectConstellation(index, true);
        readingOverlay.open(
          CONSTELLATIONS.findIndex((c) => c.key === constellationInstances[index].key),
          state.reduced,
        );
      });

      menuBtn.addEventListener('click', openMenu);
      $('#join').addEventListener('click', (e) => {
        e.preventDefault();
        if (SoundEngine && SoundEngine.confirm) SoundEngine.confirm();
        state.mode === 'menu' ? closeMenu() : openMenu();
      });

      closeBtn.addEventListener('click', () => {
        if (SoundEngine && SoundEngine.reverse) SoundEngine.reverse();
        state.mode === 'menu' ? closeMenu() : closeDetail();
      });

      window.addEventListener('keydown', (e) => {
        if (readingOverlay.isOpen) {
          if (e.key === 'Escape') readingOverlay.close();
          return;
        }

        if (e.key === 'Escape') {
          state.mode === 'menu' ? closeMenu() : state.mode === 'detail' && closeDetail();
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
          e.preventDefault();
          if (state.mode === 'menu') {
            state.menuT = Math.round(state.menuT) + 1;
          } else {
            if (state.mode === 'detail') closeDetail();
            state.navT = clamp(Math.round(state.navT) + 1, 0, constellationInstances.length - 1);
          }
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
          e.preventDefault();
          if (state.mode === 'menu') {
            state.menuT = Math.round(state.menuT) - 1;
          } else {
            if (state.mode === 'detail') closeDetail();
            state.navT = clamp(Math.round(state.navT) - 1, 0, constellationInstances.length - 1);
          }
        } else if (e.key === 'Enter') {
          if (state.mode === 'menu') {
            closeMenu();
            selectConstellation(wrapIndex(state.menuF), true);
          } else if (state.mode === 'map') {
            selectConstellation(wrapIndex(state.nav));
          }
        } else if (e.key === 'm' || e.key === 'M') {
          state.mode === 'menu' ? closeMenu() : openMenu();
        }
      });

      const pMoreBtn = $('#pMore');
      if (pMoreBtn) {
        pMoreBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (SoundEngine && SoundEngine.shimmer) SoundEngine.shimmer();
          if (state.active >= 0) {
            const key = constellationInstances[state.active].key;
            readingOverlay.open(
              CONSTELLATIONS.findIndex((c) => c.key === key),
              state.reduced,
            );
          }
        });
      }

      const enterBtn = $('#enter');
      if (enterBtn) {
        enterBtn.addEventListener('click', async () => {
          if (state.mode !== 'hero') return;
          if (introController) introController.stop();
          if (typeof document !== 'undefined') document.body.classList.remove('introdark');
          SoundEngine.toggle(true);
          heroEl.style.opacity = '0';

          await animateTween(760, (val) => {
            state.heroRing = 1 - val;
          });

          state.mode = 'crest';
          setPhase('crest');
          crestWrapEl.style.opacity = '1';

          await animateTween(1500, (val) => {
            const scale = lerp(3.6, 0.98, easeOutCubic(val));
            crestWrapEl.style.transform = `scale(${scale})`;
            crestWrapEl.style.opacity = String(
              clamp(3.2 * val, 0, 1) * (val < 0.82 ? 1 : 1 - ((val - 0.82) / 0.18) * 0.15),
            );
          });

          await animateTween(900, (val) => {
            crestWrapEl.style.transform = `scale(${lerp(0.98, 0.8, val)})`;
            crestWrapEl.style.opacity = String(1 - easeOutCubic(val));
          });

          crestWrapEl.style.opacity = '0';
          introEl.classList.add('hid');
          state.mode = 'map';
          setPhase('map');
          hintEl.classList.remove('off');
        });
      }
    }

    let lastFrameTime = performance.now(),
      renderFrame = 0;
    function setPaused(value) {
      state.paused = value;
      if (renderFrame) cancelAnimationFrame(renderFrame);
      renderFrame = 0;
      if (!value && !document.hidden) {
        lastFrameTime = performance.now();
        renderFrame = requestAnimationFrame(renderLoop);
      }
    }

    function renderLoop(timestamp) {
      renderFrame = 0;
      if (state.paused || document.hidden) return;

      state.dt = Math.min(0.05, (timestamp - lastFrameTime) / 1000);
      lastFrameTime = timestamp;
      state.t += state.dt;

      const dt = state.dt;
      const total = constellationInstances.length;

      if (state.mode === 'menu') {
        state.menuF += (state.menuT - state.menuF) * (1 - Math.pow(0.0006, dt));
        state.navT = ((Math.round(state.menuF) % total) + total) % total;
      }
      state.nav +=
        (state.navT - state.nav) * (1 - Math.pow(state.mode === 'menu' ? 0.02 : 0.006, dt));

      const trackPos = interpolateCameraPath(state.nav);
      let targetX = trackPos.x;
      let targetY = trackPos.y;
      let targetZoom = 1;

      if (state.mode === 'loading' || state.mode === 'hero' || state.mode === 'crest') {
        targetX = initialCameraPos.x;
        targetY = initialCameraPos.y;
        targetZoom = 1;
      } else if (state.mode === 'detail' && state.active >= 0) {
        const inst = constellationInstances[state.active];
        const isNarrow = window.innerWidth < 820;
        targetZoom = Math.min(
          1.05,
          Math.max(
            0.52,
            (Math.min(window.innerWidth, window.innerHeight) * (isNarrow ? 0.22 : 0.27)) /
              inst.scale,
          ),
        );
        targetX = isNarrow ? inst.x : inst.x - (0.17 * window.innerWidth) / targetZoom;
        targetY = isNarrow ? inst.y + (0.2 * window.innerHeight) / targetZoom : inst.y;
      }

      state.camT.x = targetX;
      state.camT.y = targetY;
      state.camT.z = targetZoom;

      const prevCamX = state.cam.x;
      const prevCamY = state.cam.y;
      const camEase = 1 - Math.pow(state.mode === 'detail' ? 0.0025 : 0.004, dt);

      state.cam.x += (state.camT.x - state.cam.x) * camEase;
      state.cam.y += (state.camT.y - state.cam.y) * camEase;
      state.cam.z += (state.camT.z - state.cam.z) * (1 - Math.pow(0.006, dt));

      const deltaCamX = (state.cam.x - prevCamX) * state.cam.z;
      const deltaCamY = (state.cam.y - prevCamY) * state.cam.z;
      const speed = Math.hypot(deltaCamX, deltaCamY) / Math.max(dt, 1e-4);
      state.vel = speed;

      const dirLen = Math.hypot(deltaCamX, deltaCamY) || 1;
      state.velx = deltaCamX / dirLen;
      state.vely = deltaCamY / dirLen;

      const targetWarp = state.reduced ? 0 : clamp((speed - 380) / 2600, 0, 1);
      state.warp += (targetWarp - state.warp) * (1 - Math.pow(0.004, dt));

      if (SoundEngine && SoundEngine.report) {
        SoundEngine.report('warp', 0.7 * state.warp);
      }

      state.ringT = state.transit ? 1 : 0;
      state.ring += (state.ringT - state.ring) * (1 - Math.pow(0.004, dt));

      if (!state.reduced) {
        skyRenderer.shootingStars.update(dt, clamp(speed / 2600, 0, 1));
      }

      if (state.mode === 'map') {
        let hoveredIdx = -1;
        let minDist = 1e9;
        for (let i = 0; i < total; i++) {
          const inst = constellationInstances[i];
          const screenPos = skyRenderer.worldToScreen(inst.x, inst.y, state.cam);
          const dist = Math.hypot(screenPos.x - state.pointer.x, screenPos.y - state.pointer.y);
          if (dist < inst.scale * state.cam.z * 1.2 && dist < minDist) {
            minDist = dist;
            hoveredIdx = i;
          }
        }
        if (hoveredIdx !== state.hot) {
          state.hot = hoveredIdx;
          updateCursor();
        }
      } else if (state.hot !== -1) {
        state.hot = -1;
        updateCursor();
      }

      updateRail();

      if (state.mode !== state.lastMode) {
        state.lastMode = state.mode;
        updateCursor();
        setPhase(
          state.mode === 'loading' || state.mode === 'hero' || state.mode === 'crest'
            ? state.mode
            : 'map',
        );
      }

      if (state.mode === 'menu') {
        updateMenuWheel();
      }

      skyRenderer.render(state);

      renderFrame = requestAnimationFrame(renderLoop);
    }

    async function init() {
      if (typeof document === 'undefined') return;

      queryDOMElements();
      initRail();
      initMenu();
      initShare();
      initEventListeners();
      document.addEventListener('visibilitychange', () => setPaused(state.paused));
      ButtonGlow.initAll();

      const skyCanvas = document.getElementById('sky');
      const offscreenCanvas = document.createElement('canvas');
      skyRenderer.init(skyCanvas, offscreenCanvas, constellationInstances, initialCameraPos);

      window.addEventListener('resize', () => {
        skyRenderer.resize();
      });

      const dFixEl = document.getElementById('dfix');
      const dConEl = document.getElementById('dcon');
      if (dFixEl && dConEl) {
        const dglCanvas = document.createElement('canvas');
        dglCanvas.id = 'dgl';
        dglCanvas.style.cssText =
          'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none';
        dFixEl.insertBefore(dglCanvas, dConEl);
        swirlEngine = createParticleSwirlEngine(dFixEl, dglCanvas);
        swirlEngine.init(dglCanvas);
        readingOverlay.init(swirlEngine);
      } else {
        swirlEngine = createParticleSwirlEngine(document.body, null);
      }

      introController = createIntroController(swirlEngine, state, SoundEngine);

      setPhase('loading');
      state.cam.x = initialCameraPos.x;
      state.cam.y = initialCameraPos.y;
      state.camT.x = state.cam.x;
      state.camT.y = state.cam.y;
      state.mode = 'loading';
      hintEl.classList.add('off');

      if (!location.hash) {
        introController.prepare();
      } else {
        document.body.classList.remove('introdark');
      }

      try {
        const convexPts = $('#convexPts');
        const convexPath = $('#convexPath');
        if (convexPts && convexPath) {
          const totalLen = convexPath.getTotalLength();
          let ptsSvg = '';
          for (let i = 0; i < 5; i++) {
            const pt = convexPath.getPointAtLength(totalLen * (i / 4));
            ptsSvg += `<path transform="translate(${pt.x.toFixed(1)},${pt.y.toFixed(1)})" d="M0,-5.4 Q.9,-.9 5.4,0 Q.9,.9 0,5.4 Q-.9,.9 -5.4,0 Q-.9,-.9 0,-5.4 Z"/>`;
          }
          convexPts.innerHTML = ptsSvg;
        }
      } catch (_) {}

      renderFrame = requestAnimationFrame(renderLoop);

      const directRead = /\/read$/.test(location.hash);
      const directKey = location.hash.replace('#', '').split('/')[0];
      const directIndex = constellationInstances.findIndex((c) => c.key === directKey);
      if (directIndex >= 0) {
        introController.stop();
        introEl.classList.add('hid');
        loadingEl.classList.add('hid');
        state.mode = 'map';
        setPhase('map');
        hintEl.classList.remove('off');
        state.nav = state.navT = directIndex;
        state.cam.x = constellationInstances[directIndex].x;
        state.cam.y = constellationInstances[directIndex].y;
        selectConstellation(directIndex, true);
        if (directRead) readingOverlay.open(directIndex, state.reduced);
        return;
      }

      await waitMs(90);
      await waitMs(1200);

      loadingEl.style.opacity = '0';
      await waitMs(700);
      loadingEl.classList.add('hid');

      state.mode = 'hero';
      setPhase('hero');
      await introController.play();
      heroEl.style.opacity = '1';
      await animateTween(1600, (val) => {
        state.heroRing = easeOutCubic(val);
      });

      const hash = location.hash.replace('#', '').split('/')[0];
      const isReadDirect = /\/read$/.test(location.hash);
      if (hash) {
        if (introController) introController.stop();
        document.body.classList.remove('introdark');
        const signIdx = constellationInstances.findIndex((c) => c.key === hash);
        if (signIdx >= 0) {
          introEl.classList.add('hid');
          state.mode = 'map';
          setPhase('map');
          hintEl.classList.remove('off');
          state.nav = state.navT = signIdx;
          state.cam.x = constellationInstances[signIdx].x;
          state.cam.y = constellationInstances[signIdx].y;
          selectConstellation(signIdx, true);
          if (isReadDirect) {
            readingOverlay.open(signIdx, state.reduced);
          }
        }
      }
    }

    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
      } else {
        init();
      }
    }

    return {
      state: state,
      setPaused,
      constellationInstances: constellationInstances,
      skyRenderer: skyRenderer,
      readingOverlay: readingOverlay,
      selectConstellation: selectConstellation,
      openMenu: openMenu,
      closeMenu: closeMenu,
      closeDetail: closeDetail,
      init: init,
      setAtlasFilter: setAtlasFilter,
      enterAtlas: enterAtlas,
    };
  },
);
