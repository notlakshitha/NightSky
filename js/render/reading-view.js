(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('../core/math.js'),
      require('../data/constellations.js'),
      require('../audio/sound-engine.js'),
    );
  } else {
    root.NightSky = root.NightSky || {};
    root.NightSky.ReadingView = factory(
      root.NightSky.Math,
      root.NightSky.Data,
      root.NightSky.Audio,
    );
  }
})(
  typeof globalThis !== 'undefined' ? globalThis : window,
  function (MathUtils, DataUtils, SoundEngine) {
    'use strict';

    const clamp = MathUtils
      ? MathUtils.clamp
      : (v, min, max) => (v < min ? min : v > max ? max : v);
    const lerp = MathUtils ? MathUtils.lerp : (a, b, t) => a + (b - a) * t;
    const smoothstep = MathUtils ? MathUtils.smoothstep : (t) => t * t * (3 - 2 * t);
    const easeOutCubic = MathUtils ? MathUtils.easeOutCubic : (t) => 1 - Math.pow(1 - t, 3);
    const TAU = MathUtils ? MathUtils.TAU : 2 * Math.PI;
    const createPrng = MathUtils
      ? MathUtils.createPrng
      : (seed) => {
          return function () {
            seed = (1831565813 + (seed |= 0)) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
          };
        };
    const resolveAsset = MathUtils ? MathUtils.resolveAsset : (key) => key;

    const CONSTELLATIONS = DataUtils ? DataUtils.CONSTELLATIONS : [];
    const NORMALIZED_FIGURES = DataUtils ? DataUtils.NORMALIZED_FIGURES : [];
    const ZODIAC_COMPATIBILITY = DataUtils ? DataUtils.ZODIAC_COMPATIBILITY : {};
    const STAR_PALETTE = DataUtils ? DataUtils.STAR_PALETTE : [];
    const FIGURE_FACTORIES = DataUtils ? DataUtils.FIGURE_FACTORIES : {};

    const ButtonGlow = (() => {
      const BUTTON_IDS = ['enter', 'touchGrass', 'pMore', 'join', 'guideBtn'];
      const instances = [];
      let animRaf = 0;
      let lastTime = 0;
      let elapsed = 0;
      let noiseTextureCanvas = null;

      const isReduced = () =>
        typeof window !== 'undefined' &&
        window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      function createStarField(count) {
        const stars = [];
        let seed = 7;
        const nextRand = () => {
          seed = (16807 * seed) % 2147483647;
          return seed / 2147483647;
        };
        for (let i = 0; i < count; i++) {
          stars.push({
            x: nextRand(),
            y: 0.08 + 0.84 * nextRand(),
            r: 0.4 + 0.9 * Math.pow(nextRand(), 2),
            ph: TAU * nextRand(),
            sp: 1.4 + 3.2 * nextRand(),
          });
        }
        return stars;
      }

      function getNoiseTexture() {
        if (noiseTextureCanvas || typeof document === 'undefined') return noiseTextureCanvas;
        const w = 512,
          h = 128;
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        const imgData = ctx.createImageData(w, h);
        const data = imgData.data;

        const hash = (x, y) => {
          const s = 43758.5453 * Math.sin(127.1 * x + 311.7 * y);
          return s - Math.floor(s);
        };

        const noise2d = (x, y, period) => {
          const xi = Math.floor(x),
            yi = Math.floor(y);
          const xf = x - xi,
            yf = y - yi;
          const sx = xf * xf * (3 - 2 * xf),
            sy = yf * yf * (3 - 2 * yf);
          const x0 = ((xi % period) + period) % period;
          const x1 = (((xi + 1) % period) + period) % period;
          const n00 = hash(x0, yi),
            n10 = hash(x1, yi);
          const n01 = hash(x0, yi + 1),
            n11 = hash(x1, yi + 1);
          return (n00 * (1 - sx) + n10 * sx) * (1 - sy) + (n01 * (1 - sx) + n11 * sx) * sy;
        };

        const fbm = (x, y) => {
          let sum = 0,
            amp = 0.5,
            p = 8,
            curX = x,
            curY = y;
          for (let i = 0; i < 5; i++) {
            sum += amp * noise2d(curX, curY, p);
            curX = 2 * curX + 3.7;
            curY = 2 * curY + 1.3;
            p *= 2;
            amp *= 0.5;
          }
          return sum / 0.96875;
        };

        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const u = (x / w) * 8;
            const v = (y / h) * 2.2;
            let val = fbm(u + 0.6 * fbm(0.5 * u, 0.5 * v), v);
            val = Math.pow(Math.max(0, (val - 0.28) / 0.6), 1.35);
            const clampedVal = Math.min(1, val);

            let cr, cg, cb;
            if (clampedVal < 0.55) {
              const ratio = clampedVal / 0.55;
              cr = 18 + 42 * ratio;
              cg = 40 + 70 * ratio;
              cb = 120 + 112 * ratio;
            } else {
              const ratio = (clampedVal - 0.55) / 0.45;
              cr = 60 + 110 * ratio;
              cg = 110 + 102 * ratio;
              cb = 232 + 23 * ratio;
            }
            const alpha =
              (0.55 + 0.45 * clampedVal) * (1 - 0.25 * Math.pow(2 * Math.abs(y / h - 0.5), 2.2));
            const idx = 4 * (y * w + x);
            data[idx] = cr;
            data[idx + 1] = cg;
            data[idx + 2] = cb;
            data[idx + 3] = Math.round(255 * alpha);
          }
        }
        ctx.putImageData(imgData, 0, 0);
        noiseTextureCanvas = c;
        return noiseTextureCanvas;
      }

      function drawButtonGlow(inst) {
        const ctx = inst.g;
        const cv = inst.cv;
        const w = cv.width;
        const h = cv.height;
        if (!w || !h) return;

        const lit = Math.min(1, inst.lit);
        ctx.clearRect(0, 0, w, h);
        if (lit <= 0.002) {
          inst.btn.classList.remove('lit');
          return;
        }
        inst.btn.classList.add('lit');

        const radius = h / 2;
        const tex = getNoiseTexture();

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(radius, 0);
        ctx.lineTo(w - radius, 0);
        ctx.arc(w - radius, radius, radius, -Math.PI / 2, Math.PI / 2);
        ctx.lineTo(radius, h);
        ctx.arc(radius, radius, radius, Math.PI / 2, 1.5 * Math.PI);
        ctx.closePath();
        ctx.clip();
        ctx.globalAlpha = lit;

        if (tex) {
          const texScaleW = tex.width * (h / tex.height);
          const drift = isReduced() ? 0 : 4 * elapsed * inst.dpr;
          const offset =
            ((((-drift - inst.seed + (1 - inst.slide) * (-0.22 * w)) % texScaleW) + texScaleW) %
              texScaleW) -
            texScaleW;
          for (let x = offset; x < w; x += texScaleW) {
            ctx.drawImage(tex, x, 0, texScaleW, h);
          }
        }

        for (const s of inst.stars) {
          const twinkle = isReduced() ? 1 : 0.55 + 0.45 * Math.sin(elapsed * s.sp + s.ph);
          ctx.globalAlpha = lit * (0.35 + 0.65 * twinkle);
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.arc(s.x * w, s.y * h, s.r * inst.dpr, 0, TAU);
          ctx.fill();
        }

        if (inst.flash > 0.01) {
          ctx.globalAlpha = lit * inst.flash * 0.28;
          ctx.fillStyle = '#dceeff';
          ctx.fillRect(0, 0, w, h);
        }
        ctx.restore();

        ctx.save();
        ctx.globalAlpha = lit;
        const borderGrad = ctx.createLinearGradient(0, 0, 0, h);
        borderGrad.addColorStop(0, 'rgba(190,228,255,.95)');
        borderGrad.addColorStop(0.5, 'rgba(120,180,255,.55)');
        borderGrad.addColorStop(1, 'rgba(90,140,255,.45)');
        ctx.strokeStyle = borderGrad;
        ctx.lineWidth = 1.6 * inst.dpr;

        const inset = 0.9 * inst.dpr;
        const innerR = Math.max(0.1, radius - inset);
        ctx.beginPath();
        ctx.moveTo(radius, inset);
        ctx.lineTo(w - radius, inset);
        ctx.arc(w - radius, radius, innerR, -Math.PI / 2, Math.PI / 2);
        ctx.lineTo(radius, h - inset);
        ctx.arc(radius, radius, innerR, Math.PI / 2, 1.5 * Math.PI);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }

      function animationTick(timestamp) {
        animRaf = 0;
        const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
        lastTime = timestamp;
        elapsed += dt;

        let anyActive = false;
        for (const inst of instances) {
          if (Math.abs(inst.tgt - inst.lit) <= 0.002 && inst.lit <= 0.002 && inst.flash <= 0.01) {
            continue;
          }
          const speed = isReduced() ? 0.03 : inst.tgt > inst.lit ? 0.2 : 0.14;
          const step = 1 - Math.exp(-dt / speed);
          inst.lit += (inst.tgt - inst.lit) * step;
          inst.slide += (1 - inst.slide) * (1 - Math.exp(-dt / 0.16));
          inst.flash *= Math.exp(-dt / 0.18);
          if (inst.tgt === 0 && inst.lit < 0.002) {
            inst.lit = 0;
            inst.flash = 0;
          }
          drawButtonGlow(inst);
          if (Math.abs(inst.tgt - inst.lit) > 0.002 || inst.lit > 0.002) {
            anyActive = true;
          }
        }
        if (anyActive) {
          animRaf = requestAnimationFrame(animationTick);
        }
      }

      function startAnimation() {
        if (!animRaf && typeof requestAnimationFrame === 'function') {
          lastTime = performance.now();
          animRaf = requestAnimationFrame(animationTick);
        }
      }

      function attach(btnElement) {
        if (!btnElement) return null;
        const existing = instances.find((inst) => inst.btn === btnElement);
        if (existing) return existing;

        let canvas = btnElement.querySelector ? btnElement.querySelector('.bglow') : null;
        if (!canvas && typeof document !== 'undefined') {
          canvas = document.createElement('canvas');
          canvas.className = 'bglow';
          canvas.setAttribute('aria-hidden', 'true');
          btnElement.insertBefore(canvas, btnElement.firstChild);
        }
        if (!canvas) return null;

        const inst = {
          btn: btnElement,
          cv: canvas,
          g: canvas.getContext ? canvas.getContext('2d') : null,
          lit: 0,
          tgt: 0,
          slide: 1,
          flash: 0,
          stars: createStarField(40),
          w: 0,
          h: 0,
          dpr: 1,
          seed: 100 * Math.random(),
        };

        const resize = () => {
          if (!btnElement.getBoundingClientRect) return;
          const rect = btnElement.getBoundingClientRect();
          if (rect.width && rect.height) {
            inst.dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2);
            inst.w = rect.width;
            inst.h = rect.height;
            canvas.width = Math.round(rect.width * inst.dpr);
            canvas.height = Math.round(rect.height * inst.dpr);
          }
        };
        resize();
        if (typeof ResizeObserver !== 'undefined') {
          inst.observer = new ResizeObserver(resize);
          inst.observer.observe(btnElement);
        }

        const onEnter = () => {
          if (!inst.w || !canvas.width) resize();
          if (inst.tgt < 1) {
            inst.tgt = 1;
            inst.slide = 0;
          }
          startAnimation();
        };
        const onLeave = () => {
          inst.tgt = 0;
          startAnimation();
        };

        if (typeof btnElement.addEventListener === 'function') {
          inst.events = new AbortController();
          const on = (type, handler) =>
            btnElement.addEventListener(type, handler, { signal: inst.events.signal });
          on('pointerenter', (e) => {
            if (e && e.pointerType !== 'touch') onEnter();
          });
          on('pointerleave', onLeave);
          on('pointercancel', onLeave);
          on('pointerdown', () => {
            onEnter();
            inst.flash = 1;
            startAnimation();
          });
          on('pointerup', (e) => {
            if (e && e.pointerType === 'touch') inst.touchTimer = setTimeout(onLeave, 650);
          });
          on('focus', () => {
            let isFocusVisible = false;
            try {
              isFocusVisible = btnElement.matches && btnElement.matches(':focus-visible');
            } catch (_) {}
            if (isFocusVisible) onEnter();
          });
          on('blur', onLeave);
        }

        instances.push(inst);
        return inst;
      }

      function detach(element) {
        const index = instances.findIndex((inst) => inst.btn === element);
        if (index < 0) return;
        const inst = instances[index];
        inst.observer?.disconnect();
        inst.events?.abort();
        clearTimeout(inst.touchTimer);
        instances.splice(index, 1);
      }

      function initAll() {
        if (typeof window === 'undefined') return;
        window.addEventListener('blur', () => {
          for (const inst of instances) inst.tgt = 0;
          startAnimation();
        });
        BUTTON_IDS.forEach((id) => {
          const el = document.getElementById(id);
          if (el) attach(el);
        });
      }

      return {
        initAll: initAll,
        attach: attach,
        detach,
        instances: instances,
      };
    })();

    function createParticleSwirlEngine(containerEl, targetCanvas) {
      const isCoarse =
        typeof window !== 'undefined' &&
        ((window.matchMedia && window.matchMedia('(pointer:coarse)').matches) ||
          Math.min(window.innerWidth, window.innerHeight) < 720);

      const PARTICLE_COUNT = isCoarse ? 2300 : 3800;
      const HIGHLIGHT_LIMIT = isCoarse ? 1050 : 1600;
      const DENSITY_RATIO = HIGHLIGHT_LIMIT / 1600;

      function createWebGLPipeline(canvas) {
        const gl = canvas.getContext('webgl', {
          alpha: true,
          antialias: true,
          depth: false,
          stencil: false,
          premultipliedAlpha: true,
          powerPreference: 'high-performance',
          preserveDrawingBuffer: false,
        });
        if (!gl) return null;

        function compileShader(type, source) {
          const shader = gl.createShader(type);
          gl.shaderSource(shader, source);
          gl.compileShader(shader);
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            throw new Error('Shader compilation error: ' + gl.getShaderInfoLog(shader));
          }
          return shader;
        }

        function createProgram(vertSrc, fragSrc) {
          const prog = gl.createProgram();
          gl.attachShader(prog, compileShader(gl.VERTEX_SHADER, vertSrc));
          gl.attachShader(prog, compileShader(gl.FRAGMENT_SHADER, fragSrc));
          gl.linkProgram(prog);
          if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            throw new Error('Shader program link error: ' + gl.getProgramInfoLog(prog));
          }
          return prog;
        }

        const getUniforms = (prog, names) => {
          const uniforms = {};
          for (const n of names) uniforms[n] = gl.getUniformLocation(prog, n);
          return uniforms;
        };
        const getAttribs = (prog, names) => {
          const attribs = {};
          for (const n of names) attribs[n] = gl.getAttribLocation(prog, n);
          return attribs;
        };

        const tintColorSnippet = `
                vec3 tintColor(float t) {
                    vec3 ice = vec3(0.60, 0.77, 0.97);
                    vec3 wh  = vec3(0.93, 0.95, 1.0);
                    vec3 wa  = vec3(1.0, 0.83, 0.67);
                    return t < 0.5 ? mix(ice, wh, t * 2.0) : mix(wh, wa, (t - 0.5) * 2.0);
                }
            `;

        const pointProg = createProgram(
          `attribute vec2 aPos; attribute float aSize; attribute float aAlpha; attribute float aTint;
                 uniform vec2 uRes; uniform float uDpr; varying float vA; varying float vCore; varying vec3 vC;
                 ${tintColorSnippet}
                 void main() {
                     vec2 c = aPos / uRes * 2.0 - 1.0;
                     gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
                     float sp = aSize * 4.6 + 2.6;
                     gl_PointSize = sp * uDpr;
                     vCore = aSize / sp;
                     vA = aAlpha;
                     vC = tintColor(aTint);
                 }`,
          `precision mediump float;
                 varying float vA; varying float vCore; varying vec3 vC;
                 void main() {
                     vec2 p = gl_PointCoord - 0.5;
                     float d2 = dot(p, p) * 4.0;
                     float core = exp(-d2 / (vCore * vCore) * 0.8);
                     float halo = exp(-d2 * 3.2) * 0.15;
                     float a = vA * (core + halo) * step(d2, 1.0);
                     gl_FragColor = vec4(vC * a, a);
                 }`,
        );
        const pointAttribs = getAttribs(pointProg, ['aPos', 'aSize', 'aAlpha', 'aTint']);
        const pointUniforms = getUniforms(pointProg, ['uRes', 'uDpr']);

        const spikeProg = createProgram(
          `attribute vec2 aPos; attribute float aSize; attribute float aAlpha; attribute float aTint;
                 uniform vec2 uRes; uniform float uDpr; varying float vA; varying vec3 vC;
                 ${tintColorSnippet}
                 void main() {
                     vec2 c = aPos / uRes * 2.0 - 1.0;
                     gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
                     gl_PointSize = aSize * uDpr;
                     vA = aAlpha;
                     vC = tintColor(aTint);
                 }`,
          `precision mediump float;
                 varying float vA; varying vec3 vC;
                 void main() {
                     vec2 p = (gl_PointCoord - 0.5) * 2.0;
                     float ax = abs(p.x), ay = abs(p.y);
                     float h = exp(-ay * 34.0) * exp(-ax * 2.4) * (1.0 - ax);
                     float v = exp(-ax * 34.0) * exp(-ay * 2.4) * (1.0 - ay);
                     float halo = exp(-dot(p, p) * 4.2);
                     float a = vA * (0.46 * (h + v) + 0.40 * halo);
                     gl_FragColor = vec4(vC * a, a);
                 }`,
        );
        const spikeAttribs = getAttribs(spikeProg, ['aPos', 'aSize', 'aAlpha', 'aTint']);
        const spikeUniforms = getUniforms(spikeProg, ['uRes', 'uDpr']);

        const lineProg = createProgram(
          `attribute vec2 aPos; attribute float aAlpha; uniform vec2 uRes; varying float vA;
                 void main() {
                     vec2 c = aPos / uRes * 2.0 - 1.0;
                     gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
                     vA = aAlpha;
                 }`,
          `precision mediump float;
                 varying float vA; uniform vec3 uCol;
                 void main() {
                     gl_FragColor = vec4(uCol * vA, vA);
                 }`,
        );
        const lineAttribs = getAttribs(lineProg, ['aPos', 'aAlpha']);
        const lineUniforms = getUniforms(lineProg, ['uRes', 'uCol']);

        const glowProg = createProgram(
          `attribute vec2 aPos; varying vec2 vUv;
                 void main() {
                     vUv = aPos * 0.5 + 0.5;
                     gl_Position = vec4(aPos, 0.0, 1.0);
                 }`,
          `precision mediump float;
                 varying vec2 vUv; uniform vec2 uRes; uniform vec2 uCen; uniform float uGlow; uniform float uGlowR;
                 void main() {
                     vec2 px = vec2(vUv.x * uRes.x, (1.0 - vUv.y) * uRes.y);
                     float g = distance(px, uCen) / uGlowR;
                     vec3 col = vec3(0.84, 0.89, 1.0) * uGlow * (exp(-g * g * 2.6) * 0.55 + exp(-g * g * 14.0) * 0.95);
                     gl_FragColor = vec4(col, max(col.r, max(col.g, col.b)));
                 }`,
        );
        const glowAttribs = getAttribs(glowProg, ['aPos']);
        const glowUniforms = getUniforms(glowProg, ['uRes', 'uCen', 'uGlow', 'uGlowR']);

        const partBuf = gl.createBuffer();
        const spikeBuf = gl.createBuffer();
        const lineBuf = gl.createBuffer();
        const quadBuf = gl.createBuffer();

        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
        gl.bufferData(
          gl.ARRAY_BUFFER,
          new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
          gl.STATIC_DRAW,
        );

        const activeAttribs = new Set();
        function bindAttributes(bindings) {
          const desired = new Set(bindings.map((b) => b[0]));
          for (const a of activeAttribs) {
            if (!desired.has(a)) gl.disableVertexAttribArray(a);
          }
          activeAttribs.clear();
          for (const [attr, size, stride, offset] of bindings) {
            gl.enableVertexAttribArray(attr);
            gl.vertexAttribPointer(attr, size, gl.FLOAT, false, stride, offset);
            activeAttribs.add(attr);
          }
        }

        let viewW = 1,
          viewH = 1,
          viewDpr = 1;
        const pointSizeRange = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);

        return {
          gl: gl,
          maxPoint: pointSizeRange ? pointSizeRange[1] : 64,
          resize: (w, h, dpr) => {
            viewW = w;
            viewH = h;
            viewDpr = dpr;
            canvas.width = Math.max(1, Math.round(w * dpr));
            canvas.height = Math.max(1, Math.round(h * dpr));
            canvas.style.width = w + 'px';
            canvas.style.height = h + 'px';
            gl.viewport(0, 0, canvas.width, canvas.height);
          },
          draw: (frameData) => {
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE);

            if (frameData.glow > 0.002) {
              gl.useProgram(glowProg);
              gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
              bindAttributes([[glowAttribs.aPos, 2, 0, 0]]);
              gl.uniform2f(glowUniforms.uRes, viewW, viewH);
              gl.uniform2f(glowUniforms.uCen, frameData.cx, frameData.cy);
              gl.uniform1f(glowUniforms.uGlow, frameData.glow);
              gl.uniform1f(glowUniforms.uGlowR, frameData.glowR);
              gl.drawArrays(gl.TRIANGLES, 0, 6);
            }

            if (frameData.nl > 0) {
              gl.useProgram(lineProg);
              gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
              gl.bufferData(
                gl.ARRAY_BUFFER,
                frameData.lines.subarray(0, 6 * frameData.nl),
                gl.DYNAMIC_DRAW,
              );
              bindAttributes([
                [lineAttribs.aPos, 2, 12, 0],
                [lineAttribs.aAlpha, 1, 12, 8],
              ]);
              gl.uniform2f(lineUniforms.uRes, viewW, viewH);
              gl.uniform3f(lineUniforms.uCol, 0.7, 0.82, 1.0);
              gl.lineWidth(1);
              gl.drawArrays(gl.LINES, 0, 2 * frameData.nl);
            }

            gl.useProgram(pointProg);
            gl.bindBuffer(gl.ARRAY_BUFFER, partBuf);
            gl.bufferData(gl.ARRAY_BUFFER, frameData.parts, gl.DYNAMIC_DRAW);
            bindAttributes([
              [pointAttribs.aPos, 2, 20, 0],
              [pointAttribs.aSize, 1, 20, 8],
              [pointAttribs.aAlpha, 1, 20, 12],
              [pointAttribs.aTint, 1, 20, 16],
            ]);
            gl.uniform2f(pointUniforms.uRes, viewW, viewH);
            gl.uniform1f(pointUniforms.uDpr, viewDpr);
            gl.drawArrays(gl.POINTS, 0, frameData.n);

            if (frameData.ns > 0) {
              gl.useProgram(spikeProg);
              gl.bindBuffer(gl.ARRAY_BUFFER, spikeBuf);
              gl.bufferData(
                gl.ARRAY_BUFFER,
                frameData.spikes.subarray(0, 5 * frameData.ns),
                gl.DYNAMIC_DRAW,
              );
              bindAttributes([
                [spikeAttribs.aPos, 2, 20, 0],
                [spikeAttribs.aSize, 1, 20, 8],
                [spikeAttribs.aAlpha, 1, 20, 12],
                [spikeAttribs.aTint, 1, 20, 16],
              ]);
              gl.uniform2f(spikeUniforms.uRes, viewW, viewH);
              gl.uniform1f(spikeUniforms.uDpr, viewDpr);
              gl.drawArrays(gl.POINTS, 0, frameData.ns);
            }
          },
          clear: () => {
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
          },
        };
      }

      const P = PARTICLE_COUNT;
      const pArrays = {
        x: new Float32Array(P),
        y: new Float32Array(P),
        s: new Float32Array(P),
        a: new Float32Array(P),
        t: new Float32Array(P),
        fu: new Float32Array(P),
        fv: new Float32Array(P),
        fs: new Float32Array(P),
        fa: new Float32Array(P),
        sr: new Float32Array(P),
        sth: new Float32Array(P),
        ss: new Float32Array(P),
        sa: new Float32Array(P),
        ax: new Float32Array(P),
        ay: new Float32Array(P),
        ar: new Float32Array(P),
        ath: new Float32Array(P),
        as: new Float32Array(P),
        aa: new Float32Array(P),
        br: new Float32Array(P),
        bth: new Float32Array(P),
        d1: new Float32Array(P),
        d2: new Float32Array(P),
        st: new Float32Array(P),
        da: new Float32Array(P),
        dw1: new Float32Array(P),
        dw2: new Float32Array(P),
        dp1: new Float32Array(P),
        dp2: new Float32Array(P),
        tw: new Float32Array(P),
        tp: new Float32Array(P),
        ta: new Float32Array(P),
      };

      const renderBuffer = new Float32Array(5 * P);
      const lineBuffer = new Float32Array(144);
      const spikeBuffer = new Float32Array(240);
      let lineCount = 0;
      let spikeCount = 0;

      const anchorStars = [];
      const rng = createPrng(20260916);
      const randGaussian = () => {
        let u = 0,
          v = 0;
        while (u === 0) u = rng();
        while (v === 0) v = rng();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
      };

      for (let i = 0; i < P; i++) {
        const tVal = rng();
        pArrays.t[i] =
          tVal < 0.65 ? 0.42 + 0.16 * rng() : tVal < 0.92 ? 0.14 * rng() : 0.9 + 0.1 * rng();
        pArrays.fu[i] = 1.16 * rng() - 0.08;
        pArrays.fv[i] = 1.16 * rng() - 0.08;

        const nVal = rng();
        if (nVal < 0.7) {
          pArrays.fs[i] = 0.45 + 0.45 * rng();
          pArrays.fa[i] = 0.3 + 0.4 * rng();
        } else if (nVal < 0.965) {
          pArrays.fs[i] = 0.9 + 0.7 * rng();
          pArrays.fa[i] = 0.6 + 0.35 * rng();
        } else if (nVal < 0.994) {
          pArrays.fs[i] = 2.0 + 0.9 * rng();
          pArrays.fa[i] = 0.92;
        } else {
          pArrays.fs[i] = 3.1 + 0.6 * rng();
          pArrays.fa[i] = 1.0;
        }

        const arm = i % 3;
        if (rng() < 0.14) {
          pArrays.sr[i] = 0.05 * Math.abs(randGaussian()) + 0.01;
          pArrays.sth[i] = rng() * TAU;
          pArrays.ss[i] = 0.7 + 1.2 * rng();
          pArrays.sa[i] = 0.72 + 0.28 * rng();
        } else {
          let rVal = 0.07 + 0.93 * Math.pow(rng(), 0.72);
          let theta =
            -((arm * TAU) / 3 - 3.3 * Math.log(rVal / 0.07)) + randGaussian() * (0.06 + 0.1 * rVal);
          if (rng() < 0.1) theta += 1.1 * (rng() - 0.5);
          rVal *= 1 + 0.045 * randGaussian();
          pArrays.sr[i] = rVal;
          pArrays.sth[i] = theta;
          pArrays.ss[i] = 0.5 + 0.9 * rng();
          pArrays.sa[i] =
            (0.32 + 0.68 * Math.pow(1 - clamp(rVal, 0, 1), 1.25)) * (0.6 + 0.4 * rng());
        }

        if (pArrays.fs[i] > 1.8) {
          pArrays.ss[i] = Math.max(pArrays.ss[i], 0.85 * pArrays.fs[i]);
          pArrays.sa[i] = Math.max(pArrays.sa[i], 0.9);
        }

        pArrays.da[i] = 0.6 + 1.2 * rng();
        pArrays.dw1[i] = 0.12 + 0.28 * rng();
        pArrays.dw2[i] = 0.12 + 0.28 * rng();
        pArrays.dp1[i] = rng() * TAU;
        pArrays.dp2[i] = rng() * TAU;
        pArrays.tw[i] = 0.5 + 2.2 * rng();
        pArrays.tp[i] = rng() * TAU;
        pArrays.ta[i] = pArrays.fs[i] > 1.8 ? 0.16 : 0.22 + 0.14 * rng();

        if (i >= HIGHLIGHT_LIMIT && pArrays.fs[i] > 3.1 && anchorStars.length < 5) {
          anchorStars.push(i);
        }
      }

      const figuresData = [];
      const defaultFigure = {
        hk: new Uint8Array(P),
        hs: pArrays.fs,
        ha: pArrays.fa,
        hx: null,
        hy: null,
        ox: null,
        oy: null,
        cores: [],
        mags: [],
        lines: [],
      };

      function bakeConstellationModel(idx) {
        const fig = NORMALIZED_FIGURES[idx];
        if (!fig) return defaultFigure;
        const figRng = createPrng(101 + idx);
        const gauss = () => {
          let u = 0,
            v = 0;
          while (u === 0) u = figRng();
          while (v === 0) v = figRng();
          return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
        };

        const hx = new Float32Array(P);
        const hy = new Float32Array(P);
        const ox = new Float32Array(P);
        const oy = new Float32Array(P);
        const hs = new Float32Array(P);
        const ha = new Float32Array(P);
        const hk = new Uint8Array(P);
        hs.set(pArrays.fs);
        ha.set(pArrays.fa);

        let poolIdx = 0;
        const cores = [];
        const mags = [];
        const nextSlot = () => (poolIdx < HIGHLIGHT_LIMIT ? poolIdx++ : -1);

        for (let i = 0; i < fig.norm.length; i++) {
          const [nx, ny, mag] = fig.norm[i];
          let slot = nextSlot();
          if (slot < 0) break;
          cores[i] = slot;
          mags[i] = mag;
          hk[slot] = 3;
          hx[slot] = nx;
          hy[slot] = ny;
          ox[slot] = 0;
          oy[slot] = 0;
          hs[slot] = 2.3 + 1.1 * mag;
          ha[slot] = 1.0;

          const count = Math.round((16 + 20 * mag) * DENSITY_RATIO);
          const spread = 2.6 + 3.2 * mag;
          for (let j = 0; j < count; j++) {
            slot = nextSlot();
            if (slot < 0) break;
            hk[slot] = 2;
            hx[slot] = nx;
            hy[slot] = ny;
            const dist = Math.abs(gauss()) * spread + 1.2;
            const a = figRng() * TAU;
            ox[slot] = Math.cos(a) * dist;
            oy[slot] = Math.sin(a) * dist;
            hs[slot] = 0.45 + 0.85 * figRng();
            ha[slot] = (0.3 + 0.5 * figRng()) * clamp(1.4 - dist / (2.2 * spread), 0.35, 1);
          }
        }

        for (const [start, end] of fig.lines) {
          const p1 = fig.norm[start];
          const p2 = fig.norm[end];
          const segs = Math.max(
            2,
            Math.round(((300 * Math.hypot(p2[0] - p1[0], p2[1] - p1[1])) / 5.5) * DENSITY_RATIO),
          );
          for (let i = 0; i < segs; i++) {
            const slot = nextSlot();
            if (slot < 0) break;
            const t = (i + 0.5) / segs;
            hk[slot] = 1;
            hx[slot] = lerp(p1[0], p2[0], t);
            hy[slot] = lerp(p1[1], p2[1], t);
            ox[slot] = 2.1 * gauss();
            oy[slot] = 2.1 * gauss();
            hs[slot] = 0.38 + 0.5 * figRng();
            ha[slot] = 0.22 + 0.34 * figRng();
          }
        }

        for (const cluster of fig.normClusters || []) {
          const count = Math.round(cluster.n * DENSITY_RATIO);
          for (let i = 0; i < count; i++) {
            const slot = nextSlot();
            if (slot < 0) break;
            hk[slot] = 2;
            hx[slot] = cluster.x;
            hy[slot] = cluster.y;
            const dist = Math.abs(gauss()) * cluster.r + 0.8;
            const a = figRng() * TAU;
            ox[slot] = Math.cos(a) * dist;
            oy[slot] = Math.sin(a) * dist;
            hs[slot] = 0.5 + 1.3 * figRng();
            ha[slot] = 0.45 + 0.5 * figRng();
          }
        }

        return {
          hx: hx,
          hy: hy,
          ox: ox,
          oy: oy,
          hs: hs,
          ha: ha,
          hk: hk,
          cores: cores,
          mags: mags,
          lines: fig.lines,
          used: poolIdx,
        };
      }

      for (let i = 0; i < NORMALIZED_FIGURES.length; i++) {
        figuresData.push(bakeConstellationModel(i));
      }

      const state = {
        W: 1,
        H: 1,
        dpr: 1,
        cx: 0,
        cy: 0,
        fit: 1,
        rmax: 1,
        sign: -1,
        busy: false,
        tArrive: -1e9,
        tBoot: 0,
        reduced: false,
        mx: 0,
        my: 0,
        active: false,
        introAt: 0,
        introTo: 0,
        introDur: 0,
        fadeAt: 0,
        fadeDur: 1,
        vis: 1,
        yOff: 0,
        px: 0,
        py: 0,
        pk: 1,
        pal: 1,
      };

      const transition = {
        on: false,
        mode: 'swirl',
        from: null,
        to: 0,
        t0: 0,
        dur: 2700,
        q: 0,
      };

      let glPipeline = null;
      let canvasElement = targetCanvas;

      const tmpCoord = [0, 0];
      function getTargetCoord(figModel, idx, out) {
        if (figModel.hk[idx] === 0) {
          out[0] = pArrays.fu[idx] * state.W;
          out[1] = pArrays.fv[idx] * state.H;
        } else {
          out[0] = state.cx + figModel.hx[idx] * state.fit + figModel.ox[idx];
          out[1] = state.cy + figModel.hy[idx] * state.fit + figModel.oy[idx];
        }
      }

      function updateLayout() {
        if (typeof window === 'undefined') return;
        state.W = Math.max(1, window.innerWidth);
        state.H = Math.max(1, window.innerHeight);
        state.dpr = Math.min(window.devicePixelRatio || 1, 2);

        const oldFit = state.fit;
        const isNarrow = state.W < 820;
        state.cx = isNarrow ? 0.5 * state.W : 0.6 * state.W;
        state.cy = isNarrow ? 0.36 * state.H : 0.58 * state.H;
        state.fit = Math.min(0.36 * state.W, 0.3 * state.H);
        state.rmax = 0.44 * Math.min(state.W, state.H);

        if (transition.on && oldFit > 0) {
          const ratio = state.fit / oldFit;
          for (let i = 0; i < P; i++) {
            pArrays.ar[i] *= ratio;
            pArrays.ax[i] = state.cx + (pArrays.ax[i] - state.cx) * ratio;
            pArrays.ay[i] = state.cy + (pArrays.ay[i] - state.cy) * ratio;
          }
        }

        if (glPipeline) {
          glPipeline.resize(state.W, state.H, state.dpr);
        }
      }

      function startTransition(targetSign, opts) {
        opts = opts || {};
        const now = performance.now();
        const targetModel = targetSign < 0 ? defaultFigure : figuresData[targetSign];
        const sourceModel = transition.on
          ? transition.to < 0
            ? defaultFigure
            : figuresData[transition.to]
          : state.sign < 0
            ? defaultFigure
            : figuresData[state.sign];

        transition.from = sourceModel;
        transition.to = targetSign;
        transition.t0 = now;
        transition.q = 0;
        transition.on = true;
        transition.mode = state.reduced ? 'fade' : 'swirl';
        transition.dur = opts.dur || (state.reduced ? 900 : isCoarse ? 2700 : 3000);
        state.busy = true;

        const E_SPLIT = 0.34;
        const R_SPLIT = 0.66;
        const I_STAGGER = 0.1;

        for (let i = 0; i < P; i++) {
          const dx = pArrays.x[i] - state.cx;
          const dy = pArrays.y[i] - state.cy;
          pArrays.ax[i] = pArrays.x[i];
          pArrays.ay[i] = pArrays.y[i];
          pArrays.ar[i] = Math.hypot(dx, dy);
          pArrays.ath[i] = Math.atan2(dy, dx);
          pArrays.as[i] = pArrays.s[i];
          pArrays.aa[i] = pArrays.a[i];

          getTargetCoord(targetModel, i, tmpCoord);
          const tdx = tmpCoord[0] - state.cx;
          const tdy = tmpCoord[1] - state.cy;
          pArrays.br[i] = Math.hypot(tdx, tdy);
          pArrays.bth[i] = Math.atan2(tdy, tdx);

          const rndSt = Math.random();
          pArrays.st[i] = rndSt;

          const h1 = 0.9 * E_SPLIT + rndSt * I_STAGGER;
          const h2 = 0.9 + rndSt * I_STAGGER;
          const th1 = pArrays.sth[i] - 1.35 * smoothstep(h1);
          const th2 = pArrays.sth[i] - 1.35 * smoothstep(h2);

          pArrays.d1[i] = -(
            (((-(th1 - pArrays.ath[i]) % TAU) + TAU) % TAU) +
            TAU * (0.08 + 0.45 * (1 - clamp(pArrays.sr[i], 0, 1)) + 0.22 * Math.random())
          );

          const startR = Math.max(pArrays.sr[i] * state.rmax, 0.5);
          const endR = Math.max(pArrays.br[i], 0.5);
          const targetAngle = th2 - -3.3 * Math.log(endR / startR);
          let angleDiff = pArrays.bth[i] - targetAngle;
          angleDiff -= TAU * Math.round(angleDiff / TAU);
          pArrays.d2[i] = angleDiff;
        }
      }

      return {
        init: (canvas) => {
          canvasElement = canvas;
          try {
            glPipeline = createWebGLPipeline(canvas);
          } catch (_) {
            glPipeline = null;
          }
          return !!glPipeline;
        },
        mkGL: createWebGLPipeline,
        figs: NORMALIZED_FIGURES,
        open: (signIndex, reduced) => {
          if (!glPipeline && canvasElement) {
            try {
              glPipeline = createWebGLPipeline(canvasElement);
            } catch (_) {
              glPipeline = null;
            }
          }
          if (!glPipeline) return false;

          const now = performance.now();
          state.reduced = !!reduced;
          state.active = true;
          state.vis = 1;
          state.yOff = 0;
          state.fadeAt = 0;
          transition.on = false;
          state.sign = -1;
          state.busy = false;
          state.tBoot = now;
          state.tArrive = now - 1e6;
          updateLayout();
          state.px = state.cx;
          state.py = state.cy;
          state.pk = 1;
          state.pal = 1;

          for (let i = 0; i < P; i++) {
            getTargetCoord(defaultFigure, i, tmpCoord);
            pArrays.x[i] = tmpCoord[0];
            pArrays.y[i] = tmpCoord[1];
            pArrays.s[i] = pArrays.fs[i];
            pArrays.a[i] = 0;
          }

          state.introTo = signIndex;
          state.introDur = state.reduced ? 1100 : 3200;
          state.introAt = now + (state.reduced ? 600 : 1500);
          return true;
        },
        close: () => {
          if (!state.active) return 0;
          const now = performance.now();
          state.introAt = 0;
          const dur = state.reduced ? 900 : isCoarse ? 2200 : 2400;
          startTransition(-1, { dur: dur });
          state.fadeAt = now + dur - 600;
          state.fadeDur = 600;
          return dur;
        },
        travel: (signIndex) => {
          if (state.active) {
            state.introAt = 0;
            startTransition(signIndex);
          }
        },
        stop: () => {
          state.active = false;
          state.introAt = 0;
          transition.on = false;
          if (glPipeline) glPipeline.clear();
        },
        layout: updateLayout,
        place: (x, y, scale, alpha) => {
          state.px = x;
          state.py = y;
          state.pk = scale;
          state.pal = alpha;
        },
        draw: (timeMs, scrollRatio, mouseX, mouseY) => {
          if (!state.active || !glPipeline) {
            return { active: false, formed: 1 };
          }
          state.mx = mouseX;
          state.my = mouseY;
          state.vis = Math.pow(1 - scrollRatio, 1.5);
          state.yOff = scrollRatio * state.H * 0.25;

          const curTimeSec = timeMs / 1000;
          if (state.introAt && timeMs >= state.introAt) {
            state.introAt = 0;
            startTransition(state.introTo, { dur: state.introDur });
          }

          const motionFactor = isCoarse ? 0 : 7;
          const minorFactor = isCoarse ? 0 : 3.5;
          const arrivalEasing = state.reduced
            ? 0
            : smoothstep(clamp((timeMs - state.tArrive) / 1500, 0, 1));
          let bootFade = smoothstep(clamp((timeMs - state.tBoot) / 1400, 0, 1));
          if (state.fadeAt) {
            bootFade *= 1 - smoothstep(clamp((timeMs - state.fadeAt) / state.fadeDur, 0, 1));
          }

          const targetModel = transition.on
            ? transition.to < 0
              ? defaultFigure
              : figuresData[transition.to]
            : state.sign < 0
              ? defaultFigure
              : figuresData[state.sign];

          const E_SPLIT = 0.34;
          const R_SPLIT = 0.66;
          const I_STAGGER = 0.1;
          let swirlGlow = 0;

          if (transition.on) {
            const q = clamp((timeMs - transition.t0) / transition.dur, 0, 1);
            transition.q = q;

            if (typeof SoundEngine !== 'undefined' && SoundEngine.report) {
              const swirlReport =
                transition.mode === 'swirl'
                  ? (q < E_SPLIT
                      ? smoothstep(q / E_SPLIT)
                      : q < R_SPLIT
                        ? 1
                        : 1 - smoothstep((q - R_SPLIT) / (1 - R_SPLIT))) *
                    (transition.to < 0 ? 0.8 : 1)
                  : 0;
              SoundEngine.report('swirl', swirlReport);
            }

            if (transition.mode === 'swirl') {
              const swirlRot = -1.35 * smoothstep(q);
              const waveSin = Math.sin(Math.PI * clamp((q - 0.16) / 0.68, 0, 1));
              swirlGlow = waveSin * waveSin * 0.36;

              for (let i = 0; i < P; i++) {
                const prog = clamp((q - pArrays.st[i] * I_STAGGER) / 0.9, 0, 1);
                const twinkle =
                  1 + pArrays.ta[i] * Math.sin(curTimeSec * pArrays.tw[i] + pArrays.tp[i]);
                let px, py, ps, pa;

                if (prog < E_SPLIT) {
                  const normP = prog / E_SPLIT;
                  const easeP = smoothstep(normP);
                  const powP = Math.pow(normP, 1.8);
                  const curR = lerp(pArrays.ar[i], pArrays.sr[i] * state.rmax, easeP);
                  const curTheta = pArrays.ath[i] + pArrays.d1[i] * powP;
                  px = state.cx + Math.cos(curTheta) * curR;
                  py = state.cy + Math.sin(curTheta) * curR;
                  ps = lerp(pArrays.as[i], pArrays.ss[i], easeP);
                  pa = lerp(pArrays.aa[i], pArrays.sa[i], 1 - (1 - normP) * (1 - normP));
                } else if (prog < R_SPLIT) {
                  const curR = pArrays.sr[i] * state.rmax;
                  const curTheta = pArrays.sth[i] + swirlRot;
                  px = state.cx + Math.cos(curTheta) * curR;
                  py = state.cy + Math.sin(curTheta) * curR;
                  ps = pArrays.ss[i];
                  pa = pArrays.sa[i] * (1 + 0.18 * waveSin);
                } else if (prog < 1) {
                  const normP = (prog - R_SPLIT) / (1 - R_SPLIT);
                  const easeP = smoothstep(normP);
                  const invEase = 1 - (1 - normP) * (1 - normP);
                  const d2Ease = smoothstep(clamp((normP - 0.28) / 0.72, 0, 1));
                  getTargetCoord(targetModel, i, tmpCoord);
                  const startR = Math.max(pArrays.sr[i] * state.rmax, 0.5);
                  const curR = Math.max(lerp(startR, pArrays.br[i], easeP), 0.5);
                  const curTheta =
                    pArrays.sth[i] +
                    swirlRot -
                    -3.3 * Math.log(curR / startR) +
                    pArrays.d2[i] * d2Ease;
                  px = state.cx + Math.cos(curTheta) * curR;
                  py = state.cy + Math.sin(curTheta) * curR;
                  ps = lerp(pArrays.ss[i], targetModel.hs[i], easeP);
                  pa = lerp(pArrays.sa[i], targetModel.ha[i], invEase);
                } else {
                  getTargetCoord(targetModel, i, tmpCoord);
                  px = tmpCoord[0];
                  py = tmpCoord[1];
                  ps = targetModel.hs[i];
                  pa = targetModel.ha[i];
                }

                const jitterFactor = targetModel.hk[i] ? minorFactor : motionFactor;
                pArrays.x[i] = px + state.mx * jitterFactor;
                pArrays.y[i] = py + state.my * jitterFactor;
                pArrays.s[i] = ps;
                pArrays.a[i] = pa * twinkle * bootFade;
              }
            } else {
              const sourceModel = transition.from;
              for (let i = 0; i < P; i++) {
                const isBackgroundBoth =
                  sourceModel && sourceModel.hk[i] === 0 && targetModel.hk[i] === 0;
                const twinkle =
                  1 + 0.35 * pArrays.ta[i] * Math.sin(curTimeSec * pArrays.tw[i] + pArrays.tp[i]);
                getTargetCoord(targetModel, i, tmpCoord);

                if (isBackgroundBoth) {
                  pArrays.x[i] = tmpCoord[0];
                  pArrays.y[i] = tmpCoord[1];
                  pArrays.s[i] = targetModel.hs[i];
                  pArrays.a[i] = targetModel.ha[i] * twinkle * bootFade;
                } else if (q < 0.5) {
                  pArrays.x[i] = pArrays.ax[i];
                  pArrays.y[i] = pArrays.ay[i];
                  pArrays.s[i] = pArrays.as[i];
                  pArrays.a[i] = pArrays.aa[i] * (1 - smoothstep(q / 0.5));
                } else {
                  pArrays.x[i] = tmpCoord[0];
                  pArrays.y[i] = tmpCoord[1];
                  pArrays.s[i] = targetModel.hs[i];
                  pArrays.a[i] =
                    targetModel.ha[i] * twinkle * bootFade * smoothstep((q - 0.5) / 0.5);
                }
              }
            }

            if (q >= 1) {
              transition.on = false;
              state.sign = transition.to;
              state.tArrive = timeMs;
              state.busy = false;
            }
          } else {
            for (let i = 0; i < P; i++) {
              getTargetCoord(targetModel, i, tmpCoord);
              const isKnot = targetModel.hk[i];
              const driftAmp = pArrays.da[i] * (isKnot ? 0.55 : 1) * arrivalEasing;
              const jitterFactor = isKnot ? minorFactor : motionFactor;
              const px =
                tmpCoord[0] +
                Math.sin(curTimeSec * pArrays.dw1[i] + pArrays.dp1[i]) * driftAmp +
                state.mx * jitterFactor;
              const py =
                tmpCoord[1] +
                Math.cos(curTimeSec * pArrays.dw2[i] + pArrays.dp2[i]) * driftAmp +
                state.my * jitterFactor;
              const twinkle =
                1 +
                pArrays.ta[i] *
                  (state.reduced ? 0.35 : 1) *
                  Math.sin(curTimeSec * pArrays.tw[i] + pArrays.tp[i]);

              pArrays.x[i] = px;
              pArrays.y[i] = py;
              pArrays.s[i] = targetModel.hs[i];
              pArrays.a[i] = targetModel.ha[i] * twinkle * bootFade;
            }
          }

          const visAlpha = state.vis;
          const scrollYOff = state.yOff;
          const scaleVal = state.pk;
          const pointScale = Math.pow(scaleVal, 0.6);
          const palAlpha = state.pal;
          const px = state.px,
            py = state.py,
            cx = state.cx,
            cy = state.cy;
          const knotFlags = targetModel.hk;

          for (let i = 0, idx = 0; i < P; i++, idx += 5) {
            if (knotFlags[i]) {
              renderBuffer[idx] = px + (pArrays.x[i] - cx) * scaleVal;
              renderBuffer[idx + 1] = py + (pArrays.y[i] - cy) * scaleVal;
              renderBuffer[idx + 2] = pArrays.s[i] * pointScale;
              renderBuffer[idx + 3] = pArrays.a[i] * palAlpha;
            } else {
              renderBuffer[idx] = pArrays.x[i];
              renderBuffer[idx + 1] = pArrays.y[i] - scrollYOff;
              renderBuffer[idx + 2] = pArrays.s[i];
              renderBuffer[idx + 3] = pArrays.a[i] * visAlpha;
            }
            renderBuffer[idx + 4] = pArrays.t[i];
          }

          lineCount = 0;
          spikeCount = 0;
          const fitScale = clamp(state.fit / 300, 0.62, 1.3);

          const scheduleLines = (model, curTime, arriveTime, alpha) => {
            const lines = model.lines;
            if (!lines || !lines.length || alpha <= 0) return;
            for (let c = 0; c < lines.length && lineCount < 24; c++) {
              const startSlot = model.cores[lines[c][0]];
              const endSlot = model.cores[lines[c][1]];
              if (startSlot == null || endSlot == null) continue;

              let segEase = 1,
                fadeEase = 1;
              if (arriveTime != null) {
                segEase = easeOutCubic(clamp((curTime - arriveTime - 95 * c) / 720, 0, 1));
                fadeEase = lerp(
                  1,
                  0.36,
                  smoothstep(clamp((curTime - arriveTime - 3600) / 1800, 0, 1)),
                );
              }
              if (segEase <= 0) continue;

              const sx = state.px + (pArrays.x[startSlot] - state.cx) * state.pk;
              const sy = state.py + (pArrays.y[startSlot] - state.cy) * state.pk;
              const ex = state.px + (pArrays.x[endSlot] - state.cx) * state.pk;
              const ey = state.py + (pArrays.y[endSlot] - state.cy) * state.pk;
              const lineAlpha = 0.3 * fadeEase * alpha * state.pal;
              const lIdx = 6 * lineCount;

              lineBuffer[lIdx] = sx;
              lineBuffer[lIdx + 1] = sy;
              lineBuffer[lIdx + 2] = lineAlpha;
              lineBuffer[lIdx + 3] = lerp(sx, ex, segEase);
              lineBuffer[lIdx + 4] = lerp(sy, ey, segEase);
              lineBuffer[lIdx + 5] = lineAlpha;
              lineCount++;
            }
          };

          const scheduleSpikes = (model, alpha, scale) => {
            if (alpha <= 0) return;
            for (let n = 0; n < model.cores.length && spikeCount < 48; n++) {
              const coreSlot = model.cores[n];
              const mag = model.mags[n];
              const sIdx = 5 * spikeCount;
              spikeBuffer[sIdx] = state.px + (pArrays.x[coreSlot] - state.cx) * state.pk;
              spikeBuffer[sIdx + 1] = state.py + (pArrays.y[coreSlot] - state.cy) * state.pk;
              spikeBuffer[sIdx + 2] = Math.min(
                (30 + 28 * mag) * scale * Math.pow(state.pk, 0.7),
                glPipeline.maxPoint / state.dpr,
              );
              spikeBuffer[sIdx + 3] = 0.72 * pArrays.a[coreSlot] * alpha * state.pal;
              spikeBuffer[sIdx + 4] = pArrays.t[coreSlot];
              spikeCount++;
            }
          };

          if (transition.on) {
            const q = transition.q;
            const exitAlpha = 1 - clamp(q / 0.12, 0, 1);
            if (exitAlpha > 0 && transition.from) {
              scheduleLines(transition.from, timeMs, null, exitAlpha);
              scheduleSpikes(transition.from, exitAlpha, fitScale);
            }
            const enterAlpha = clamp((q - 0.86) / 0.14, 0, 1);
            if (enterAlpha > 0) {
              scheduleSpikes(targetModel, enterAlpha, fitScale);
            }
          } else {
            scheduleLines(targetModel, timeMs, state.tArrive, 1);
            scheduleSpikes(targetModel, 1, fitScale);
          }

          for (const anchor of anchorStars) {
            if (spikeCount >= 48) break;
            const sIdx = 5 * spikeCount;
            spikeBuffer[sIdx] = pArrays.x[anchor];
            spikeBuffer[sIdx + 1] = pArrays.y[anchor] - scrollYOff;
            spikeBuffer[sIdx + 2] = 44 * fitScale;
            spikeBuffer[sIdx + 3] = 0.5 * pArrays.a[anchor] * visAlpha;
            spikeBuffer[sIdx + 4] = pArrays.t[anchor];
            spikeCount++;
          }

          glPipeline.draw({
            parts: renderBuffer,
            n: P,
            lines: lineBuffer,
            nl: lineCount,
            spikes: spikeBuffer,
            ns: spikeCount,
            glow: swirlGlow * visAlpha,
            glowR: 0.62 * state.rmax,
            cx: state.cx,
            cy: state.cy - scrollYOff,
          });

          return {
            active: true,
            formed: transition.on
              ? transition.to < 0
                ? 0
                : clamp((transition.q - 0.86) / 0.14, 0, 1)
              : state.sign < 0
                ? 0
                : 1,
            busy: state.busy,
          };
        },
      };
    }

    const HoloCardRenderer = (() => {
      const CARD_TILT_MAX = 14.35;
      const CARD_EASING = 0.14;

      const uniformDefaults = {
        cell: 6.8,
        jitter: 0.42,
        rMin: 1.4,
        rSpan: 2.8,
        rPow: 2,
        core: 0.52,
        glint: 0.28,
        fineCell: 0.42,
        fineAmt: 0.42,
        ambient: 0.14,
        gain: 1.2,
        ampPow: 8,
        dissolve: 0.2,
        noise: 255,
        fieldW: 0.8,
        fieldC: 1,
        drift: 0.03,
        shift: 0.62,
        blobX: -1,
        blobY: 1,
        blobIn: 70,
        blobOut: 300,
        blobAmt: 0.34,
        liftAmt: 0.2,
        liftLo: 0.2,
        liftHi: 0.95,
        lo: 0.34,
        hi: 0.66,
        sat: 0.74,
        hueSpan: 0.42,
        hueRand: 0.62,
        huePtr: 0.16,
        balance: 0.78,
        headroom: 0.3,
        waveLen: 115,
        waveAmt: 0.09,
        grainLen: 5,
        grainAmt: 0.012,
        bump: 1,
        keyX: -1.3,
        keyY: 1.24,
        keyZ: 2.25,
        keyTight: 100,
        keyAmt: 0.3,
        keyBroad: 14,
        broadAmt: 0.03,
        fillX: 1.2,
        fillY: -0.9,
        fillZ: 2.05,
        fillTight: 40,
        fillAmt: 0.24,
        diffuse: 0.028,
      };

      const activeCards = [];
      const textureCache = new Map();
      let animRaf = 0;
      let lastTimestamp = 0;
      let elapsed = 0;
      let globalTimeOverride = null;

      const getThree = () =>
        typeof window !== 'undefined' && window.THREE && window.THREE.WebGLRenderer
          ? window.THREE
          : null;

      function updateUniforms(card) {
        const u = card.U;
        const d = uniformDefaults;
        u.uFlake.value.set(d.cell, d.rMin, d.rSpan, d.rPow);
        u.uFlake2.value.set(d.cell * d.fineCell, d.fineAmt, d.core, d.glint);
        u.uAmp.value.set(d.ambient, d.gain, d.ampPow, d.dissolve);
        u.uField.value.set(d.noise, d.shift, d.drift, d.blobAmt);
        u.uFieldW.value.set(d.fieldW, d.fieldC);
        u.uBlob.value.set(d.blobX, d.blobY, d.blobIn, d.blobOut);
        u.uLevel.value.set(d.lo, d.hi, d.liftLo, d.liftHi);
        u.uLift.value = d.liftAmt;
        u.uJitter.value = d.jitter;
        u.uColour.value.set(d.sat, d.hueSpan, d.hueRand, d.huePtr);
        u.uLam.value.set(d.waveLen, d.waveAmt, d.grainLen, d.grainAmt);
        u.uBump.value = d.bump;
        u.uKey.value.set(d.keyTight, d.keyAmt, d.keyBroad, d.broadAmt);
        u.uFill.value.set(d.fillTight, d.fillAmt);
        u.uDiffuse.value = d.diffuse;
        u.uTone.value.set(d.balance, d.headroom);
      }

      const isCardActive = (c) => c.tgt.h > 0 || c.cur.h > 0.0005 || c.dirty;

      function renderCardsTick(timestamp) {
        animRaf = 0;
        const THREE = getThree();
        if (!THREE) return;

        const dt = Math.min((timestamp - lastTimestamp) / 1000, 0.05);
        lastTimestamp = timestamp;
        elapsed += dt;

        let anyActive = false;
        for (const c of activeCards) {
          if (c.dead || !isCardActive(c)) continue;
          const ease = 1 - Math.exp(-dt / CARD_EASING);
          c.cur.x += (c.tgt.x - c.cur.x) * ease;
          c.cur.y += (c.tgt.y - c.cur.y) * ease;
          c.cur.h += (c.tgt.h - c.cur.h) * ease;
          if (c.tgt.h === 0 && c.cur.h < 0.0005) {
            c.cur.h = 0;
            c.cur.x = c.tgt.x;
            c.cur.y = c.tgt.y;
          }

          const u = c.U;
          u.uPtr.value.set(c.cur.x, c.cur.y);
          u.uHover.value = c.cur.h;
          u.uTime.value =
            globalTimeOverride !== null ? globalTimeOverride : c.reduced ? 0 : elapsed;

          const maxTilt = c.reduced ? 0 : CARD_TILT_MAX;
          c.card.rotation.x = THREE.MathUtils.degToRad(maxTilt * c.cur.y * c.cur.h);
          c.card.rotation.y = THREE.MathUtils.degToRad(maxTilt * c.cur.x * c.cur.h);
          c.dirty = false;

          if (c.visible && !document.hidden && c.CW > 0) {
            c.renderer.render(c.scene, c.camera);
            c.frames++;
            if (c.ready && !c.on) {
              c.on = true;
              c.zc.classList.add('on');
            }
          }
          if (isCardActive(c)) anyActive = true;
        }
        if (anyActive) {
          animRaf = requestAnimationFrame(renderCardsTick);
        }
      }

      function startTick() {
        if (!animRaf && typeof requestAnimationFrame === 'function') {
          lastTimestamp = performance.now();
          animRaf = requestAnimationFrame(renderCardsTick);
        }
      }

      function destroyCard(c) {
        c.dead = true;
        if (c.ro) c.ro.disconnect();
        if (c.io) c.io.disconnect();
        try {
          c.card.geometry.dispose();
          c.card.material.dispose();
        } catch (_) {}
        try {
          c.renderer.dispose();
          c.renderer.forceContextLoss();
        } catch (_) {}
      }

      function attach(btnElement, opts) {
        opts = opts || {};
        const THREE = getThree();
        if (!THREE) return;

        const zc = btnElement.querySelector('.zc');
        const holoCanvas = btnElement.querySelector('.zc-holo');
        const img = btnElement.querySelector('.zc-img');
        if (!zc || !holoCanvas) return;

        let renderer;
        try {
          renderer = new THREE.WebGLRenderer({
            canvas: holoCanvas,
            antialias: true,
            alpha: true,
            powerPreference: 'low-power',
          });
        } catch (_) {
          return;
        }

        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setClearColor(0, 0);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(30, 1, 1, 20000);

        const card = {
          btn: btnElement,
          zc: zc,
          canvas: holoCanvas,
          img: img,
          renderer: renderer,
          scene: scene,
          camera: camera,
          key: opts.key || '',
          ready: false,
          on: false,
          visible: true,
          reduced: !!opts.reduced,
          tgt: { x: 0, y: 0, h: 0 },
          cur: { x: 0, y: 0, h: 0 },
          CW: 0,
          CH: 0,
          frames: 0,
          dirty: true,
          dead: false,
        };

        const cardKey = card.key;
        const imgSrc = img ? img.getAttribute('src') : resolveAsset(`cards/${cardKey}.webp`);

        let texture = textureCache.get(imgSrc);
        if (!texture) {
          texture = new THREE.TextureLoader().load(imgSrc, () => {
            texture.__cbs.splice(0).forEach((cb) => cb());
          });
          texture.__cbs = [
            () => {
              card.ready = true;
              card.dirty = true;
              startTick();
            },
          ];
          texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
          texture.minFilter = THREE.LinearMipmapLinearFilter;
          texture.magFilter = THREE.LinearFilter;
          texture.generateMipmaps = true;
          texture.premultiplyAlpha = true;
          texture.flipY = true;
          textureCache.set(imgSrc, texture);
        } else if (texture.image && texture.image.complete && texture.image.naturalWidth) {
          card.ready = true;
          card.dirty = true;
          startTick();
        } else {
          texture.__cbs.push(() => {
            card.ready = true;
            card.dirty = true;
            startTick();
          });
        }

        card.U = {
          uMap: { value: texture },
          uCard: { value: new THREE.Vector2(640, 640 / 0.75) },
          uPtr: { value: new THREE.Vector2(0, 0) },
          uHover: { value: 0 },
          uTime: { value: 0 },
          uRadius: { value: 12 },
          uFlake: { value: new THREE.Vector4() },
          uFlake2: { value: new THREE.Vector4() },
          uAmp: { value: new THREE.Vector4() },
          uField: { value: new THREE.Vector4() },
          uBlob: { value: new THREE.Vector4() },
          uLevel: { value: new THREE.Vector4() },
          uLift: { value: 0 },
          uFieldW: { value: new THREE.Vector2() },
          uJitter: { value: 0 },
          uColour: { value: new THREE.Vector4() },
          uLam: { value: new THREE.Vector4() },
          uBump: { value: 0 },
          uKeyPos: { value: new THREE.Vector3() },
          uKey: { value: new THREE.Vector4() },
          uFillPos: { value: new THREE.Vector3() },
          uFill: { value: new THREE.Vector2() },
          uDiffuse: { value: 0 },
          uTone: { value: new THREE.Vector2() },
        };

        const vertShader = `
                varying vec2 vUv;
                varying vec3 vWP;
                varying vec3 vWN;
                varying vec3 vWT;
                void main() {
                    vUv = uv;
                    vec4 wp = modelMatrix * vec4(position, 1.0);
                    vWP = wp.xyz;
                    vWN = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
                    vWT = normalize(mat3(modelMatrix) * vec3(1.0, 0.0, 0.0));
                    gl_Position = projectionMatrix * viewMatrix * wp;
                }
            `;

        const fragShader = `
                precision highp float;
                uniform sampler2D uMap;
                uniform vec2 uCard;
                uniform vec2 uPtr;
                uniform float uHover;
                uniform float uTime;
                uniform float uRadius;
                uniform vec4 uFlake;
                uniform vec4 uFlake2;
                uniform vec4 uAmp;
                uniform vec4 uField;
                uniform vec4 uBlob;
                uniform vec4 uLevel;
                uniform float uLift;
                uniform vec2 uFieldW;
                uniform float uJitter;
                uniform vec4 uColour;
                uniform vec4 uLam;
                uniform float uBump;
                uniform vec3 uKeyPos;
                uniform vec4 uKey;
                uniform vec3 uFillPos;
                uniform vec2 uFill;
                uniform float uDiffuse;
                uniform vec2 uTone;
                varying vec2 vUv;
                varying vec3 vWP;
                varying vec3 vWN;
                varying vec3 vWT;

                float hash1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
                vec3 hash3(vec2 p) {
                    vec3 q = vec3(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)), dot(p, vec2(419.2, 371.9)));
                    return fract(sin(q) * 43758.5453123);
                }
                float vnoise(vec2 p) {
                    vec2 i = floor(p), f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);
                    float a = hash1(i), b = hash1(i + vec2(1.0, 0.0));
                    float c = hash1(i + vec2(0.0, 1.0)), d = hash1(i + vec2(1.0, 1.0));
                    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
                }
                float fbm(vec2 p) {
                    float s = 0.0, a = 0.5;
                    for (int i = 0; i < 4; i++) {
                        s += a * vnoise(p);
                        p = p * 2.03 + 17.13;
                        a *= 0.5;
                    }
                    return s / 0.9375;
                }
                vec3 spectrum(float t) {
                    return 0.5 + 0.5 * cos(6.2831853 * (t + vec3(0.0, 0.3333, 0.6667)));
                }
                float laminate(vec2 p, float grain) {
                    return vnoise(p / uLam.x) * uLam.y * uLam.x + vnoise(p / uLam.z) * uLam.w * uLam.z * grain;
                }
                vec3 flakes(vec2 P, float cell, float mask, float hue0, float texel, float seed) {
                    vec2 g = P / cell;
                    vec2 gi = floor(g), gf = fract(g);
                    vec3 sum = vec3(0.0);
                    for (int j = -1; j <= 1; j++) {
                        for (int i = -1; i <= 1; i++) {
                            vec2 o = vec2(float(i), float(j));
                            vec3 h = hash3(gi + o + seed);
                            float appear = smoothstep(h.z - uAmp.w, h.z + uAmp.w, mask);
                            if (appear <= 0.002) continue;
                            vec2 d = (gf - (o + 0.5 + (h.xy - 0.5) * uJitter)) * cell;
                            float r = fract(h.z * 37.31);
                            float rr = max((uFlake.y + uFlake.z * pow(r, uFlake.w)) * cell / uFlake.x, texel * 0.75);
                            float x = dot(d, d) / (rr * rr);
                            float fall = (exp(-x) * (1.0 - uFlake2.z) + exp(-x * 4.5) * uFlake2.z) / (1.0 - uFlake2.z + uFlake2.z / 4.5);
                            float bright = fract(h.x * 13.77 + h.y * 7.19);
                            if (bright > 0.93) {
                                float a = h.y * 6.2831853;
                                vec2 dr = vec2(d.x * cos(a) - d.y * sin(a), d.x * sin(a) + d.y * cos(a));
                                fall += exp(-(dr.x * dr.x / (rr * rr * 11.0) + dr.y * dr.y / (rr * rr * 0.05))) * uFlake2.w;
                            }
                            float amp = appear * (uAmp.x + uAmp.y * pow(bright, uAmp.z));
                            float hue = fract(hue0 + uColour.z * fract(h.x * 3.11 + h.y * 1.73));
                            sum += mix(vec3(1.0), spectrum(hue), uColour.x) * fall * amp;
                        }
                    }
                    return sum;
                }
                void main() {
                    vec4 tex = texture2D(uMap, vUv);
                    vec3 art = tex.rgb / max(tex.a, 0.001);
                    vec2 P = vec2(vUv.x, 1.0 - vUv.y) * uCard;
                    vec2 q = P / uField.x + uPtr * uField.y + vec2(uTime * uField.z, uTime * -uField.z * 0.6);
                    vec2 sheen = (vec2(0.5) + uPtr * 0.5 * uBlob.xy) * uCard;
                    float near = 1.0 - smoothstep(uBlob.z, uBlob.w, distance(P, sheen));
                    float n = clamp((fbm(q) - 0.5) * uFieldW.y + 0.5, 0.0, 1.0);
                    float level = n * uFieldW.x + near * uField.w + uLift * smoothstep(uLevel.z, uLevel.w, uPtr.y);
                    float mask = smoothstep(uLevel.x, uLevel.y, level) * uHover;
                    float texel = max(fwidth(P.x), fwidth(P.y));
                    float hue0 = uColour.y * (P.x * 0.7 + P.y) / uCard.y + uColour.w * (uPtr.x + uPtr.y * 0.7) + uTime * 0.017;
                    vec3 sparkle = flakes(P, uFlake.x, mask, hue0, texel, 0.0);
                    float fine = uFlake2.y * smoothstep(uFlake2.x * 0.60, uFlake2.x * 0.30, texel);
                    if (fine > 0.004) {
                        sparkle += flakes(P, uFlake2.x, mask, hue0 + 0.37, texel, 31.7) * fine;
                    }
                    float peak = max(max(sparkle.r, sparkle.g), sparkle.b);
                    sparkle = max(sparkle, 0.0) / max(peak, 1.0);
                    float head = 1.0 - dot(art, vec3(0.299, 0.587, 0.114));
                    sparkle *= mix(1.0, min(1.0, uTone.y / max(head, 0.05)), uTone.x);

                    vec3 N = normalize(vWN);
                    vec3 Tn = normalize(vWT);
                    vec3 Bn = cross(N, Tn);
                    float e = max(1.5, texel * 0.9);
                    float grain = smoothstep(uLam.z * 1.10, uLam.z * 0.45, texel);
                    float gx = (laminate(P + vec2(e, 0.0), grain) - laminate(P - vec2(e, 0.0), grain)) / (2.0 * e);
                    float gy = (laminate(P + vec2(0.0, e), grain) - laminate(P - vec2(0.0, e), grain)) / (2.0 * e);
                    N = normalize(N - (Tn * gx - Bn * gy) * uBump);

                    vec3 V = normalize(cameraPosition - vWP);
                    vec3 Lk = normalize(uKeyPos - vWP);
                    vec3 Hk = normalize(Lk + V);
                    float dk = max(dot(N, Hk), 0.0);
                    vec3 shine = vec3(1.0, 0.985, 0.955) * pow(dk, uKey.x) * uKey.y + vec3(1.0, 0.97, 0.93) * pow(dk, uKey.z) * uKey.w;

                    vec3 Lf = normalize(uFillPos - vWP);
                    vec3 Hf = normalize(Lf + V);
                    shine += vec3(0.70, 0.83, 1.0) * pow(max(dot(N, Hf), 0.0), uFill.x) * uFill.y;
                    shine = clamp(shine, 0.0, 1.0);
                    art *= 1.0 + uDiffuse * (dot(N, Lk) - 0.72);

                    vec3 col = 1.0 - (1.0 - art) * (1.0 - sparkle);
                    col = 1.0 - (1.0 - col) * (1.0 - shine);

                    vec2 ed = abs(vUv - 0.5) * uCard - (uCard * 0.5 - vec2(uRadius));
                    float sd = length(max(ed, 0.0)) + min(max(ed.x, ed.y), 0.0) - uRadius;
                    float aa = max(fwidth(sd), 0.0001);
                    vec3 lit = 1.0 - (1.0 - sparkle) * (1.0 - shine);
                    float body = max(max(lit.r, lit.g), lit.b) * uHover;
                    float alpha = (1.0 - smoothstep(-aa, aa, sd)) * max(tex.a, body);
                    if (alpha <= 0.002) discard;
                    gl_FragColor = vec4(clamp(col, 0.0, 1.0), alpha);
                }
            `;

        card.card = new THREE.Mesh(
          new THREE.PlaneGeometry(1, 1),
          new THREE.ShaderMaterial({
            uniforms: card.U,
            vertexShader: vertShader,
            fragmentShader: fragShader,
            transparent: true,
            depthWrite: false,
            extensions: { derivatives: true },
          }),
        );
        scene.add(card.card);

        card.layout = () => {
          const cw = zc.clientWidth || zc.getBoundingClientRect().width;
          if (!cw) return;
          const ch = cw / 0.75;
          const holoW = holoCanvas.clientWidth || 1.16 * cw;
          const holoH = holoCanvas.clientHeight || 1.12 * ch;
          card.CW = cw;
          card.CH = ch;

          const dist = 3.95 * cw;
          camera.fov = (2 * Math.atan(holoH / (2 * dist)) * 180) / Math.PI;
          camera.aspect = holoW / holoH;
          camera.position.set(0, 0, dist);
          camera.updateProjectionMatrix();

          card.card.scale.set(cw, ch, 1);
          card.U.uKeyPos.value.set(
            uniformDefaults.keyX * cw,
            uniformDefaults.keyY * cw,
            uniformDefaults.keyZ * cw,
          );
          card.U.uFillPos.value.set(
            uniformDefaults.fillX * cw,
            uniformDefaults.fillY * cw,
            uniformDefaults.fillZ * cw,
          );
          updateUniforms(card);
          renderer.setSize(holoW, holoH, false);
          card.dirty = true;
        };
        card.layout();

        if (typeof ResizeObserver !== 'undefined') {
          card.ro = new ResizeObserver(() => {
            card.layout();
            startTick();
          });
          card.ro.observe(zc);
        }

        const onPointerMove = (cx, cy) => {
          const rect = zc.getBoundingClientRect();
          const px = (cx - (rect.left + rect.width / 2)) / (rect.width / 2);
          const py = (cy - (rect.top + rect.height / 2)) / (rect.height / 2);
          if (px < -1 || px > 1 || py < -1 || py > 1) {
            card.tgt.h = 0;
            startTick();
            return;
          }
          card.tgt.x = px;
          card.tgt.y = py;
          card.tgt.h = 1;
          startTick();
        };
        const onPointerLeave = () => {
          card.tgt.h = 0;
          startTick();
        };

        btnElement.addEventListener('pointermove', (e) => onPointerMove(e.clientX, e.clientY), {
          passive: true,
        });
        btnElement.addEventListener('pointerdown', (e) => onPointerMove(e.clientX, e.clientY), {
          passive: true,
        });
        btnElement.addEventListener('pointerleave', onPointerLeave);
        btnElement.addEventListener('pointercancel', onPointerLeave);
        btnElement.addEventListener('pointerup', (e) => {
          if (e.pointerType !== 'mouse') onPointerLeave();
        });
        btnElement.addEventListener('focus', () => {
          let focusVis = false;
          try {
            focusVis = btnElement.matches(':focus-visible');
          } catch (_) {}
          if (focusVis) {
            card.tgt.x = 0;
            card.tgt.y = 0;
            card.tgt.h = 1;
            startTick();
          }
        });
        btnElement.addEventListener('blur', onPointerLeave);

        if (typeof IntersectionObserver !== 'undefined') {
          card.io = new IntersectionObserver(
            (entries) => {
              card.visible = !entries[0] || entries[0].isIntersecting;
              if (card.visible) {
                card.dirty = true;
                startTick();
              }
            },
            { rootMargin: '80px' },
          );
          card.io.observe(zc);
        }

        activeCards.push(card);
        startTick();
      }

      function sweep(all) {
        for (let i = activeCards.length - 1; i >= 0; i--) {
          const c = activeCards[i];
          if (all || !c.btn.isConnected) {
            destroyCard(c);
            activeCards.splice(i, 1);
          }
        }
      }

      return {
        attach: attach,
        sweep: sweep,
        ready: () => activeCards.length > 0 && activeCards.every((c) => c.ready),
      };
    })();

    function createIntroController(swirlEngine, appState, soundEngine) {
      const state = appState || { mode: 'hero', t: 0, reduced: false };
      const isCoarse =
        typeof window !== 'undefined' &&
        ((window.matchMedia && window.matchMedia('(pointer:coarse)').matches) ||
          Math.min(window.innerWidth, window.innerHeight) < 720);

      const TOTAL_PARTICLES = isCoarse ? 2300 : 3800;
      const DENSITY_RATIO = isCoarse ? 0.12 : 0.2;
      const wrapAngle = (e) => e - TAU * Math.round(e / TAU);

      const T_ARRIVE_PHASE1 = 4.05;
      const T_OUT = 5.9;
      const T_SPIRAL = 1.6;
      const T_CLUSTER_OFFSET = 0.16;
      const SPIRAL_TILT = (-4.5 * Math.PI) / 180;

      const curveP = [
        [0, 0],
        [0.195, 0.08],
        [0.39, 0.24],
        [0.488, 0.36],
        [0.585, 0.46],
        [0.683, 0.55],
        [0.78, 0.66],
        [0.878, 0.8],
        [0.976, 0.95],
        [1, 1],
      ];
      const curveG = [
        [0, 0],
        [0.09, 0.11],
        [0.18, 0.27],
        [0.27, 0.35],
        [0.36, 0.43],
        [0.45, 0.56],
        [0.55, 0.67],
        [0.64, 0.73],
        [0.73, 0.88],
        [0.82, 0.95],
        [0.91, 0.97],
        [1, 1],
      ];

      function evalCurveP(t) {
        t = clamp(t, 0, 1);
        for (let i = 1; i < curveP.length; i++) {
          const p0 = curveP[i - 1],
            p1 = curveP[i];
          if (t <= p1[0]) return p0[1] + ((p1[1] - p0[1]) * (t - p0[0])) / (p1[0] - p0[0]);
        }
        return 1;
      }

      function evalCurveG(curve, t) {
        for (let i = 1; i < curve.length; i++) {
          const p0 = curve[i - 1],
            p1 = curve[i];
          if (t <= p1[1]) return p0[0] + ((p1[0] - p0[0]) * (t - p0[1])) / (p1[1] - p0[1] || 1e-9);
        }
        return 1;
      }

      let cv = null;
      let glPipeline = null;
      let isPrepared = false;
      let isRunning = false;
      let rafId = 0;
      let t0 = 0;
      let outStarted = false;
      let leaving = false;
      let resolvePromise = null;
      let reduced = false;
      let rot0 = 0;
      let phi0 = 0;
      let tArrive = 0;

      let W = 1;
      let H = 1;
      let dpr = 1;
      let gx = 0;
      let gy = 0;
      let R = 1;
      let wcx = 0;
      let wcy = 0;
      let wr = 1;
      let wfit = 1;
      const tmp = [0, 0];

      const b = (size) => new Float32Array(size);
      const x = {
        x: b(TOTAL_PARTICLES),
        y: b(TOTAL_PARTICLES),
        s: b(TOTAL_PARTICLES),
        a: b(TOTAL_PARTICLES),
        t: b(TOTAL_PARTICLES),
        fu: b(TOTAL_PARTICLES),
        fv: b(TOTAL_PARTICLES),
        fx: b(TOTAL_PARTICLES),
        fy: b(TOTAL_PARTICLES),
        fd: b(TOTAL_PARTICLES),
        fs: b(TOTAL_PARTICLES),
        fa: b(TOTAL_PARTICLES),
        rs: b(TOTAL_PARTICLES),
        rc: b(TOTAL_PARTICLES),
        ths: b(TOTAL_PARTICLES),
        thc: b(TOTAL_PARTICLES),
        st: b(TOTAL_PARTICLES),
        cls: new Uint8Array(TOTAL_PARTICLES),
        wk: new Int16Array(TOTAL_PARTICLES),
        hx: b(TOTAL_PARTICLES),
        hy: b(TOTAL_PARTICLES),
        ox: b(TOTAL_PARTICLES),
        oy: b(TOTAL_PARTICLES),
        hs: b(TOTAL_PARTICLES),
        ha: b(TOTAL_PARTICLES),
        hk: new Uint8Array(TOTAL_PARTICLES),
        rb: b(TOTAL_PARTICLES),
        d2: b(TOTAL_PARTICLES),
        da: b(TOTAL_PARTICLES),
        dw1: b(TOTAL_PARTICLES),
        dw2: b(TOTAL_PARTICLES),
        dp1: b(TOTAL_PARTICLES),
        dp2: b(TOTAL_PARTICLES),
        tw: b(TOTAL_PARTICLES),
        tp: b(TOTAL_PARTICLES),
        ta: b(TOTAL_PARTICLES),
      };

      const packedParts = b(5 * TOTAL_PARTICLES);
      const packedLines = b(960);
      let lineCount = 0;
      const packedSpikes = b(800);
      let spikeCount = 0;
      const linesDesc = [];
      const spikesDesc = [];

      const rng = createPrng(7777);
      const gaussianRand = () => {
        let u = 0,
          v = 0;
        while (u === 0) u = rng();
        while (v === 0) v = rng();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
      };

      const radiusArr = b(TOTAL_PARTICLES);
      for (let t = 0; t < TOTAL_PARTICLES; t++) {
        radiusArr[t] = Math.pow(evalCurveG(curveG, rng()), 0.68);
      }
      radiusArr.sort();

      for (let t = 0; t < TOTAL_PARTICLES; t++) {
        const a = t % 3;
        const n = Math.max(0.012, radiusArr[t] * (a ? 0.9 : 1));
        const isInner = n < 0.08;
        let l = isInner
          ? rng() * TAU
          : (a * TAU) / 3 + 4.6 * Math.log(n / 0.05) + gaussianRand() * (0.07 + 0.12 * n);
        if (!isInner && rng() < 0.08) {
          l += 0.8 * (rng() - 0.5);
        }
        x.rs[t] = n;
        x.ths[t] = l;
        x.thc[t] = l + (rng() * TAU) / 3;
        x.rc[t] = 0.9 * n + 0.01;

        const c = rng();
        let h;
        h =
          n < 0.12
            ? c < 0.85
              ? 0
              : 1
            : c < 0.74
              ? 0
              : c < 0.86
                ? 1
                : c < 0.86 + 0.09 * n
                  ? 3
                  : c < 0.975
                    ? 2
                    : 4;
        x.cls[t] = h;

        if (h === 0) {
          x.fs[t] = 0.7 + 0.5 * rng();
          x.fa[t] = (0.13 + 0.19 * rng()) * (n < 0.12 ? 1.6 : 1);
        } else if (h === 1) {
          x.fs[t] = 1 + 0.7 * rng();
          x.fa[t] = 0.32 + 0.22 * rng();
        } else if (h === 3) {
          x.fs[t] = 2.6 + 1 * rng();
          x.fa[t] = 0.9 + 0.1 * rng();
        } else if (h === 2) {
          x.fs[t] = 1.8 + 0.8 * rng();
          x.fa[t] = 0.4 + 0.15 * rng();
        } else {
          x.fs[t] = 7 + 5 * rng();
          x.fa[t] = 0.07 + 0.06 * rng();
        }

        const d = rng();
        x.t[t] = d < 0.65 ? 0.42 + 0.16 * rng() : d < 0.92 ? 0.14 * rng() : 0.9 + 0.1 * rng();
        if (rng() < 0.06) x.t[t] = 0.9 + 0.1 * rng();

        x.fu[t] = 1.16 * rng() - 0.08;
        x.fv[t] = 1.16 * rng() - 0.08;
        x.st[t] = rng();
        x.da[t] = 0.6 + 1.2 * rng();
        x.dw1[t] = 0.12 + 0.28 * rng();
        x.dw2[t] = 0.12 + 0.28 * rng();
        x.dp1[t] = rng() * TAU;
        x.dp2[t] = rng() * TAU;
        x.tw[t] = 0.5 + 2.2 * rng();
        x.tp[t] = rng() * TAU;
        x.ta[t] = h >= 2 ? 0.16 : 0.22 + 0.14 * rng();
        x.hk[t] = 0;
        x.hs[t] = x.fs[t];
        x.ha[t] = x.fa[t];
        x.wk[t] = -1;
      }

      const figs = swirlEngine && swirlEngine.figs ? swirlEngine.figs : NORMALIZED_FIGURES;
      const zodiacSet = new Set([
        'aries',
        'taurus',
        'gemini',
        'cancer',
        'leo',
        'virgo',
        'libra',
        'scorpio',
        'sagittarius',
        'capricorn',
        'aquarius',
        'pisces',
      ]);
      const zodiacFigs = figs.filter((fig) => zodiacSet.has(fig.key));
      const figsList = zodiacFigs.length ? zodiacFigs : figs.slice(0, 12);

      let particleIdx = 0;
      for (let t = 0; t < figsList.length; t++) {
        const s = figsList[t];
        const knotIndices = [];
        for (let n = 0; n < s.norm.length; n++) {
          const [cx, cy, cu] = s.norm[n];
          let m = particleIdx++;
          knotIndices[n] = m;
          spikesDesc.push({ i: m, m: cu, k: t });
          x.wk[m] = t;
          x.hk[m] = 3;
          x.hx[m] = cx;
          x.hy[m] = cy;
          x.ox[m] = 0;
          x.oy[m] = 0;
          x.hs[m] = 2 + 0.9 * cu;
          x.ha[m] = 1;

          const haloCount = Math.round((16 + 20 * cu) * DENSITY_RATIO);
          const haloRadius = 1.8 + 2.2 * cu;
          for (let n = 0; n < haloCount; n++) {
            m = particleIdx++;
            x.wk[m] = t;
            x.hk[m] = 2;
            x.hx[m] = cx;
            x.hy[m] = cy;
            const dist = Math.abs(gaussianRand()) * haloRadius + 0.9;
            const angle = rng() * TAU;
            x.ox[m] = Math.cos(angle) * dist;
            x.oy[m] = Math.sin(angle) * dist;
            x.hs[m] = 0.45 + 0.85 * rng();
            x.ha[m] = (0.3 + 0.5 * rng()) * clamp(1.4 - dist / (2.2 * haloRadius), 0.35, 1);
          }
        }

        s.lines.forEach(([aIdx, bIdx], lineIdx) => {
          linesDesc.push({ k: t, j: lineIdx, ia: knotIndices[aIdx], ib: knotIndices[bIdx] });
          const ptA = s.norm[aIdx];
          const ptB = s.norm[bIdx];
          const segCount = Math.max(
            2,
            Math.round(
              ((300 * Math.hypot(ptB[0] - ptA[0], ptB[1] - ptA[1])) / 5.5) * DENSITY_RATIO,
            ),
          );
          for (let a = 0; a < segCount; a++) {
            const m = particleIdx++;
            const frac = (a + 0.5) / segCount;
            x.wk[m] = t;
            x.hk[m] = 1;
            x.hx[m] = lerp(ptA[0], ptB[0], frac);
            x.hy[m] = lerp(ptA[1], ptB[1], frac);
            x.ox[m] = 1.4 * gaussianRand();
            x.oy[m] = 1.4 * gaussianRand();
            x.hs[m] = 0.38 + 0.5 * rng();
            x.ha[m] = 0.22 + 0.34 * rng();
          }
        });

        for (const cluster of s.normClusters || []) {
          const clusterCount = Math.round(cluster.n * DENSITY_RATIO);
          for (let sIdx = 0; sIdx < clusterCount; sIdx++) {
            const m = particleIdx++;
            x.wk[m] = t;
            x.hk[m] = 2;
            x.hx[m] = cluster.x;
            x.hy[m] = cluster.y;
            const dist = Math.abs(gaussianRand()) * cluster.r * 0.4 + 0.6;
            const angle = rng() * TAU;
            x.ox[m] = Math.cos(angle) * dist;
            x.oy[m] = Math.sin(angle) * dist;
            x.hs[m] = 0.5 + 1.3 * rng();
            x.ha[m] = 0.45 + 0.5 * rng();
          }
        }
      }

      function resizeLayout() {
        if (typeof window === 'undefined') return;
        W = Math.max(1, window.innerWidth);
        H = Math.max(1, window.innerHeight);
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        gx = 0.5 * W;
        gy = 0.575 * H;
        R = Math.min(0.46 * H, 0.44 * W);
        const ringDiam = 0.574 * Math.min(W, H);
        wcx = W / 2;
        wcy = H / 2;
        wr = 0.8 * ringDiam;
        wfit = 0.115 * ringDiam;

        const angleArr = b(TOTAL_PARTICLES);
        const sortAngleIdx = new Int32Array(TOTAL_PARTICLES);
        const sortThetaIdx = new Int32Array(TOTAL_PARTICLES);
        const thetaArr = b(TOTAL_PARTICLES);
        const screenXArr = b(TOTAL_PARTICLES);
        const screenYArr = b(TOTAL_PARTICLES);

        for (let e = 0; e < TOTAL_PARTICLES; e++) {
          const sx = (1.16 * x.fu[e] - 0.08) * W;
          const sy = (1.16 * x.fv[e] - 0.08) * H;
          screenXArr[e] = sx;
          screenYArr[e] = sy;
          angleArr[e] = Math.atan2(sy - gy, sx - gx);
          sortAngleIdx[e] = e;
          thetaArr[e] = wrapAngle(x.thc[e]);
          sortThetaIdx[e] = e;
        }

        sortAngleIdx.sort((a, b) => angleArr[a] - angleArr[b]);
        sortThetaIdx.sort((a, b) => thetaArr[a] - thetaArr[b]);

        for (let e = 0; e < TOTAL_PARTICLES; e++) {
          x.fx[sortThetaIdx[e]] = screenXArr[sortAngleIdx[e]];
          x.fy[sortThetaIdx[e]] = screenYArr[sortAngleIdx[e]];
        }

        const diag = Math.hypot(0.62 * W, 0.62 * H);
        for (let e = 0; e < TOTAL_PARTICLES; e++) {
          x.fd[e] = Math.hypot(x.fx[e] - gx, x.fy[e] - gy) / diag;
        }

        if (glPipeline) glPipeline.resize(W, H, dpr);
      }

      function projectParticle(e, t, out) {
        if (x.hk[e] === 0) {
          out[0] = x.fx[e];
          out[1] = x.fy[e];
          return;
        }
        const n = -Math.PI / 2 + (x.wk[e] * TAU) / 12 + t;
        const cosT = Math.cos(t);
        const sinT = Math.sin(t);
        const circleX = wcx + Math.cos(n) * wr;
        const circleY = wcy + Math.sin(n) * wr;
        const px = x.hx[e] * wfit + x.ox[e];
        const py = x.hy[e] * wfit + x.oy[e];
        out[0] = circleX + px * cosT - py * sinT;
        out[1] = circleY + px * sinT + py * cosT;
      }

      const sizeMod = (cls, t) =>
        cls === 0 ? lerp(1, 4.2, t) : cls === 1 ? lerp(1, 2, t) : cls === 2 ? lerp(1, 1.5, t) : 1;

      function renderFrame(timestamp) {
        if (!isRunning) return;
        rafId = requestAnimationFrame(renderFrame);

        if (!leaving && state && state.mode !== 'hero' && state.mode !== 'loading') {
          leaving = true;
          if (cv) cv.classList.add('off');
          setTimeout(stop, 1000);
        }

        const t = (timestamp - t0) / 1000;
        const r = timestamp / 1000;
        const phi = 0.06 * (state ? state.t : t);

        const P = smoothstep(clamp((t - 0.72) / (1.15 - 0.72), 0, 1));
        const q = (t - 2) / 2.05;
        const W_val = evalCurveP(q);
        const B = clamp((t - T_ARRIVE_PHASE1) / (4.9 - T_ARRIVE_PHASE1), 0, 1);
        const z = 1 - (1 - B) * (1 - B);
        const O = SPIRAL_TILT * Math.max(0, t - T_ARRIVE_PHASE1);

        if (t >= T_OUT && !outStarted) {
          outStarted = true;
          rot0 = O;
          phi0 = phi;
          for (let e = 0; e < TOTAL_PARTICLES; e++) {
            projectParticle(e, phi, tmp);
            const dx = tmp[0] - gx;
            const dy = tmp[1] - gy;
            const n = Math.max(Math.hypot(dx, dy), 0.5);
            const o = Math.atan2(dy, dx);
            const s = Math.max(x.rs[e] * R, 0.5);
            x.rb[e] = n;
            x.d2[e] = wrapAngle(o - (x.ths[e] + 4.6 * Math.log(n / s)) - O);
          }
          if (resolvePromise) {
            resolvePromise();
            resolvePromise = null;
          }
          if (typeof document !== 'undefined') {
            document.body.classList.remove('introdark');
          }
        }

        if (soundEngine && !reduced && typeof soundEngine.report === 'function') {
          soundEngine.report(
            'intro',
            t < 2
              ? 0
              : t < 4.05
                ? 0.25 + 0.55 * W_val
                : t < 4.9
                  ? 0.85
                  : t < T_OUT
                    ? 0.3
                    : 0.9 * Math.sin(Math.PI * clamp((t - T_OUT) / 1.76, 0, 1)),
          );
        }

        const H_val = reduced ? 0 : easeOutCubic(clamp((t - tArrive) / 1.5, 0, 1));
        const D = 1 - easeOutCubic(clamp((t - tArrive - 0.4) / 2.5, 0, 1));
        const G = phi - phi0 - (O - rot0);

        for (let e = 0; e < TOTAL_PARTICLES; e++) {
          const s = reduced ? 1 : 1 + x.ta[e] * Math.sin(r * x.tw[e] + x.tp[e]);
          let px, py, pSize, pAlpha;

          if (t < T_OUT) {
            const o = evalCurveP(q + 0.06 * (x.fd[e] - 0.5) + 0.05 * (x.st[e] - 0.5));
            let sx, sy;
            if (o < 1) {
              const radius = x.rc[e] * R;
              const angle = x.thc[e] - 0.12 * o;
              sx = lerp(x.fx[e] - gx, Math.cos(angle) * radius, o);
              sy = lerp(x.fy[e] - gy, Math.sin(angle) * radius, o);
            } else {
              const step = clamp((t - T_ARRIVE_PHASE1 - 0.3 * (1 - x.rs[e])) / 0.55, 0, 1);
              const i = 1 - (1 - step) * (1 - step);
              const radius = lerp(x.rc[e], x.rs[e], i) * R;
              const angle = x.ths[e] + (x.thc[e] - x.ths[e]) * (1 - i) + O;
              sx = Math.cos(angle) * radius;
              sy = Math.sin(angle) * radius;
            }
            px = gx + sx;
            py = gy + sy;
            pSize = x.fs[e];
            pAlpha = x.fa[e] * P * sizeMod(x.cls[e], o);
          } else {
            const step = clamp((t - T_OUT - x.st[e] * T_CLUSTER_OFFSET) / T_SPIRAL, 0, 1);
            projectParticle(e, phi, tmp);
            if (step < 1) {
              const easeStep = easeOutCubic(step);
              const quadStep = 1 - (1 - step) * (1 - step);
              const l = easeOutCubic(clamp((step - 0.28) / 0.72, 0, 1));
              const h = easeOutCubic(clamp((step - 0.62) / 0.38, 0, 1));
              const d = Math.max(x.rs[e] * R, 0.5);
              const u = Math.max(lerp(d, x.rb[e], easeStep), 0.5);
              const m = x.ths[e] + 4.6 * Math.log(u / d) + O + (x.d2[e] + G) * l;
              const targetX = gx + Math.cos(m) * u;
              const targetY = gy + Math.sin(m) * u;
              px = lerp(targetX, tmp[0], h);
              py = lerp(targetY, tmp[1], h);
              pSize = lerp(x.fs[e], x.hs[e], easeStep);
              pAlpha = lerp(x.fa[e] * sizeMod(x.cls[e], 1), x.ha[e], quadStep);
            } else {
              const amp = x.da[e] * (x.hk[e] ? 0.55 : 1) * H_val;
              px = tmp[0] + Math.sin(r * x.dw1[e] + x.dp1[e]) * amp;
              py = tmp[1] + Math.cos(r * x.dw2[e] + x.dp2[e]) * amp;
              pSize = x.hs[e];
              pAlpha = x.ha[e];
            }
            if (x.hk[e] === 0) {
              pAlpha *= D;
            }
          }

          x.x[e] = px;
          x.y[e] = py;
          x.s[e] = pSize;
          x.a[e] = pAlpha * s;
        }

        for (let e = 0, pIdx = 0; e < TOTAL_PARTICLES; e++, pIdx += 5) {
          packedParts[pIdx] = x.x[e];
          packedParts[pIdx + 1] = x.y[e];
          packedParts[pIdx + 2] = x.s[e];
          packedParts[pIdx + 3] = x.a[e];
          packedParts[pIdx + 4] = x.t[e];
        }

        lineCount = 0;
        spikeCount = 0;

        if (t >= tArrive) {
          const arrivalDt = t - tArrive;
          const lineFade = lerp(1, 0.36, easeOutCubic(clamp((arrivalDt - 3.6) / 1.8, 0, 1)));
          for (const line of linesDesc) {
            if (lineCount >= 160) break;
            const progress = smoothstep(
              clamp((arrivalDt - 0.06 * line.k - 0.04 * line.j) / 0.72, 0, 1),
            );
            if (progress <= 0) continue;
            const ax = x.x[line.ia],
              ay = x.y[line.ia];
            const bx = x.x[line.ib],
              by = x.y[line.ib];
            const alpha = 0.3 * lineFade;
            const offset = 6 * lineCount;
            packedLines[offset] = ax;
            packedLines[offset + 1] = ay;
            packedLines[offset + 2] = alpha;
            packedLines[offset + 3] = lerp(ax, bx, progress);
            packedLines[offset + 4] = lerp(ay, by, progress);
            packedLines[offset + 5] = alpha;
            lineCount++;
          }
        }

        const spikeProgress = clamp((t - T_OUT - 1.15) / 0.45, 0, 1);
        if (spikeProgress > 0) {
          for (const spike of spikesDesc) {
            if (spikeCount >= 160) break;
            const offset = 5 * spikeCount;
            packedSpikes[offset] = x.x[spike.i];
            packedSpikes[offset + 1] = x.y[spike.i];
            packedSpikes[offset + 2] = Math.min(
              0.45 * (30 + 28 * spike.m),
              (glPipeline.maxPoint || 64) / dpr,
            );
            packedSpikes[offset + 3] = 0.72 * x.a[spike.i] * spikeProgress;
            packedSpikes[offset + 4] = x.t[spike.i];
            spikeCount++;
          }
        }

        const glowAlpha = (0.12 * W_val + 0.34 * z) * (1 - clamp((t - T_OUT) / 0.9, 0, 1));
        glPipeline.draw({
          parts: packedParts,
          n: TOTAL_PARTICLES,
          lines: packedLines,
          nl: lineCount,
          spikes: packedSpikes,
          ns: spikeCount,
          glow: glowAlpha,
          glowR: 0.62 * R,
          cx: gx,
          cy: gy,
        });
      }

      function prepare() {
        if (isPrepared || typeof document === 'undefined') return;
        cv = document.getElementById('introgl');
        if (!cv) {
          cv = document.createElement('canvas');
          cv.id = 'introgl';
          const skyCanvas = document.getElementById('sky');
          if (skyCanvas) {
            skyCanvas.insertAdjacentElement('afterend', cv);
          }
        }
        try {
          glPipeline = swirlEngine ? swirlEngine.mkGL(cv) : null;
        } catch (_) {
          glPipeline = null;
        }
        if (!glPipeline) {
          if (cv && !document.getElementById('introgl')) cv.remove();
          cv = null;
          document.body.classList.remove('introdark');
          return;
        }
        isPrepared = true;
        document.body.classList.add('introdark');
        window.addEventListener('resize', () => {
          if (isRunning) resizeLayout();
        });
      }

      function play() {
        if (!isPrepared) {
          if (typeof document !== 'undefined') {
            document.body.classList.remove('introdark');
          }
          return Promise.resolve();
        }
        reduced = !!(state && state.reduced);
        resizeLayout();
        isRunning = true;
        t0 = performance.now();
        outStarted = false;
        leaving = false;
        if (reduced) {
          t0 -= 7980;
          cv.style.transition = 'opacity .9s ease';
          cv.style.opacity = '0';
          requestAnimationFrame(() => {
            cv.style.opacity = '1';
          });
        }
        tArrive = 7.66;
        rafId = requestAnimationFrame(renderFrame);
        return new Promise((resolve) => {
          resolvePromise = resolve;
        });
      }

      function stop() {
        isRunning = false;
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
        if (glPipeline) glPipeline.clear();
        if (typeof document !== 'undefined') {
          document.body.classList.remove('introdark');
        }
        if (resolvePromise) {
          resolvePromise();
          resolvePromise = null;
        }
      }

      return {
        prepare: prepare,
        play: play,
        stop: stop,
        dbg: () => ({
          on: isRunning,
          out: outStarted,
          nl: lineCount,
          ns: spikeCount,
          leaving: leaving,
          reduced: reduced,
        }),
      };
    }

    class ReadingOverlay {
      constructor() {
        this.isOpen = false;
        this.currentSign = -1;
        this.prevSign = -1;
        this.fadeRatio = 1;
        this.t = 0;
        this.lastTime = 0;
        this.t0 = 0;

        this.W = 0;
        this.H = 0;
        this.dpr = 1;
        this.px = 0;
        this.py = 0;
        this.tpx = 0;
        this.tpy = 0;
        this.mx = -1;
        this.my = -1;
        this.hoveredRingIdx = -1;

        this.ringNodes = [];
        this.ambientStars = [];
        this.ambientParticles = [];
        this.scrollY = 0;
        this.sectionBounds = [];
        this.revealEls = [];
        this.ghostEls = [];
        this.raf = 0;
        this.timer = null;
        this.reduced = false;
        this.isLeaving = false;

        this.swirlEngine = null;
      }

      init(swirlEngine) {
        this.swirlEngine = swirlEngine;
        this._setupAmbientStars();
        this._bindDOM();
      }

      _setupAmbientStars() {
        const rng = createPrng(2026);
        for (let i = 0; i < 540; i++) {
          const s = Math.pow(rng(), 2.6);
          this.ambientStars.push({
            x: rng(),
            y: rng(),
            z: [0.3, 0.6, 1.0][(3 * rng()) | 0],
            r: 0.3 + 1.5 * s,
            b: 0.15 + 0.85 * s,
            c: STAR_PALETTE[(Math.pow(rng(), 2.2) * STAR_PALETTE.length) | 0],
            ph: rng() * TAU,
            sp: 0.3 + 1.2 * rng(),
          });
        }
        for (let i = 0; i < 34; i++) {
          this.ambientParticles.push({
            x: rng(),
            y: rng(),
            z: 0.3 + 0.7 * rng(),
            r: 6 + 18 * rng(),
            a: 0.03 + 0.07 * rng(),
            vx: 0.6 * (rng() - 0.5),
            vy: -0.3 - 0.7 * rng(),
            ph: rng() * TAU,
          });
        }
      }

      _bindDOM() {
        if (typeof document === 'undefined') return;
        const detailModal = document.getElementById('detail');
        const scrollContainer = document.getElementById('dscroll');
        const closeBtn = document.getElementById('dclose');

        if (closeBtn) {
          closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (SoundEngine && SoundEngine.reverse) SoundEngine.reverse();
            this.close();
          });
        }

        if (scrollContainer) {
          scrollContainer.addEventListener(
            'pointermove',
            (e) => {
              this.mx = e.clientX;
              this.my = e.clientY;
              this.tpx = 2 * (e.clientX / this.W - 0.5);
              this.tpy = 2 * (e.clientY / this.H - 0.5);
            },
            { passive: true },
          );

          scrollContainer.addEventListener('pointerleave', () => {
            this.mx = -1;
            this.my = -1;
          });

          scrollContainer.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.hoveredRingIdx >= 0 && this.ringNodes[this.hoveredRingIdx]) {
              this.switchSign(this.ringNodes[this.hoveredRingIdx].i);
            }
          });

          scrollContainer.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
        }

        window.addEventListener('resize', () => {
          if (this.isOpen) this.resizeCanvases();
        });
      }

      resizeCanvases() {
        if (typeof window === 'undefined') return;
        this.W = window.innerWidth;
        this.H = window.innerHeight;
        this.dpr = Math.min(window.devicePixelRatio || 1, 2);

        const vStars = document.getElementById('dstars');
        const uCon = document.getElementById('dcon');
        if (vStars && uCon) {
          vStars.width = Math.round(this.W * this.dpr);
          vStars.height = Math.round(this.H * this.dpr);
          uCon.width = Math.round(this.W * this.dpr);
          uCon.height = Math.round(this.H * this.dpr);

          const jCtx = vStars.getContext('2d');
          const kCtx = uCon.getContext('2d');
          jCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
          kCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        }

        if (this.isOpen) this._updateLayoutMetrics();
        if (this.swirlEngine) this.swirlEngine.layout();
      }

      _updateLayoutMetrics() {
        const pageEl = document.getElementById('dpage');
        if (!pageEl) return;
        const pageTop = pageEl.getBoundingClientRect().top;
        const getRelTop = (el) => el.getBoundingClientRect().top - pageTop;

        this.sectionBounds = [...pageEl.querySelectorAll('.dsec')].map((sec) => ({
          el: sec,
          k: +sec.dataset.k,
          top: getRelTop(sec),
          h: sec.offsetHeight,
        }));

        this.revealEls = [...pageEl.querySelectorAll('.rv')].map((el) => ({
          el: el,
          top: getRelTop(el),
          on: el.classList.contains('in'),
        }));
      }

      _renderTemplate(signIndex) {
        const c = CONSTELLATIONS[signIndex];
        if (!c) return;
        const profile = c.profile || {};
        const total = CONSTELLATIONS.length;
        const prevSign = CONSTELLATIONS[(signIndex + total - 1) % total];
        const nextSign = CONSTELLATIONS[(signIndex + 1) % total];

        const detailModal = document.getElementById('detail');
        const pageEl = document.getElementById('dpage');
        const ghostContainer = document.getElementById('dghost');

        if (detailModal) {
          detailModal.style.setProperty('--dacc', profile.acc || '#c4a99a');
        }

        const escapeHTML = (str) =>
          String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;');
        const renderTraitsList = (title, items) =>
          `<div><h3>${title}</h3><ul>${(items || []).map((t) => `<li>${escapeHTML(t)}</li>`).join('')}</ul></div>`;

        const getSymbolUrl = DataUtils.getPatternSymbolUrl;

        const renderNeighborCard = (nbSign, nbIdx, dir) => {
          const cardImg = resolveAsset(`cards/${nbSign.key}.webp`);
          return `<button class="zcard" data-go="${nbIdx}" data-key="${nbSign.key}" aria-label="${dir === 'prev' ? 'Previous sign' : 'Next sign'}: ${escapeHTML(nbSign.l1)}">
                    <span class="zc" aria-hidden="true">
                        <img class="zc-img" src="${cardImg}" alt="" decoding="async">
                        <canvas class="zc-holo"></canvas>
                    </span>
                    <span class="zc-cap">${dir === 'prev' ? '&larr; ' : ''}${escapeHTML(nbSign.l1)}${dir === 'next' ? ' &rarr;' : ''}</span>
                </button>`;
        };

        const cornerIcons = ['tl', 'tr', 'bl', 'br']
          .map(
            (pos) =>
              `<img class="bc ${pos}" src="${resolveAsset('https://hoirqrkdgbmvpwutwuwj.supabase.co/storage/v1/object/public/assets/assets/9b7e639b-e3c8-4e7c-84ac-4053ffd62e0b_original.png')}" alt="" aria-hidden="true">`,
          )
          .join('');

        const dividerImg = resolveAsset(
          'https://hoirqrkdgbmvpwutwuwj.supabase.co/storage/v1/object/public/assets/assets/eeec6e9c-0c13-434f-b1ef-af0f0deaff0f_original.png',
        );

        const field = (typeof NightSky !== 'undefined' &&
          NightSky.FieldContent &&
          NightSky.FieldContent[c.key]) || {
          intro: c.short,
          recognise: c.body,
          see: 'Learn the outline with your eyes.',
          expect: 'Dark skies reveal fainter stars.',
          story: c.l2,
          history: '',
        };
        ButtonGlow.detach(pageEl.querySelector('#readPlan'));
        pageEl.innerHTML = `<header class="dhero"><p class="dglyph rv"><img class="zsym" src="${getSymbolUrl(c.key)}" alt=""></p><h1 class="dname rv">${escapeHTML(c.l1)}</h1><p class="dtag rv">${escapeHTML(field.tagline || field.intro)}</p><p class="dhint rv">Scroll to read</p></header>
            <section class="dsec" data-k="1"><div class="dbox">${cornerIcons}<p class="eyebrow rv">STORY & HISTORY</p><p class="lead rv">${escapeHTML(field.story)}</p><p class="rv">${escapeHTML(field.history)}</p></div></section>
            <section class="dsec observing-section" data-k="2"><div class="dbox">${cornerIcons}<p class="eyebrow rv">OBSERVING</p><div class="observing-group"><h2 class="rv">How to find it</h2><p class="lead rv">${escapeHTML(field.recognise)}</p></div><div class="observing-group"><h2 class="rv">What you can see</h2><p class="rv">${escapeHTML(field.see)}</p><details class="observing-expect"><summary class="eyebrow">What to expect</summary><p>${escapeHTML(field.expect)}</p></details></div><button id="readPlan" type="button">Plan to see it ↗</button></div></section>
            <img class="dsep rv reading-bottom-divider" src="${dividerImg}" alt="">`;

        if (ghostContainer) {
          ghostContainer.innerHTML = []
            .map((g, idx) => `<span class="ghost" data-k="${idx + 1}">${escapeHTML(g)}</span>`)
            .join('');
          this.ghostEls = [...ghostContainer.children];
        }

        HoloCardRenderer.sweep();
        pageEl.querySelectorAll('.zcard').forEach((cardEl) => {
          HoloCardRenderer.attach(cardEl, { key: cardEl.dataset.key, reduced: this.reduced });
        });

        pageEl.querySelectorAll('[data-go]').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.switchSign(+btn.dataset.go);
          });
        });

        const observeButton = pageEl.querySelector('#readPlan');
        if (observeButton) {
          ButtonGlow.attach(observeButton);
          observeButton.addEventListener('click', (event) => {
            event.stopPropagation();
            this.close();
            NightSky.Guide?.observe(c.key);
          });
        }
        this._updateLayoutMetrics();
      }

      open(signIndex, reduced) {
        if (signIndex < 0 || signIndex >= CONSTELLATIONS.length) return;
        const modal = document.getElementById('detail');
        if (
          this.isOpen &&
          !this.isLeaving &&
          this.currentSign === signIndex &&
          modal?.classList.contains('open')
        )
          return;
        clearTimeout(this.timer);
        clearTimeout(this.swapTimer);
        if (this.raf) cancelAnimationFrame(this.raf);
        this.isLeaving = false;
        if (modal) modal.classList.remove('closing', 'leaving');
        this.reduced = !!reduced;
        this.resizeCanvases();
        this._renderTemplate(signIndex);

        this.currentSign = signIndex;
        this.prevSign = -1;
        this.fadeRatio = 1;
        this.hoveredRingIdx = -1;

        const compatTooltip = document.getElementById('dcompat');
        if (compatTooltip) compatTooltip.classList.remove('on');

        const scrollContainer = document.getElementById('dscroll');
        if (scrollContainer) scrollContainer.scrollTop = 0;
        this.scrollY = 0;

        const detailModal = document.getElementById('detail');
        if (detailModal) {
          detailModal.classList.add('open');
          detailModal.setAttribute('aria-hidden', 'false');
        }
        document.body.classList.add('reading');

        this.isOpen = true;
        this.t0 = performance.now();
        this.lastTime = this.t0;

        if (this.swirlEngine) {
          this.swirlEngine.open(signIndex, this.reduced);
        }

        try {
          history.replaceState(null, '', '#' + CONSTELLATIONS[signIndex].key + '/read');
        } catch (_) {}

        this._startRenderLoop();
      }

      close() {
        if (!this.isOpen || this.isLeaving) return;
        clearTimeout(this.timer);
        clearTimeout(this.swapTimer);

        const detailModal = document.getElementById('detail');
        const compatTooltip = document.getElementById('dcompat');

        this._finalizeClose();
      }

      _finalizeClose() {
        clearTimeout(this.timer);
        document.body.classList.remove('reading');

        const detailModal = document.getElementById('detail');
        const compatTooltip = document.getElementById('dcompat');
        if (detailModal) {
          detailModal.classList.remove('open');
          detailModal.classList.remove('closing', 'leaving');
          detailModal.setAttribute('aria-hidden', 'true');
        }
        if (compatTooltip) compatTooltip.classList.remove('on');
        this.isLeaving = false;

        this.isOpen = false;
        ButtonGlow.detach(document.getElementById('readPlan'));
        if (this.swirlEngine) this.swirlEngine.stop();
        HoloCardRenderer.sweep(true);
        if (this.raf) cancelAnimationFrame(this.raf);
        this.raf = 0;

        try {
          history.replaceState(null, '', '#' + CONSTELLATIONS[this.currentSign].key);
        } catch (_) {}

        const moreBtn = document.getElementById('pMore');
        if (moreBtn) moreBtn.focus({ preventScroll: true });
      }

      switchSign(newSignIndex) {
        if (newSignIndex === this.currentSign || !this.isOpen) return;
        const pageEl = document.getElementById('dpage');
        const compatTooltip = document.getElementById('dcompat');
        if (pageEl) pageEl.classList.add('swap');
        if (compatTooltip) compatTooltip.classList.remove('on');
        this.hoveredRingIdx = -1;

        clearTimeout(this.swapTimer);
        this.swapTimer = setTimeout(() => {
          this.prevSign = this.currentSign;
          this.fadeRatio = 0;
          this.currentSign = newSignIndex;
          this._renderTemplate(newSignIndex);

          const scrollContainer = document.getElementById('dscroll');
          if (scrollContainer) scrollContainer.scrollTop = 0;
          this.scrollY = 0;

          if (pageEl) pageEl.classList.remove('swap');
          if (this.swirlEngine) this.swirlEngine.travel(newSignIndex);

          try {
            history.replaceState(null, '', '#' + CONSTELLATIONS[newSignIndex].key + '/read');
          } catch (_) {}
        }, 420);
      }

      _startRenderLoop() {
        const tick = (timestamp) => {
          if (!this.isOpen) return;
          const dt = Math.min(0.05, (timestamp - this.lastTime) / 1000);
          this.lastTime = timestamp;
          this.t += dt;

          const scrollContainer = document.getElementById('dscroll');
          const scrollCurrent = scrollContainer ? scrollContainer.scrollTop : 0;
          this.scrollY += (scrollCurrent - this.scrollY) * (1 - Math.exp(-dt / 0.14));

          const w = this.W;
          const h = this.H;
          const minDim = Math.min(w, h);

          this.px += 0.06 * (this.tpx - this.px);
          this.py += 0.06 * (this.tpy - this.py);
          if (this.fadeRatio < 1) {
            this.fadeRatio = Math.min(1, this.fadeRatio + dt / 0.9);
          }

          for (const item of this.revealEls) {
            if (!item.on && item.top - scrollCurrent < 0.86 * h) {
              item.on = true;
              item.el.classList.add('in');
            }
          }

          const getSec = (k) => this.sectionBounds.find((s) => s.k === k);
          for (const g of this.ghostEls) {
            const sec = getSec(+g.dataset.k);
            if (!sec) continue;
            const relTop = sec.top - scrollCurrent;
            const xOffset = +g.dataset.k % 2 ? 0.02 * w : 0.26 * w;
            g.style.transform = `translate(${xOffset + 22 * this.px}px, ${(0.55 * relTop + 0.3 * h).toFixed(1)}px)`;
            g.style.opacity = Math.abs(relTop) < 1.6 * h ? '1' : '0';
          }

          const secCompat = getSec(6);
          const secFinal = getSec(7);
          const scrollNorm = smoothstep(clamp(scrollCurrent / (0.9 * h), 0, 1));
          const compatEase = secCompat
            ? smoothstep(clamp((scrollCurrent - (secCompat.top - 0.9 * h)) / (0.8 * h), 0, 1))
            : 0;
          const finalEase = secFinal
            ? smoothstep(clamp((scrollCurrent - (secFinal.top - 0.95 * h)) / (0.8 * h), 0, 1))
            : 0;

          const isNarrow = w < 820;
          let targetX = lerp(0.62 * w, 0.83 * w, scrollNorm);
          let targetY = lerp(0.5 * h, 0.46 * h, scrollNorm);
          let targetScale = lerp(0.46 * minDim, 0.11 * minDim, scrollNorm);
          let targetAlpha = lerp(1, 0.72, scrollNorm);
          let targetRot = lerp(1.15, 0.5, scrollNorm);

          if (isNarrow) {
            targetX = lerp(0.5 * w, 0.5 * w, scrollNorm);
            targetY = lerp(0.34 * h, 0.14 * h, scrollNorm);
            targetScale = lerp(0.36 * w, 0.12 * w, scrollNorm);
          }

          targetX = lerp(targetX, 0.5 * w, compatEase);
          targetY = lerp(targetY, 0.5 * h, compatEase);
          targetScale = lerp(targetScale, 0.15 * minDim, compatEase);
          targetAlpha = lerp(targetAlpha, 1, compatEase);
          targetRot = lerp(targetRot, 0.9, compatEase);

          targetX = lerp(targetX, 0.5 * w, finalEase);
          targetY = lerp(targetY, 0.5 * h, finalEase);
          targetScale = lerp(targetScale, minDim * (isNarrow ? 0.5 : 0.42), finalEase);
          targetRot = lerp(targetRot, 1.35, finalEase);

          const ringAlpha = compatEase * (1 - finalEase);
          targetX += 14 * this.px;
          targetY += 10 * this.py;

          if (this.swirlEngine) {
            const scrollEaseY = this.scrollY;
            const defaultFit = Math.min(0.36 * w, 0.3 * h);
            const bootEase = smoothstep(clamp(scrollEaseY / (0.9 * h), 0, 1));
            const cEase = secCompat
              ? smoothstep(clamp((scrollEaseY - (secCompat.top - 0.9 * h)) / (0.8 * h), 0, 1))
              : 0;
            const fEase = secFinal
              ? smoothstep(clamp((scrollEaseY - (secFinal.top - 0.95 * h)) / (0.8 * h), 0, 1))
              : 0;

            let swX = isNarrow ? 0.5 * w : 0.6 * w;
            let swY = isNarrow ? 0.36 * h : 0.58 * h;
            let swScale = defaultFit;
            let swAlpha = 1;

            swX = lerp(swX, isNarrow ? 0.5 * w : 0.83 * w, bootEase);
            swY = lerp(swY, isNarrow ? 0.11 * h : 0.46 * h, bootEase);
            swScale = lerp(swScale, isNarrow ? 0.1 * w : 0.11 * minDim, bootEase);
            swAlpha = lerp(1, isNarrow ? 0.75 : 0.9, bootEase);

            swX = lerp(swX, 0.5 * w, cEase);
            swY = lerp(swY, 0.5 * h, cEase);
            swScale = lerp(swScale, 0.15 * minDim, cEase);
            swAlpha = lerp(swAlpha, 1, cEase);

            swX = lerp(swX, 0.5 * w, fEase);
            swY = lerp(swY, 0.5 * h, fEase);
            swScale = lerp(swScale, minDim * (isNarrow ? 0.5 : 0.42), fEase);

            this.swirlEngine.place(
              swX + 14 * this.px,
              swY + 10 * this.py,
              swScale / defaultFit,
              swAlpha,
            );
          }

          const vStars = document.getElementById('dstars');
          if (vStars) {
            const jCtx = vStars.getContext('2d');
            jCtx.clearRect(0, 0, w, h);

            const radialVignette = jCtx.createRadialGradient(
              w / 2,
              h / 2,
              0.18 * Math.min(w, h),
              w / 2,
              h / 2,
              0.56 * Math.hypot(w, h),
            );
            radialVignette.addColorStop(0, 'rgba(5,14,18,0)');
            radialVignette.addColorStop(1, 'rgba(5,14,18,.85)');
            jCtx.fillStyle = radialVignette;
            jCtx.fillRect(0, 0, w, h);

            const starSpread = 1.4 * h;
            const mod = (val, max) => ((val % max) + max) % max;
            for (const s of this.ambientStars) {
              const sx = mod(s.x * w + 10 * this.px * s.z, w);
              const sy =
                mod(
                  s.y * starSpread - scrollCurrent * (0.05 + 0.16 * s.z) + 6 * this.py * s.z,
                  starSpread,
                ) -
                0.2 * h;
              if (sy < -4 || sy > h + 4) continue;

              const twinkle = this.reduced ? 1 : 0.72 + 0.28 * Math.sin(this.t * s.sp + s.ph);
              const b = clamp(s.b * twinkle * (0.55 + 0.45 * s.z), 0, 1);
              const rgb = s.c;
              if (s.r < 0.8) {
                jCtx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.8 * b})`;
                jCtx.fillRect(sx, sy, 1, 1);
              } else {
                jCtx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${b})`;
                jCtx.beginPath();
                jCtx.arc(sx, sy, s.r, 0, TAU);
                jCtx.fill();
              }
            }

            for (const p of this.ambientParticles) {
              const px = mod(p.x * w + p.vx * this.t * 18 * p.z + 36 * this.px * p.z, w + 80) - 40;
              const py =
                mod(
                  p.y * starSpread - scrollCurrent * (0.1 + 0.26 * p.z) + p.vy * this.t * 10 * p.z,
                  starSpread,
                ) -
                0.2 * h;
              const pr = p.r * (0.5 + p.z);
              const pa = p.a * (0.7 + 0.3 * Math.sin(0.6 * this.t + p.ph));
              const grad = jCtx.createRadialGradient(px, py, 0, px, py, pr);
              grad.addColorStop(0, `rgba(176, 204, 232, ${pa})`);
              grad.addColorStop(1, 'rgba(176,204,232,0)');
              jCtx.fillStyle = grad;
              jCtx.beginPath();
              jCtx.arc(px, py, pr, 0, TAU);
              jCtx.fill();
            }
          }

          const uCon = document.getElementById('dcon');
          if (uCon) {
            const kCtx = uCon.getContext('2d');
            kCtx.clearRect(0, 0, w, h);

            this.ringNodes.length = 0;
            const compatTooltip = document.getElementById('dcompat');

            if (ringAlpha > 0.01) {
              const ringItems = CONSTELLATIONS.map((_, idx) => idx).filter(
                (idx) => idx !== this.currentSign,
              );
              const ringAngle = (this.reduced ? 0 : 0.045 * this.t) + 0.0012 * scrollCurrent;
              const ringRadius = isNarrow ? 0.4 * w : 0.35 * minDim;
              let closestIdx = -1;
              let closestDist = 1e9;

              ringItems.forEach((cIdx, i) => {
                const angle = ringAngle + (i * TAU) / ringItems.length;
                const rx = 0.5 * w + Math.cos(angle) * ringRadius * 1.12;
                const ry = 0.5 * h + Math.sin(angle) * ringRadius * 0.86;
                this.ringNodes.push({ i: cIdx, x: rx, y: ry });

                if (this.mx >= 0) {
                  const dist = Math.hypot(rx - this.mx, ry - this.my);
                  if (dist < 58 && dist < closestDist) {
                    closestDist = dist;
                    closestIdx = i;
                  }
                }
              });

              if (closestIdx !== this.hoveredRingIdx) {
                this.hoveredRingIdx = closestIdx;
                if (closestIdx >= 0) {
                  const hoveredItem = this.ringNodes[closestIdx];
                  const hoveredConstellation = CONSTELLATIONS[hoveredItem.i];
                  const activeConstellation = CONSTELLATIONS[this.currentSign];

                  const keyPair =
                    this.currentSign < hoveredItem.i
                      ? `${activeConstellation.key}|${hoveredConstellation.key}`
                      : `${hoveredConstellation.key}|${activeConstellation.key}`;
                  const loreText = ZODIAC_COMPATIBILITY[keyPair] || '';

                  if (compatTooltip) {
                    compatTooltip.innerHTML = `<b>${activeConstellation.l1} &amp; ${hoveredConstellation.l1}</b><span>${loreText}</span>`;
                    compatTooltip.classList.add('on');
                  }
                } else if (compatTooltip) {
                  compatTooltip.classList.remove('on');
                }
              }

              if (this.hoveredRingIdx >= 0 && compatTooltip) {
                const hoveredItem = this.ringNodes[this.hoveredRingIdx];
                compatTooltip.style.transform = `translate(${hoveredItem.x.toFixed(1)}px, ${hoveredItem.y.toFixed(1)}px) translate(-50%, -100%)`;
                if (scrollContainer) scrollContainer.dataset.cursor = 'hot';
              } else if (scrollContainer) {
                scrollContainer.dataset.cursor = '';
              }
            } else if (this.hoveredRingIdx >= 0) {
              this.hoveredRingIdx = -1;
              if (compatTooltip) compatTooltip.classList.remove('on');
              if (scrollContainer) scrollContainer.dataset.cursor = '';
            }
          }

          if (this.swirlEngine) {
            this.swirlEngine.draw(
              timestamp,
              smoothstep(clamp(scrollCurrent / (0.9 * h), 0, 1)),
              this.px,
              this.py,
            );
          }

          this.raf = requestAnimationFrame(tick);
        };

        this.raf = requestAnimationFrame(tick);
      }
    }

    return {
      ButtonGlow: ButtonGlow,
      HoloCardRenderer: HoloCardRenderer,
      createParticleSwirlEngine: createParticleSwirlEngine,
      createIntroController: createIntroController,
      ReadingOverlay: ReadingOverlay,
    };
  },
);
