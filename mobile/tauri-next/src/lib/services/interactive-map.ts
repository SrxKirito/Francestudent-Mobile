export interface MapPoint { x: number; y: number }
export interface MapMarker extends MapPoint { places: number[] }

export function groupMapMarkers(points: MapPoint[], unitsPerPixel: number): MapMarker[] {
  const touchDistance = 44 * unitsPerPixel;
  const remaining = new Set(points.keys());
  const markers: MapMarker[] = [];
  for (const first of remaining) {
    remaining.delete(first);
    const places = [first];
    let x = 0;
    let y = 0;
    for (const index of places) {
      const point = points[index];
      x += point.x;
      y += point.y;
      for (const candidate of remaining) {
        const next = points[candidate];
        if (Math.hypot(point.x - next.x, point.y - next.y) >= touchDistance) continue;
        remaining.delete(candidate);
        places.push(candidate);
      }
    }
    markers.push({ x: x / places.length, y: y / places.length, places });
  }
  return markers;
}

export function mapSpan(scale: number, aspect: number): { width: number; height: number } {
  const width = Math.max(360, 180 * aspect);
  return { width: width / scale, height: width / aspect / scale };
}
