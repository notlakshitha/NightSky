(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../core/math.js'), require('../data/constellations.js'));
  } else {
    root.NightSky = root.NightSky || {};
    root.NightSky.Renderer = factory(root.NightSky.Math, root.NightSky.Data);
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function (MathUtils, DataUtils) {
  'use strict';

  const clamp = MathUtils.clamp;
  const lerp = MathUtils.lerp;
  const TAU = MathUtils.TAU;
  const createPrng = MathUtils.createPrng;
  const createNoise2D = MathUtils.createNoise2D;
  const fbmNoise = MathUtils.fbmNoise;

  const STAR_PALETTE = DataUtils.STAR_PALETTE;
  const STAR_GLOW_COLORS = DataUtils.STAR_GLOW_COLORS;
  const WORLD_BOUNDS = DataUtils.WORLD_BOUNDS;
  const FIGURE_FACTORIES = DataUtils.FIGURE_FACTORIES;

  const CHUNK_SIZE = 700;

  class ShootingStars {
    constructor(seed) {
      this.rng = createPrng(seed);
      this.meteors = [];
      this.spawnTimer = 1.5;
    }

    update(dt, velocityFactor) {
      this.spawnTimer -= dt * (1 + 2.6 * velocityFactor);
      if (this.spawnTimer <= 0) {
        this.spawnTimer = 1.6 + 5.5 * this.rng();
        const angle = 0.2 * Math.PI + 0.34 * this.rng();
        const speed = 0.42 + 0.5 * this.rng();
        this.meteors.push({
          x: this.rng(),
          y: 0.85 * this.rng(),
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0,
          duration: 0.55 + 0.75 * this.rng(),
          length: 0.05 + 0.1 * this.rng(),
          width: 0.55 + 0.8 * this.rng(),
        });
      }

      for (const m of this.meteors) {
        m.life += dt;
      }
      this.meteors = this.meteors.filter((m) => m.life < m.duration);
    }

    draw(ctx, width, height) {
      for (const m of this.meteors) {
        const progress = m.life / m.duration;
        const alpha = Math.sin(Math.PI * progress);
        const startX = (m.x + m.vx * progress * 0.3) * width;
        const startY = (m.y + m.vy * progress * 0.3) * height;
        const trailLen = m.length * Math.hypot(width, height) * (0.55 + 0.7 * alpha);
        const dirX = -m.vx;
        const dirY = -m.vy;
        const len = Math.hypot(dirX, dirY) || 1;

        const grad = ctx.createLinearGradient(
          startX,
          startY,
          startX + (dirX / len) * trailLen,
          startY + (dirY / len) * trailLen,
        );
        grad.addColorStop(0, `rgba(232,240,248,${0.72 * alpha})`);
        grad.addColorStop(0.35, `rgba(176,204,232,${0.2 * alpha})`);
        grad.addColorStop(1, 'rgba(150,190,220,0)');

        ctx.strokeStyle = grad;
        ctx.lineWidth = m.width;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(startX + (dirX / len) * trailLen, startY + (dirY / len) * trailLen);
        ctx.stroke();
      }
    }
  }

  class SkyRenderer {
    constructor() {
      this.canvas = null;
      this.ctx = null;
      this.offscreenCanvas = null;
      this.offscreenCtx = null;

      this.width = 0;
      this.height = 0;
      this.dpr = 1;

      this.chunkCache = new Map();
      this.spriteCache = null;
      this.cachedSpriteDpr = 0;

      this.nebulaPattern1 = null;
      this.nebulaPattern2 = null;
      this.nebulaPattern3 = null;
      this.diffuseClouds = [];

      this.shootingStars = new ShootingStars(3);
      this.watermarkPos = { x: 0, y: 0 };
    }

    init(canvas, offscreenCanvas, constellationInstances, initialCamPos) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.offscreenCanvas = offscreenCanvas;
      this.offscreenCtx = offscreenCanvas.getContext('2d');

      this.constellationInstances = constellationInstances;
      this.initialCamPos = initialCamPos;

      if (constellationInstances && constellationInstances.length >= 7) {
        this.watermarkPos.x = (constellationInstances[5].x + constellationInstances[6].x) / 2;
        this.watermarkPos.y =
          (constellationInstances[5].y + constellationInstances[6].y) / 2 - 1150;
      }

      this.resize();
      this._generateNebulaBackdrop();
    }

    resize() {
      if (typeof window === 'undefined' || !this.canvas) return;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.width = window.innerWidth;
      this.height = window.innerHeight;

      this.canvas.width = Math.round(this.width * this.dpr);
      this.canvas.height = Math.round(this.height * this.dpr);
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

      this.offscreenCanvas.width = Math.max(2, Math.round(this.width * this.dpr * 0.5));
      this.offscreenCanvas.height = Math.max(2, Math.round(this.height * this.dpr * 0.5));
      this.offscreenCtx.setTransform(0.5 * this.dpr, 0, 0, 0.5 * this.dpr, 0, 0);

      this._updateFrameSvg();
    }

    _updateFrameSvg() {
      if (typeof document === 'undefined') return;
      const frameSvg = document.getElementById('frameSvg');
      if (!frameSvg || this.width < 4 || this.height < 4) return;
      frameSvg.setAttribute('viewBox', `0 0 ${this.width} ${this.height}`);
      frameSvg.innerHTML =
        `<rect x=".5" y=".5" width="${this.width - 1}" height="${this.height - 1}" rx="14" ry="14"
      fill="none" stroke="rgba(226,232,244,.34)" stroke-width="1" stroke-dasharray="4 4"/>` +
        [
          [this.width / 2, 1],
          [this.width - 1, this.height / 2],
          [this.width / 2, this.height - 1],
          [1, this.height / 2],
        ]
          .map((pt) => `<circle cx="${pt[0]}" cy="${pt[1]}" r="3.1" fill="rgba(232,238,248,.86)"/>`)
          .join('');
    }

    _generateNebulaBackdrop() {
      if (typeof document === 'undefined') return;
      const size = 760;
      const noise1 = createNoise2D(7);
      const noise2 = createNoise2D(1201);

      const generatePatternTile = (noiseFn, octaves, roughness, scale, power, colorRgb) => {
        const tileCanvas = document.createElement('canvas');
        tileCanvas.width = size;
        tileCanvas.height = size;
        const tileCtx = tileCanvas.getContext('2d');
        const imgData = tileCtx.createImageData(size, size);
        const data = imgData.data;

        const r = colorRgb ? colorRgb[0] : 255;
        const g = colorRgb ? colorRgb[1] : 255;
        const b = colorRgb ? colorRgb[2] : 255;

        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const idx = 4 * (y * size + x);
            let val = 0.5 * fbmNoise(noiseFn, x / size, y / size, octaves, roughness, scale) + 0.5;
            val = Math.pow(clamp(val, 0, 1), power);
            data[idx] = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
            data[idx + 3] = (255 * val) | 0;
          }
        }
        tileCtx.putImageData(imgData, 0, 0);

        const seamlessCanvas = document.createElement('canvas');
        seamlessCanvas.width = 3 * size;
        seamlessCanvas.height = 3 * size;
        const seamlessCtx = seamlessCanvas.getContext('2d');
        for (let ty = 0; ty < 3; ty++) {
          for (let tx = 0; tx < 3; tx++) {
            seamlessCtx.drawImage(tileCanvas, tx * size, ty * size);
          }
        }

        const finalTile = document.createElement('canvas');
        finalTile.width = size;
        finalTile.height = size;
        const finalCtx = finalTile.getContext('2d');
        finalCtx.filter = 'blur(.9px)';
        finalCtx.drawImage(seamlessCanvas, size, size, size, size, 0, 0, size, size);
        return finalTile;
      };

      const tile1 = generatePatternTile(noise1, 5, 0.55, 1.7, 4, [40, 92, 122]);
      const tile2 = generatePatternTile(noise1, 5, 0.55, 2.35, 8, [34, 104, 126]);
      const tile3 = generatePatternTile(noise2, 4, 0.52, 1.9, 3);

      this.nebulaPattern1 = this.offscreenCtx.createPattern(tile1, 'repeat');
      this.nebulaPattern2 = this.offscreenCtx.createPattern(tile2, 'repeat');
      this.nebulaPattern3 = this.offscreenCtx.createPattern(tile3, 'repeat');

      const rng = createPrng(500);
      this.diffuseClouds = [];

      for (let i = 0; i < 30; i++) {
        const x = rng() * WORLD_BOUNDS.w;
        const y = this.milkyWayY(x) + (rng() - 0.5) * WORLD_BOUNDS.h * 0.46;
        const colorPick = rng();
        const color =
          colorPick < 0.42 ? [20, 64, 84] : colorPick < 0.72 ? [22, 50, 80] : [28, 60, 78];
        this.diffuseClouds.push({
          x: x,
          y: y,
          r: 900 + 2300 * rng(),
          c: color,
          a: 0.035 + 0.075 * rng(),
        });
      }

      const heroCenter = this.initialCamPos;
      for (let i = 0; i < 7; i++) {
        const angle = (i / 7) * TAU + 0.4;
        const colorIdx = i % 4;
        const color =
          colorIdx === 0
            ? [26, 74, 98]
            : colorIdx === 1
              ? [22, 58, 92]
              : colorIdx === 2
                ? [32, 80, 104]
                : [20, 60, 84];
        this.diffuseClouds.push({
          x: heroCenter.x + Math.cos(angle) * (300 + 180 * i),
          y: heroCenter.y + Math.sin(angle) * (240 + 150 * i),
          r: 1400 + 240 * i,
          c: color,
          a: 0.04 + (i % 3) * 0.014,
          hero: true,
        });
      }
    }

    milkyWayY(x) {
      return (
        0.7 * WORLD_BOUNDS.h -
        x * ((0.3 * WORLD_BOUNDS.h) / WORLD_BOUNDS.w) +
        Math.sin((x / WORLD_BOUNDS.w) * 5.2 + 0.6) * WORLD_BOUNDS.h * 0.075
      );
    }

    getStarChunk(chunkX, chunkY) {
      const key = chunkX + ',' + chunkY;
      let chunk = this.chunkCache.get(key);
      if (chunk) return chunk;

      const rng = createPrng(((73856093 * chunkX) ^ (19349663 * chunkY)) >>> 0);
      const startX = chunkX * CHUNK_SIZE;
      const startY = chunkY * CHUNK_SIZE;
      const distToMilkyWay =
        (startY + CHUNK_SIZE / 2 - this.milkyWayY(startX + CHUNK_SIZE / 2)) /
        (0.22 * WORLD_BOUNDS.h);
      const densityFactor = 0.22 + 0.78 * Math.exp(-distToMilkyWay * distToMilkyWay);
      const starCount = Math.round(78 + 196 * densityFactor);

      chunk = [];
      for (let i = 0; i < starCount; i++) {
        const magSeed = Math.pow(rng(), 3.1);
        const bonusSeed = rng();
        chunk.push({
          x: startX + rng() * CHUNK_SIZE,
          y: startY + rng() * CHUNK_SIZE,
          r: 0.26 + 1.45 * magSeed + (bonusSeed > 0.995 ? 0.9 : 0),
          b: (0.13 + 0.87 * magSeed) * (0.5 + 0.65 * densityFactor),
          c: STAR_PALETTE[(Math.pow(rng(), 2.3) * STAR_PALETTE.length) | 0],
          ph: rng() * TAU,
          sp: 0.3 + 1.4 * rng(),
        });
      }

      this.chunkCache.set(key, chunk);
      if (this.chunkCache.size > 900) {
        const oldestKey = this.chunkCache.keys().next().value;
        this.chunkCache.delete(oldestKey);
      }
      return chunk;
    }

    getStarSprites(dpr) {
      if (this.spriteCache && this.cachedSpriteDpr === dpr) {
        return this.spriteCache;
      }

      const createSprite = (size, drawFn) => {
        const c = document.createElement('canvas');
        c.width = c.height = Math.ceil(size * dpr);
        const ctx = c.getContext('2d');
        ctx.scale(dpr, dpr);
        drawFn(ctx, size / 2);
        return { c: c, s: size };
      };

      const rgbaStr = (rgb, a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;

      const drawRadialGlow = (ctx, center, rgb, sigma, intensity, radius) => {
        const grad = ctx.createRadialGradient(center, center, 0, center, center, radius);
        for (let i = 0; i <= 8; i++) {
          const t = i / 8;
          grad.addColorStop(
            t,
            rgbaStr(rgb, intensity * Math.exp((-t * radius * (t * radius)) / (2 * sigma * sigma))),
          );
        }
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(center, center, radius, 0, TAU);
        ctx.fill();
      };

      const drawDiffractionCross = (ctx, cx, cy, rgb) => {
        ctx.lineWidth = 1.1;
        ctx.lineCap = 'round';
        for (let axis = 0; axis < 2; axis++) {
          const dx = axis ? 0 : 22;
          const dy = axis ? 22 : 0;
          const grad = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
          grad.addColorStop(0, rgbaStr(rgb, 0));
          grad.addColorStop(0.5, rgbaStr(rgb, 0.34));
          grad.addColorStop(1, rgbaStr(rgb, 0));
          ctx.strokeStyle = grad;
          ctx.beginPath();
          ctx.moveTo(cx - dx, cy - dy);
          ctx.lineTo(cx + dx, cy + dy);
          ctx.stroke();
        }
      };

      this.spriteCache = {
        dust: STAR_GLOW_COLORS.map((color) =>
          createSprite(8, (ctx, center) => drawRadialGlow(ctx, center, color, 1.05, 1, 4)),
        ),
        small: STAR_GLOW_COLORS.map((color) =>
          createSprite(12, (ctx, center) => drawRadialGlow(ctx, center, color, 1.6, 1, 6)),
        ),
        bright: STAR_GLOW_COLORS.map((color) =>
          createSprite(58, (ctx, center) => {
            drawRadialGlow(ctx, center, color, 9.5, 0.17, 29);
            drawRadialGlow(ctx, center, color, 2.5, 1, 9);
            drawDiffractionCross(ctx, center, center, color);
          }),
        ),
      };
      this.cachedSpriteDpr = dpr;
      return this.spriteCache;
    }

    worldToScreen(worldX, worldY, cam) {
      return {
        x: (worldX - cam.x) * cam.z + this.width / 2,
        y: (worldY - cam.y) * cam.z + this.height / 2,
      };
    }

    screenToWorld(screenX, screenY, cam) {
      return {
        x: (screenX - this.width / 2) / cam.z + cam.x,
        y: (screenY - this.height / 2) / cam.z + cam.y,
      };
    }

    getConstellationFigure(instance) {
      if (!instance.fig) {
        const factory = FIGURE_FACTORIES[instance.figKey];
        const figure = factory ? factory() : { P: [], E: [] };
        instance.fig = {
          P: figure.P,
          E: figure.E,
        };
      }
      return instance.fig;
    }

    getConstellationKnots(figure, seed) {
      if (figure.knots) return figure.knots;
      const rng = createPrng(seed | 0);

      const gaussianRand = () => {
        let u = 0,
          v = 0;
        while (u === 0) u = rng();
        while (v === 0) v = rng();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
      };

      const pickTint = () => {
        const val = rng();
        return val < 0.65 ? 0 : val < 0.92 ? 1 : 2;
      };

      const knots = [];
      figure.P.forEach((pt, ptIdx) => {
        pt.tint = pt.m >= 1 ? (rng() < 0.86 ? 0 : 1) : pickTint();
        pt.ph = rng() * TAU;
        if (pt.m < 1) return;

        const count = Math.round(10 + 12 * pt.m);
        const knotPts = [];
        for (let i = 0; i < count; i++) {
          const dist = Math.abs(gaussianRand()) + 0.25;
          const angle = rng() * TAU;
          knotPts.push({
            ux: Math.cos(angle) * dist,
            uy: Math.sin(angle) * dist,
            s: 0.55 + 0.85 * rng(),
            a: (0.36 + 0.5 * rng()) * clamp(1.4 - dist / 2.2, 0.35, 1),
            t: pickTint(),
            ph: rng() * TAU,
          });
        }
        knots.push({
          i: ptIdx,
          m: pt.m,
          pts: knotPts,
        });
      });

      figure.knots = knots;
      return knots;
    }

    isEdgeVisible(points, edge) {
      const p1 = points[edge[0]];
      const p2 = points[edge[1]];
      return !((p1.m >= 0.3 && p1.m < 1) || (p2.m >= 0.3 && p2.m < 1));
    }

    drawConstellation(instance, opacity, isHighlight, cam, currentTime, reducedMotion) {
      if (opacity <= 0.004) return;
      const figure = this.getConstellationFigure(instance);
      const zoom = cam.z;
      const scale = instance.scale * zoom;
      const screenX = (instance.x - cam.x) * zoom + this.width / 2;
      const screenY = (instance.y - cam.y) * zoom + this.height / 2;
      const boundRadius = 1.5 * scale;

      if (
        screenX < -boundRadius ||
        screenX > this.width + boundRadius ||
        screenY < -boundRadius ||
        screenY > this.height + boundRadius
      ) {
        return;
      }

      const points = figure.P;
      const edges = figure.E;
      const knots = this.getConstellationKnots(figure, 31 * instance.x + instance.y);
      const sprites = this.getStarSprites(this.dpr);
      const ctx = this.ctx;

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineWidth = Math.max(0.6, 0.8 * Math.min(1.4, zoom));
      ctx.strokeStyle = `rgba(179,209,255,${0.24 * opacity * (0.7 + 0.55 * isHighlight)})`;
      ctx.beginPath();

      for (let i = 0; i < edges.length; i++) {
        if (!this.isEdgeVisible(points, edges[i])) continue;
        const p1 = points[edges[i][0]];
        const p2 = points[edges[i][1]];
        ctx.moveTo(screenX + p1.x * scale, screenY + p1.y * scale);
        ctx.lineTo(screenX + p2.x * scale, screenY + p2.y * scale);
      }
      ctx.stroke();

      const motionFactor = reducedMotion ? 0 : 1;
      const brightScale = clamp(scale / 300, 0.5, 1);

      for (let i = 0; i < points.length; i++) {
        const pt = points[i];
        if (pt.m >= 1) continue;
        const px = screenX + pt.x * scale;
        const py = screenY + pt.y * scale;
        if (px < -8 || px > this.width + 8 || py < -8 || py > this.height + 8) continue;

        const twinkle =
          1 -
          0.22 * motionFactor +
          0.22 * motionFactor * Math.sin(currentTime * (1.1 + (i % 7) * 0.16) + pt.ph);
        const sprite = pt.m > 0.3 ? sprites.small[pt.tint] : sprites.dust[pt.tint];
        const spriteSize = sprite.s * (0.75 + 1.2 * pt.m) * Math.min(1.5, 0.75 + 0.3 * zoom);

        ctx.globalAlpha = Math.min(1, opacity * (0.3 + 0.9 * pt.m) * twinkle);
        ctx.drawImage(sprite.c, px - spriteSize / 2, py - spriteSize / 2, spriteSize, spriteSize);
      }

      for (const knot of knots) {
        const rootPt = points[knot.i];
        const kx = screenX + rootPt.x * scale;
        const ky = screenY + rootPt.y * scale;
        if (kx < -60 || kx > this.width + 60 || ky < -60 || ky > this.height + 60) continue;

        const knotSpread = clamp(scale * (0.01 + 0.008 * knot.m), 3.5 + 2.5 * knot.m, 40);
        const zoomFactor = Math.min(1.5, 0.75 + 0.3 * zoom);

        for (const subPt of knot.pts) {
          const twinkle =
            1 -
            0.25 * motionFactor +
            0.25 * motionFactor * Math.sin(currentTime * (0.9 + ((3 * subPt.s) % 1.6)) + subPt.ph);
          const sprite = subPt.s > 0.9 ? sprites.small[subPt.t] : sprites.dust[subPt.t];
          const spriteSize = sprite.s * subPt.s * zoomFactor;

          ctx.globalAlpha = Math.min(1, opacity * subPt.a * twinkle * (0.8 + 0.3 * isHighlight));
          ctx.drawImage(
            sprite.c,
            kx + subPt.ux * knotSpread - spriteSize / 2,
            ky + subPt.uy * knotSpread - spriteSize / 2,
            spriteSize,
            spriteSize,
          );
        }

        const rootTwinkle =
          1 -
          0.16 * motionFactor +
          0.16 * motionFactor * Math.sin(currentTime * (1.1 + (knot.i % 7) * 0.16) + rootPt.ph);
        const brightSprite = sprites.bright[rootPt.tint];
        const brightSize = (30 + 28 * rootPt.m) * brightScale;

        ctx.globalAlpha = Math.min(1, opacity * (0.62 + 0.38 * isHighlight) * rootTwinkle);
        ctx.drawImage(
          brightSprite.c,
          kx - brightSize / 2,
          ky - brightSize / 2,
          brightSize,
          brightSize,
        );
      }

      ctx.restore();
    }

    drawReticle(cx, cy, radius, alpha, angle, color) {
      if (alpha <= 0.004) return;
      color = color || '169,196,220';
      const ctx = this.ctx;

      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(${color},${0.42 * alpha})`;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, TAU);
      ctx.stroke();

      ctx.strokeStyle = `rgba(${color},${0.34 * alpha})`;
      ctx.setLineDash([1.6, 6]);
      ctx.beginPath();
      ctx.arc(cx, cy, 1.045 * radius, angle + 0.3, angle + TAU - 0.16);
      ctx.stroke();
      ctx.setLineDash([]);

      const diag = Math.hypot(this.width, this.height);
      ctx.strokeStyle = `rgba(${color},${0.3 * alpha})`;
      ctx.beginPath();

      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        const cosA = Math.cos(a);
        const sinA = Math.sin(a);
        ctx.moveTo(cx + cosA * radius * 0.9, cy + sinA * radius * 0.9);
        ctx.lineTo(cx + cosA * diag, cy + sinA * diag);
      }

      for (let i = 0; i < 12; i++) {
        const a = (i * Math.PI) / 6 + 0.15 * angle;
        const cosA = Math.cos(a);
        const sinA = Math.sin(a);
        ctx.moveTo(cx + cosA * radius * 0.885, cy + sinA * radius * 0.885);
        ctx.lineTo(cx + cosA * radius * 1.105, cy + sinA * radius * 1.105);
      }

      ctx.stroke();
      ctx.restore();
    }

    drawDiffractionSpike(cx, cy, radius, lineWidth, rgb, alpha) {
      const ctx = this.ctx;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      for (let axis = 0; axis < 2; axis++) {
        const dx = axis ? 0 : radius;
        const dy = axis ? radius : 0;
        const grad = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
        grad.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
        grad.addColorStop(0.5, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`);
        grad.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
        ctx.strokeStyle = grad;
        ctx.beginPath();
        ctx.moveTo(cx - dx, cy - dy);
        ctx.lineTo(cx + dx, cy + dy);
        ctx.stroke();
      }
    }

    render(state) {
      const w = this.width;
      const h = this.height;
      const dpr = this.dpr;
      const cam = state.cam;
      const zoom = cam.z;
      const time = state.t;
      const dt = state.dt;
      const mode = state.mode;

      const k = this.offscreenCtx;
      k.setTransform(0.5 * dpr, 0, 0, 0.5 * dpr, 0, 0);
      k.fillStyle = '#000';
      k.fillRect(0, 0, w, h);

      const parallax = 0.34;
      const leftWorld = cam.x - w / (2 * zoom * parallax);
      const rightWorld = cam.x + w / (2 * zoom * parallax);
      const leftY = this.milkyWayY(leftWorld);
      const rightY = this.milkyWayY(rightWorld);
      const worldToScreenY = (wy) => (wy - cam.y) * parallax * zoom + h / 2;
      const angle = Math.atan2(worldToScreenY(rightY) - worldToScreenY(leftY), w);

      k.save();
      k.translate(w / 2, (worldToScreenY(leftY) + worldToScreenY(rightY)) / 2);
      k.rotate(angle);

      const bandRadius = 0.3 * WORLD_BOUNDS.h * zoom * parallax * 0.92;
      const bandGrad = k.createLinearGradient(0, -bandRadius, 0, bandRadius);
      const bandOpacity = 0.26;
      bandGrad.addColorStop(0, 'rgba(8,26,34,0)');
      bandGrad.addColorStop(0.32, `rgba(10,34,44,${0.16 * bandOpacity})`);
      bandGrad.addColorStop(0.47, `rgba(20,60,76,${0.26 * bandOpacity})`);
      bandGrad.addColorStop(0.57, `rgba(16,50,64,${0.2 * bandOpacity})`);
      bandGrad.addColorStop(0.74, 'rgba(10,32,42,0.0286)');
      bandGrad.addColorStop(1, 'rgba(6,20,28,0)');
      k.fillStyle = bandGrad;
      k.fillRect(-w, -bandRadius, 2 * w, 2 * bandRadius);
      k.restore();

      k.globalCompositeOperation = 'lighter';
      for (const cloud of this.diffuseClouds) {
        const screenPos = {
          x: parallax * (cloud.x - cam.x) * zoom + w / 2,
          y: parallax * (cloud.y - cam.y) * zoom + h / 2,
        };
        const cloudRadius = cloud.r * zoom * parallax;
        if (
          screenPos.x < -cloudRadius ||
          screenPos.x > w + cloudRadius ||
          screenPos.y < -cloudRadius ||
          screenPos.y > h + cloudRadius
        )
          continue;

        const grad = k.createRadialGradient(
          screenPos.x,
          screenPos.y,
          0,
          screenPos.x,
          screenPos.y,
          cloudRadius,
        );
        grad.addColorStop(
          0,
          `rgba(${cloud.c[0]},${cloud.c[1]},${cloud.c[2]},${cloud.a * (cloud.hero ? 1 : 0.18)})`,
        );
        grad.addColorStop(1, `rgba(${cloud.c[0]},${cloud.c[1]},${cloud.c[2]},0)`);
        k.fillStyle = grad;
        k.fillRect(
          screenPos.x - cloudRadius,
          screenPos.y - cloudRadius,
          2 * cloudRadius,
          2 * cloudRadius,
        );
      }

      k.globalCompositeOperation = 'source-over';
      const drawNebulaLayer = (pattern, scale, parallaxRatio, alpha, compOp) => {
        const s = scale * zoom;
        const ox = -cam.x * parallaxRatio * zoom;
        const oy = -cam.y * parallaxRatio * zoom;
        k.save();
        k.globalCompositeOperation = compOp;
        k.globalAlpha = alpha;
        k.translate(w / 2 + ox, h / 2 + oy);
        k.scale(s, s);
        k.fillStyle = pattern;
        k.fillRect((-w / 2 - ox) / s, (-h / 2 - oy) / s, w / s, h / s);
        k.restore();
      };

      if (this.nebulaPattern1) {
        drawNebulaLayer(this.nebulaPattern1, 3.1, 0.29, 0.0624, 'lighter');
        drawNebulaLayer(this.nebulaPattern2, 1.45, 0.35, 0.0408, 'lighter');
        drawNebulaLayer(this.nebulaPattern1, 0.85, 0.4, 0.024, 'lighter');
        drawNebulaLayer(this.nebulaPattern3, 2.15, 0.31, 0.56, 'destination-out');
      }

      const yCtx = this.ctx;
      yCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      yCtx.globalCompositeOperation = 'source-over';
      yCtx.clearRect(0, 0, w, h);
      yCtx.drawImage(this.offscreenCanvas, 0, 0, w, h);

      const warp = state.warp;
      const pad = 260 / zoom;
      const minX = cam.x - w / (2 * zoom) - pad;
      const maxX = cam.x + w / (2 * zoom) + pad;
      const minY = cam.y - h / (2 * zoom) - pad;
      const maxY = cam.y + h / (2 * zoom) + pad;

      const minChunkX = Math.floor(minX / CHUNK_SIZE);
      const maxChunkX = Math.floor(maxX / CHUNK_SIZE);
      const minChunkY = Math.floor(minY / CHUNK_SIZE);
      const maxChunkY = Math.floor(maxY / CHUNK_SIZE);

      const velX = state.velx;
      const velY = state.vely;

      for (let cx = minChunkX; cx <= maxChunkX; cx++) {
        for (let cy = minChunkY; cy <= maxChunkY; cy++) {
          const stars = this.getStarChunk(cx, cy);
          for (let i = 0; i < stars.length; i++) {
            const star = stars[i];
            const sx = (star.x - cam.x) * zoom + w / 2;
            const sy = (star.y - cam.y) * zoom + h / 2;
            if (sx < -40 || sx > w + 40 || sy < -40 || sy > h + 40) continue;

            const twinkle = state.reduced ? 1 : 0.74 + 0.26 * Math.sin(time * star.sp + star.ph);
            const brightness = clamp(star.b * twinkle, 0, 1);
            const radius = star.r * Math.min(1.35, 0.8 + 0.2 * zoom);
            const color = star.c;

            if (warp > 0.02 && star.b > 0.24) {
              const streakLen = Math.min(
                190,
                175 * warp * Math.pow(star.b, 1.5) * (0.5 + ((7 * i) % 5) * 0.22),
              );
              if (streakLen > 3) {
                yCtx.strokeStyle = `rgba(${color[0]},${color[1]},${color[2]},${0.34 * brightness})`;
                yCtx.lineWidth = Math.max(0.55, 0.8 * radius);
                yCtx.lineCap = 'round';
                yCtx.beginPath();
                yCtx.moveTo(sx, sy);
                yCtx.lineTo(sx - velX * streakLen, sy - velY * streakLen);
                yCtx.stroke();
                continue;
              }
            }

            if (radius < 0.75) {
              yCtx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${0.85 * brightness})`;
              yCtx.fillRect(sx, sy, 1, 1);
            } else {
              yCtx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${brightness})`;
              yCtx.beginPath();
              yCtx.arc(sx, sy, radius, 0, TAU);
              yCtx.fill();

              if (star.b > 0.8) {
                const haloRadius = 9 * radius;
                const haloGrad = yCtx.createRadialGradient(sx, sy, 0, sx, sy, haloRadius);
                haloGrad.addColorStop(
                  0,
                  `rgba(${color[0]},${color[1]},${color[2]},${0.22 * brightness})`,
                );
                haloGrad.addColorStop(
                  0.35,
                  `rgba(${color[0]},${color[1]},${color[2]},${0.07 * brightness})`,
                );
                haloGrad.addColorStop(1, `rgba(${color[0]},${color[1]},${color[2]},0)`);
                yCtx.fillStyle = haloGrad;
                yCtx.beginPath();
                yCtx.arc(sx, sy, haloRadius, 0, TAU);
                yCtx.fill();

                if (star.b > 0.93 && radius > 1.3) {
                  this.drawDiffractionSpike(
                    sx,
                    sy,
                    9 * radius,
                    Math.max(0.6, 0.3 * radius),
                    color,
                    0.5 * brightness,
                  );
                }
              }
            }
          }
        }
      }

      const wmx = (this.watermarkPos.x - cam.x) * zoom + w / 2;
      const wmy = (this.watermarkPos.y - cam.y) * zoom + h / 2;
      const wmScale = 190 * zoom;
      if (!(
        wmx < -2 * wmScale ||
        wmx > w + 2 * wmScale ||
        wmy < -2 * wmScale ||
        wmy > h + 2 * wmScale
      )) {
        yCtx.save();
        yCtx.translate(wmx, wmy);
        yCtx.scale(wmScale / 190, wmScale / 190);
        yCtx.strokeStyle = 'rgba(198,214,238,.13)';
        yCtx.lineWidth = 2.2;
        for (const r of [150, 128, 92]) {
          yCtx.beginPath();
          yCtx.arc(0, 0, r, 0, TAU);
          yCtx.stroke();
        }
        yCtx.setLineDash([2, 6]);
        yCtx.beginPath();
        yCtx.arc(0, 0, 140, 0, TAU);
        yCtx.stroke();
        yCtx.setLineDash([]);
        yCtx.beginPath();
        for (let i = 0; i < 12; i++) {
          const a = (i * Math.PI) / 6 + Math.PI / 12;
          yCtx.moveTo(92 * Math.cos(a), 92 * Math.sin(a));
          yCtx.lineTo(128 * Math.cos(a), 128 * Math.sin(a));
        }
        yCtx.stroke();
        yCtx.font = '400 22px "Instrument Serif", serif';
        yCtx.fillStyle = 'rgba(198,214,238,.13)';
        yCtx.textAlign = 'center';
        yCtx.fillText('N I G H T S K Y', 0, 196);
        yCtx.restore();
      }

      this.shootingStars.draw(yCtx, w, h);

      if (mode !== 'hero' && mode !== 'loading' && this.constellationInstances) {
        const centerDiag = 0.5 * Math.hypot(w, h);
        for (let i = 0; i < this.constellationInstances.length; i++) {
          const inst = this.constellationInstances[i];
          const screenPos = this.worldToScreen(inst.x, inst.y, cam);
          const distFromCenter = Math.hypot(screenPos.x - w / 2, screenPos.y - h / 2) / centerDiag;
          let opacity = clamp(1.35 - 1.05 * distFromCenter, 0, 1);
          if (mode === 'detail') {
            opacity = i === state.active ? 1 : 0.22 * opacity;
          }
          const isHotOrActive = i === state.hot || i === state.active ? 1 : 0;
          this.drawConstellation(
            inst,
            opacity * (mode === 'crest' ? 0.5 : 1),
            isHotOrActive,
            cam,
            time,
            state.reduced,
          );
        }
      }

      if (mode === 'hero') {
        const reticleRadius = 0.574 * Math.min(w, h);
        this.drawReticle(w / 2, h / 2, reticleRadius, state.heroRing, 0.06 * time);
      }
      if (state.ring > 0.004) {
        const reticleRadius = 0.48 * Math.min(w, h) * (0.8 + 0.2 * state.ring);
        this.drawReticle(w / 2, h / 2, reticleRadius, 0.9 * state.ring, 0.05 * time);
      }

      yCtx.globalCompositeOperation = 'lighter';
      const vignette = yCtx.createRadialGradient(
        w / 2,
        h / 2,
        0.18 * Math.min(w, h),
        w / 2,
        h / 2,
        0.56 * Math.hypot(w, h),
      );
      vignette.addColorStop(0, 'rgba(5,14,18,0)');
      vignette.addColorStop(1, 'rgba(5,14,18,.85)');
      yCtx.fillStyle = vignette;
      yCtx.fillRect(0, 0, w, h);
      yCtx.globalCompositeOperation = 'source-over';
    }
  }

  return {
    SkyRenderer: SkyRenderer,
    ShootingStars: ShootingStars,
  };
});
