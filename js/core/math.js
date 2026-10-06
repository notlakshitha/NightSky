(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.NightSky = root.NightSky || {};
    root.NightSky.Math = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  'use strict';

  const TAU = 2 * Math.PI;

  function clamp(val, min, max) {
    return val < min ? min : val > max ? max : val;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function smoothstep(t) {
    return t * t * (3 - 2 * t);
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function createPrng(seed) {
    return function () {
      seed = (1831565813 + (seed |= 0)) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createNoise2D(seed) {
    const rng = typeof seed === 'function' ? seed : createPrng(seed);
    const perm = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      perm[i] = i;
    }
    for (let i = 255; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      const temp = perm[i];
      perm[i] = perm[j];
      perm[j] = temp;
    }

    const grad = (hash, x, y) => (hash & 1 ? x : -x) + (hash & 2 ? y : -y);

    return function (x, y, period) {
      const xFloor = Math.floor(x);
      const yFloor = Math.floor(y);
      const x0 = ((xFloor % period) + period) % period;
      const y0 = ((yFloor % period) + period) % period;
      const x1 = (x0 + 1) % period;
      const y1 = (y0 + 1) % period;

      const dx = x - xFloor;
      const dy = y - yFloor;
      const sx = smoothstep(dx);
      const sy = smoothstep(dy);

      const lookup = (ix, iy) => perm[(perm[ix & 255] + iy) & 255];

      const n00 = grad(lookup(x0, y0), dx, dy);
      const n10 = grad(lookup(x1, y0), dx - 1, dy);
      const n01 = grad(lookup(x0, y1), dx, dy - 1);
      const n11 = grad(lookup(x1, y1), dx - 1, dy - 1);

      const nx0 = lerp(n00, n10, sx);
      const nx1 = lerp(n01, n11, sx);
      return lerp(nx0, nx1, sy);
    };
  }

  function fbmNoise(noiseFn, u, v, octaves, roughness, scale) {
    let amplitude = 0.5;
    let frequency = 1;
    let total = 0;
    let maxAmp = 0;

    for (let i = 0; i < octaves; i++) {
      total += amplitude * noiseFn(u * frequency * scale, v * frequency * scale, scale * frequency);
      maxAmp += amplitude;
      amplitude *= roughness;
      frequency *= 2;
    }

    return total / maxAmp;
  }

  function resolveAsset(key) {
    if (typeof document === 'undefined') return key;
    const normalizedKey = key.replace(/[^a-z0-9]+/gi, '_');
    const img = document.querySelector(`#assetmap img[data-k="${normalizedKey}"]`);
    return (img && img.getAttribute('src')) || key;
  }

  return {
    TAU: TAU,
    clamp: clamp,
    lerp: lerp,
    smoothstep: smoothstep,
    easeOutCubic: easeOutCubic,
    createPrng: createPrng,
    createNoise2D: createNoise2D,
    fbmNoise: fbmNoise,
    resolveAsset: resolveAsset,
  };
});
