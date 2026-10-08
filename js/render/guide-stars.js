(function () {
  'use strict';
  let canvas,
    ctx,
    stars = [],
    width = 0,
    height = 0,
    frame = 0,
    active = false,
    start = 0;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  function resize() {
    width = innerWidth;
    height = innerHeight;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    stars = Array.from({ length: Math.min(200, Math.round((width * height) / 4500)) }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      r: 0.35 + Math.random() * 1.2,
      s: Math.random() * 6,
      p: Math.random() * Math.PI * 2,
    }));
    if (active && reduced.matches) draw(0);
  }
  function draw(now) {
    ctx.clearRect(0, 0, width, height);
    const t = reduced.matches ? 0 : (now - start) / 1000;
    for (const star of stars) {
      const alpha = 0.2 + 0.5 * (0.5 + 0.5 * Math.sin(t * 0.7 + star.p));
      const y = (star.y - t * star.s * 0.2 + height * 100) % height;
      ctx.beginPath();
      ctx.arc(star.x + Math.sin(t * 0.1 + star.p) * 3, y, star.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(181,212,238,${alpha})`;
      ctx.fill();
      if (star.r > 1.2) {
        ctx.shadowColor = '#a9c4dc';
        ctx.shadowBlur = 6;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
    if (!reduced.matches && t % 17 < 1.3) {
      const progress = (t % 17) / 1.3;
      const x = width * 0.8 - progress * width * 0.35,
        y = height * 0.1 + progress * height * 0.22;
      const gradient = ctx.createLinearGradient(x, y, x + 70, y - 45);
      gradient.addColorStop(0, '#c6e2ff');
      gradient.addColorStop(1, '#a9c4dc00');
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 70, y - 45);
      ctx.stroke();
    }
    if (active && !reduced.matches) frame = requestAnimationFrame(draw);
  }
  function open() {
    canvas = document.getElementById('guideStars');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    if (!ctx) return;
    active = true;
    start = performance.now();
    resize();
    cancelAnimationFrame(frame);
    draw(start);
  }
  function close() {
    active = false;
    cancelAnimationFrame(frame);
  }
  addEventListener('resize', () => {
    if (canvas && ctx) resize();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) close();
    else if (!document.getElementById('skyGuide').hidden) open();
  });
  reduced.addEventListener('change', () => {
    if (!document.hidden && !document.getElementById('skyGuide').hidden) open();
  });
  NightSky.GuideStars = { open, close };
})();
