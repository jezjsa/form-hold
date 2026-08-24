const TAU = Math.PI * 2;

export function hexPoints(cx, cy, radius, rotation = Math.PI / 6) {
  const pts = [];
  for (let i = 0; i < 6; i += 1) {
    const a = rotation + (i * TAU) / 6;
    pts.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius });
  }
  return pts;
}

export function hexEdges(points, skipIndex) {
  const edges = [];
  for (let i = 0; i < 6; i += 1) {
    if (i === skipIndex) continue;
    edges.push({ a: points[i], b: points[(i + 1) % 6] });
  }
  return edges;
}

export function pointInHex(px, py, cx, cy, radius, rotation = Math.PI / 6) {
  const dx = px - cx;
  const dy = py - cy;
  const c = Math.cos(-rotation);
  const s = Math.sin(-rotation);
  const x = dx * c - dy * s;
  const y = dx * s + dy * c;
  const qx = Math.abs(x);
  const qy = Math.abs(y);
  return qx * 0.8660254 + qy * 0.5 <= radius && qy <= radius * 0.8660254;
}

export function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy || 1;
  let t = ((px - ax) * vx + (py - ay) * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  const x = ax + vx * t;
  const y = ay + vy * t;
  const dx = px - x;
  const dy = py - y;
  return { dist: Math.hypot(dx, dy), x, y, nx: dx, ny: dy };
}

export function nearestEdge(px, py, edges) {
  let best = null;
  for (const edge of edges) {
    const hit = distToSegment(px, py, edge.a.x, edge.a.y, edge.b.x, edge.b.y);
    if (!best || hit.dist < best.dist) best = { ...hit, edge };
  }
  return best;
}
