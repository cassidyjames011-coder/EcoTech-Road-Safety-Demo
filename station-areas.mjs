// Approximate local simulation areas. This is not an operational jurisdiction map.
// Each cell is the nearest published home station inside its 4 km coverage circle.
export const DEMO_EXTENT = Object.freeze({ south: 53.22, west: -6.47, north: 53.39, east: -6.08 });
const METRES_PER_DEGREE = 111_320;
const ORIGIN_LAT = 53.31;
const ORIGIN_LON = -6.275;
const LON_SCALE = Math.cos(ORIGIN_LAT * Math.PI / 180) * METRES_PER_DEGREE;
const toXY = ([lat, lon]) => [(lon - ORIGIN_LON) * LON_SCALE, (lat - ORIGIN_LAT) * METRES_PER_DEGREE];
const toLatLon = ([x, y]) => [ORIGIN_LAT + y / METRES_PER_DEGREE, ORIGIN_LON + x / LON_SCALE];

function clip(polygon, nx, ny, limit) {
  if (!polygon.length) return [];
  const result = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index], b = polygon[(index + 1) % polygon.length];
    const va = nx * a[0] + ny * a[1] - limit;
    const vb = nx * b[0] + ny * b[1] - limit;
    if (va <= 0) result.push(a);
    if ((va < 0 && vb > 0) || (va > 0 && vb < 0)) {
      const t = va / (va - vb);
      result.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  return result;
}

export function stationAreaCells(bases, radiusMetres = 4000, extent = DEMO_EXTENT) {
  const stations = Object.entries(bases).map(([id, base]) =>
    ({ id, label: base.label, center: toXY(base.center) }));
  const southwest = toXY([extent.south, extent.west]);
  const northeast = toXY([extent.north, extent.east]);
  return stations.map(station => {
    const [cx, cy] = station.center;
    let polygon = Array.from({ length: 96 }, (_, index) => {
      const angle = index * 2 * Math.PI / 96;
      return [cx + radiusMetres * Math.cos(angle), cy + radiusMetres * Math.sin(angle)];
    });
    polygon = clip(polygon, -1, 0, -southwest[0]);
    polygon = clip(polygon, 1, 0, northeast[0]);
    polygon = clip(polygon, 0, -1, -southwest[1]);
    polygon = clip(polygon, 0, 1, northeast[1]);
    for (const other of stations) {
      if (other.id === station.id) continue;
      const nx = other.center[0] - cx, ny = other.center[1] - cy;
      const limit = (other.center[0] ** 2 + other.center[1] ** 2 - cx ** 2 - cy ** 2) / 2;
      polygon = clip(polygon, nx, ny, limit);
    }
    return { id: station.id, label: station.label, points: polygon.map(toLatLon) };
  });
}

export function stationDividingLines(bases, cells = stationAreaCells(bases)) {
  const centers = Object.entries(bases).map(([id, base]) => ({ id, xy: toXY(base.center) }));
  const lines = new Map();
  for (const cell of cells) {
    for (let index = 0; index < cell.points.length; index += 1) {
      const a = cell.points[index], b = cell.points[(index + 1) % cell.points.length];
      const mid = toXY([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
      const distances = centers.map(({ id, xy }) => ({ id, metres: Math.hypot(mid[0] - xy[0], mid[1] - xy[1]) }))
        .sort((left, right) => left.metres - right.metres);
      if (distances.length < 2 || Math.abs(distances[0].metres - distances[1].metres) > 5 ||
          ![distances[0].id, distances[1].id].includes(cell.id)) continue;
      const keys = [a, b].map(point => point.map(value => value.toFixed(6)).join(',')).sort();
      lines.set(keys.join('|'), [a, b]);
    }
  }
  return [...lines.values()];
}
