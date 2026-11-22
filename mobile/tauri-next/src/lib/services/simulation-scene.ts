import { calculate, number, type Formula, type Point3D, type SimulationScene } from "./interactive-widgets.ts";

type Face = { points: Point3D[]; color: string };
type ScenePoint = { position: Point3D; label: string };
export type SceneCamera = { yaw: number; pitch: number; zoom: number };
export const DEFAULT_SCENE_CAMERA: SceneCamera = { yaw: -.63, pitch: .47, zoom: 1 };
export const SCENE_WIDTH = 400;
export const SCENE_HEIGHT = 260;
const COLORS = ["#5371dc", "#238e83", "#b06438", "#9354ad"];
const SIDES = 12;

function evaluatePosition(formulas: [Formula, Formula, Formula], values: unknown[]): Point3D | undefined {
  const [x, y, z] = formulas.map(formula => calculate(formula, values));
  return number(x) && number(y) && number(z) ? [x, y, z] : undefined;
}

function boxFaces(center: Point3D, size: Point3D): Point3D[][] {
  const [x, y, z] = center;
  const [w, d, h] = size.map(length => length / 2);
  const corners: Point3D[] = [
    [x - w, y - d, z - h], [x + w, y - d, z - h], [x + w, y + d, z - h], [x - w, y + d, z - h],
    [x - w, y - d, z + h], [x + w, y - d, z + h], [x + w, y + d, z + h], [x - w, y + d, z + h]
  ];
  return [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]
    .map(face => face.map(index => corners[index]));
}

function ring(center: Point3D, radius: number, height: number): Point3D[] {
  const [x, y, z] = center;
  return Array.from({ length: SIDES }, (_, index) => {
    const angle = 2 * Math.PI * index / SIDES;
    return [x + radius * Math.cos(angle), y + radius * Math.sin(angle), z + height];
  });
}

function ringFaces(lower: Point3D[], upper: Point3D[]): Point3D[][] {
  return lower.map((point, index) => {
    const next = (index + 1) % SIDES;
    return [point, lower[next], upper[next], upper[index]];
  });
}

function sphereFaces(center: Point3D, radius: number): Point3D[][] {
  const bands = 6;
  const rings = Array.from({ length: bands - 1 }, (_, index) => {
    const latitude = Math.PI * ((index + 1) / bands - .5);
    return ring(center, radius * Math.cos(latitude), radius * Math.sin(latitude));
  });
  const [x, y, z] = center;
  const poles: [Point3D, Point3D] = [[x, y, z - radius], [x, y, z + radius]];
  return [
    ...rings[0].map((point, index) => [poles[0], point, rings[0][(index + 1) % SIDES]]),
    ...rings.slice(0, -1).flatMap((lower, index) => ringFaces(lower, rings[index + 1])),
    ...rings[bands - 2].map((point, index, upper) => [point, upper[(index + 1) % SIDES], poles[1]])
  ];
}

export function evaluateSimulationScene(scene: SimulationScene, values: unknown[]) {
  const points = new Map<string, ScenePoint>();
  for (const point of scene.points) {
    const position = evaluatePosition(point.position, values);
    if (position) points.set(point.id, { position, label: point.label });
  }
  const faces: Face[] = scene.faces.flatMap(({ ids, color }) => {
    const vertices = ids.map(id => points.get(id)?.position);
    return vertices.every((point): point is Point3D => point !== undefined) ? [{ points: vertices, color: color || COLORS[0] }] : [];
  });
  for (const [index, object] of scene.objects.entries()) {
    const center = evaluatePosition(object.center, values);
    if (!center) continue;
    let geometry: Point3D[][];
    if (object.kind === "box") {
      const size = evaluatePosition(object.size, values);
      if (!size || size.some(length => length <= 0)) continue;
      geometry = boxFaces(center, size);
    } else {
      const radius = calculate(object.radius, values);
      if (!number(radius) || radius <= 0) continue;
      if (object.kind === "sphere") geometry = sphereFaces(center, radius);
      else {
        const height = calculate(object.height, values);
        if (!number(height) || height <= 0) continue;
        const lower = ring(center, radius, -height / 2);
        if (object.kind === "cone") {
          const apex: Point3D = [center[0], center[1], center[2] + height / 2];
          geometry = [lower, ...lower.map((point, i) => [point, lower[(i + 1) % SIDES], apex])];
        } else {
          const upper = ring(center, radius, height / 2);
          geometry = [lower, upper, ...ringFaces(lower, upper)];
        }
      }
    }
    const color = object.color || COLORS[index];
    for (const face of geometry) faces.push({ points: face, color });
  }
  return { points, faces };
}

export function sceneProjection([lower, upper]: SimulationScene["bounds"], { yaw, pitch, zoom }: SceneCamera) {
  const center = lower.map((min, index) => (min + upper[index]) / 2);
  const diagonal = Math.hypot(...lower.map((min, index) => upper[index] - min));
  const scale = zoom * (SCENE_HEIGHT - 36) / diagonal;
  const cosYaw = Math.cos(yaw), sinYaw = Math.sin(yaw), cosPitch = Math.cos(pitch), sinPitch = Math.sin(pitch);
  return ([worldX, worldY, worldZ]: Point3D) => {
    const x = worldX - center[0], y = worldY - center[1], z = worldZ - center[2];
    const side = cosYaw * x + sinYaw * y;
    const forward = -sinYaw * x + cosYaw * y;
    return { x: SCENE_WIDTH / 2 + side * scale, y: SCENE_HEIGHT / 2 - (z * cosPitch - forward * sinPitch) * scale,
      depth: forward * cosPitch + z * sinPitch };
  };
}

export function sceneFaceColor(hex: string, intensity: number): string {
  const tint = (offset: number) => Math.min(255, Math.round(parseInt(hex.slice(offset, offset + 2), 16) * intensity));
  return "rgb(" + tint(1) + "," + tint(3) + "," + tint(5) + ")";
}
