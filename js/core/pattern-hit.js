(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NightSky.PatternHit = factory();
})(globalThis, function () {
  function distanceToSegment(x, y, a, b) {
    const dx = b.x - a.x,
      dy = b.y - a.y,
      t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
  }
  function pick(instances, renderer, cam, x, y) {
    let picked = -1,
      best = 20,
      inside = -1,
      insideScore = Infinity;
    instances.forEach((inst, index) => {
      const centre = renderer.worldToScreen(inst.x, inst.y, cam),
        scale = inst.scale * cam.z;
      const fig = renderer.getConstellationFigure(inst),
        points = fig.P.map((p) => ({ x: centre.x + p.x * scale, y: centre.y + p.y * scale }));
      if (!points.length) return;
      let distance = Math.min(...points.map((p) => Math.hypot(p.x - x, p.y - y)));
      const outline = new Set();
      for (const edge of fig.E) {
        if (renderer.isEdgeVisible && !renderer.isEdgeVisible(fig.P, edge)) continue;
        outline.add(edge[0]);
        outline.add(edge[1]);
        distance = Math.min(distance, distanceToSegment(x, y, points[edge[0]], points[edge[1]]));
      }
      if (distance < best) {
        best = distance;
        picked = index;
      }
      const bounds = [...outline].map((i) => points[i]);
      if (bounds.length < 2) return;
      const left = Math.min(...bounds.map((p) => p.x)),
        right = Math.max(...bounds.map((p) => p.x)),
        top = Math.min(...bounds.map((p) => p.y)),
        bottom = Math.max(...bounds.map((p) => p.y));
      if (x >= left - 12 && x <= right + 12 && y >= top - 12 && y <= bottom + 12) {
        const score = Math.hypot(
          (x - (left + right) / 2) / Math.max(right - left, 24),
          (y - (top + bottom) / 2) / Math.max(bottom - top, 24),
        );
        if (score < insideScore) {
          inside = index;
          insideScore = score;
        }
      }
    });
    return picked >= 0 ? picked : inside;
  }
  return { pick, distanceToSegment };
});
