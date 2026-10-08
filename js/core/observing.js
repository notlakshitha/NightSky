(function (root, factory) {
  if (typeof module === 'object' && module.exports)
    module.exports = factory(
      require('astronomy-engine'),
      require('../data/observing-catalog.js'),
      require('../data/constellations.js'),
      require('../data/field-content.js'),
    );
  else
    root.NightSky.Observing = factory(
      root.Astronomy,
      root.NightSky.ObservingCatalog,
      root.NightSky.Data,
      root.NightSky.FieldContent,
    );
})(globalThis, function (A, catalog, data, fieldContent) {
  'use strict';
  const rad = Math.PI / 180;
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const unique = (lines) => [...new Map(lines.flat().map((p) => [p.join(','), p])).values()];
  function validLocation(value) {
    return (
      !!value &&
      Number.isFinite(value.lat) &&
      Number.isFinite(value.lon) &&
      Math.abs(value.lat) <= 90 &&
      Math.abs(value.lon) <= 180
    );
  }
  function observer(location) {
    if (!validLocation(location)) throw new Error('Choose a valid latitude and longitude.');
    return new A.Observer(location.lat, location.lon, 0);
  }
  function context(location, date) {
    date = new Date(date);
    if (!Number.isFinite(date.getTime())) throw new Error('Choose a valid date and time.');
    return { date, observer: observer(location), rotation: A.Rotation_EQJ_EQD(date) };
  }
  function horizontal(point, ctx) {
    const ra = point[0] * rad,
      dec = point[1] * rad;
    const v = new A.Vector(
      Math.cos(dec) * Math.cos(ra),
      Math.cos(dec) * Math.sin(ra),
      Math.sin(dec),
      ctx.date,
    );
    const eq = A.EquatorFromVector(A.RotateVector(ctx.rotation, v));
    const h = A.Horizon(ctx.date, ctx.observer, eq.ra, eq.dec, 'normal');
    return {
      alt: h.altitude,
      az: h.azimuth,
      direction: directions[Math.round(h.azimuth / 45) % 8],
    };
  }
  function bodyPosition(body, ctx) {
    const eq = A.Equator(body, ctx.date, ctx.observer, true, true);
    const h = A.Horizon(ctx.date, ctx.observer, eq.ra, eq.dec, 'normal');
    return {
      alt: h.altitude,
      az: h.azimuth,
      direction: directions[Math.round(h.azimuth / 45) % 8],
    };
  }
  function centre(points) {
    let x = 0,
      y = 0,
      z = 0;
    for (const [ra, dec] of points) {
      x += Math.cos(dec * rad) * Math.cos(ra * rad);
      y += Math.cos(dec * rad) * Math.sin(ra * rad);
      z += Math.sin(dec * rad);
    }
    return [Math.atan2(y, x) / rad, Math.atan2(z, Math.hypot(x, y)) / rad];
  }
  const entries = data.CONSTELLATIONS.map((c) => {
    const source = catalog[c.key],
      points = unique(source.lines);
    return { key: c.key, name: c.l1, ...source, points, centre: centre(points) };
  });
  function measure(entry, ctx) {
    const points = entry.points.map((p) => horizontal(p, ctx));
    const up = points.filter((p) => p.alt > 0).length;
    const clear = points.filter((p) => p.alt >= 15).length;
    return {
      ...horizontal(entry.centre, ctx),
      fraction: up / points.length,
      clearFraction: clear / points.length,
      status: up === points.length ? 'above' : up === 0 ? 'below' : 'partial',
      points,
    };
  }
  function snapshot(location, date, includeNight = true) {
    const ctx = context(location, date);
    const sun = bodyPosition('Sun', ctx),
      moon = bodyPosition('Moon', ctx);
    moon.illumination = A.Illumination('Moon', ctx.date).phase_fraction;
    const samples = [];
    if (includeNight)
      for (let step = 0; step <= 24; step++) {
        const sample = context(location, new Date(ctx.date.getTime() + step * 3600000));
        if (bodyPosition('Sun', sample).alt < -6) samples.push(sample);
      }
    return {
      location,
      date: ctx.date.toISOString(),
      sun,
      moon,
      dark: sun.alt < -6,
      constellations: entries.map((entry) => {
        const now = measure(entry, ctx);
        let best = null;
        for (const sample of samples) {
          const pos = horizontal(entry.centre, sample);
          if (pos.alt > 15 && (!best || pos.alt > best.alt)) {
            const m = measure(entry, sample);
            if (m.clearFraction >= 0.7) best = { ...pos, date: sample.date.toISOString() };
          }
        }
        return {
          ...entry,
          ...now,
          best,
          recommended: sun.alt < -6 && now.clearFraction >= 0.7,
          score: now.alt + (entry.rank === 1 ? 25 : entry.rank === 2 ? 5 : 0),
        };
      }),
    };
  }
  function candidates(sky, options = {}) {
    return sky.constellations
      .filter(
        (c) =>
          c.recommended &&
          (!options.target || c.key === options.target) &&
          (!options.direction || c.direction.includes(options.direction)),
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(5, Math.round((options.minutes || 15) / 5))));
  }
  function fieldPlan(sky, options = {}) {
    const targets = candidates(sky, options);
    return {
      source: 'Field guide',
      date: sky.date,
      location: sky.location,
      minutes: Number(options.minutes) || 15,
      introduction: targets.length
        ? 'Let your eyes settle into the dark. Start with the clearest view of the horizon, then work through these patterns.'
        : options.target
          ? `${entries.find((c) => c.key === options.target)?.name || 'This constellation'} is not suitable at this location, time and direction. Choose a time after dusk when its pattern is above the horizon.`
          : sky.dark
            ? 'No suitable patterns match this view. Try another direction or time.'
            : 'The sky is still bright at this time. Move the time forward to after dusk to plan your session.',
      steps: targets.map((c) => ({
        key: c.key,
        name: c.name,
        direction: c.direction,
        alt: Math.round(c.alt),
        instruction: fieldContent[c.key].recognise,
        task:
          options.equipment === 'binoculars' || options.equipment === 'telescope'
            ? fieldContent[c.key].see
            : '',
      })),
    };
  }
  return {
    validLocation,
    context,
    horizontal,
    bodyPosition,
    entries,
    measure,
    snapshot,
    candidates,
    fieldPlan,
  };
});
