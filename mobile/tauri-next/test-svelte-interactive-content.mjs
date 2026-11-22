import assert from "node:assert/strict";
import { parseInteractiveContent } from "./src/lib/services/interactive-content.ts";
import { dashboardRows, dashboardValue, dashboardSeries, dashboardCsv } from "./src/lib/services/interactive-dashboard.ts";
import { DEFAULT_SCENE_CAMERA, evaluateSimulationScene, sceneProjection } from "./src/lib/services/simulation-scene.ts";
import { advanceSimulationPlayback, calculate, sampleSimulationPlot, simulationPlotProbe, snapSimulationField } from "./src/lib/services/interactive-widgets.ts";
import { readDelimited, readSheets } from "./src/lib/services/preview-formats.ts";
import { generatedArtifacts } from "./src/lib/services/file-preview.ts";
import { parseMarkdownBlocks } from "./src/lib/services/markdown.ts";
import { chatPrompt, isDedicatedFormatPrompt } from "./src/lib/services/native-chat-prompts.ts";
import { stripInteractiveRenderGuide, withInteractiveRenderGuide } from "./src/lib/services/interactive-prompts.ts";

const parse = fields => parseInteractiveContent("frst-ui", JSON.stringify({ version: 1, ...fields }));
const chart = (kind, points) => parse({ kind: "chart", chart: kind, series: [{ name: "Résultats", points }] });
const points = [{ label: "A", x: -2, y: 4 }, { label: "B", x: 0, y: -7 }];
assert.equal(chart("line", points).series[0].points[1].x, 1);
assert.equal(chart("bar", points).series[0].points[1].y, -7);
assert.equal(chart("pie", points).series[0].points.length, 1);
assert.equal(chart("scatter", points).series[0].points[0].x, -2);
assert.equal(chart("scatter", [{ y: 3 }]), null);
assert.equal(chart("pie", [{ y: -1 }]), null);
assert.equal(chart("line", [{ y: 1e90 }]), null);
assert.equal(chart("line", Array.from({ length: 100 }, () => ({ y: 1 }))).series[0].points.length, 60);
assert.equal(parse({ kind: "html", content: "<script>alert(1)</script>" }), null);
assert.equal(parse({ version: 2, kind: "checklist", items: ["Élément"] }), null);
assert.equal(parseInteractiveContent("frst-ui", " ".repeat(50_001)), null);
assert.deepEqual(parse({ kind: "checklist", items: [false, ' <img src=x onerror=alert(1)> '] }).items, ["<img src=x onerror=alert(1)>"]);
assert.equal(parse({ kind: "accordion", items: [{ title: "Détail", content: "Du texte" }] }).items[0].content, "Du texte");
assert.equal(parseInteractiveContent("cards", '{"cards":[{"q":"Q","a":"R"}]}').kind, "study");
const fence = String.fromCharCode(96).repeat(3);
const block = parseMarkdownBlocks(fence + 'frst-ui\n{"version":1,"kind":"checklist","items":["a"]}\n' + fence)[0];
assert.equal(block.language, "frst-ui");
assert.equal(block.open, false);
const options = { studyMode: "", powerpointMode: false };
assert.equal(chatPrompt("Bonjour", options), "Bonjour");
const mixedRequest = "Fais un quiz, une carte interactive, un calculateur et un tableau de bord HTML.";
assert.equal(chatPrompt(mixedRequest, options), mixedRequest);
const combined = withInteractiveRenderGuide(mixedRequest, mixedRequest);
assert.match(combined, /Combine plusieurs blocs/);
assert.match(combined, /Un bloc quiz/);
assert.match(combined, /"kind":"simulator"/);
assert.match(combined, /"type":"range"/);
assert.match(combined, /"type":"select"/);
assert.match(combined, /"choice":"v","values":\[3,4,6\]/);
assert.match(combined, /un bloc html/);
assert.equal(stripInteractiveRenderGuide(combined), mixedRequest);
const retry = withInteractiveRenderGuide("Test", "Test");
assert.match(retry, /un essai de rendu demandé dans un tour précédent/);
assert.match(retry, /Choisis toi-même un rendu/);
assert.equal(stripInteractiveRenderGuide(retry), "Test");
assert.equal(isDedicatedFormatPrompt(chatPrompt("Crée un PowerPoint", options)), true);
assert.equal(isDedicatedFormatPrompt(chatPrompt("Révision", { ...options, studyMode: "quiz" })), false);
const table = parse({ kind: "table", columns: ["Nom", "Quantité"], rows: [["Deux", 2], ["Un", 1]] });
assert.deepEqual(table.rows[1], ["Un", 1]);
assert.equal(parse({ kind: "table", columns: [null], rows: [["Un"]] }), null);
const dashboard = parse({
  kind: "dashboard", columns: ["Région", "Mois", "Montant"], filters: [0, 1, 0, 7],
  rows: [["Nord", "Janvier", 10], ["Nord", "Février", 20], ["Sud", "Janvier", 50], ["Sud", "Février", null]],
  metrics: [{ label: "Recettes", op: "sum", column: 2 }, { label: "Lignes", op: "count" }, { label: "Faux", op: "sum", column: 5 }],
  charts: [{ label: "Par mois", chart: "bar", group: 1, op: "average", column: 2 }]
});
assert.deepEqual(dashboard.filters, [0, 1]);
assert.equal(dashboard.metrics.length, 2);
const selectedRows = dashboardRows(dashboard, new Map([[0, "Nord"]]), "");
assert.equal(dashboardValue(selectedRows, dashboard.metrics[0].aggregate), 30);
assert.deepEqual(dashboardSeries(selectedRows, dashboard.charts[0]).series[0].points.map(point => point.y), [10, 20]);
assert.equal(dashboardRows(dashboard, new Map([[0, "Nord"]]), "fevrier").length, 0);
assert.equal(dashboardRows(dashboard, new Map([[0, "Nord"]]), "FÉVRIER").length, 1);
assert.match(dashboardCsv(["Libellé", "Valeur"], [["=1+1", -3]]), /"'=1\+1","-3"/);
const fields = [{ id: "value", label: "Intensité", type: "range", min: 0, max: 100, value: 35 }];
const simulator = formula => parse({ kind: "simulator", fields, results: [{ label: "Puissance", unit: "W", formula }] });
const power = simulator({ op: "mul", args: [{ field: "value" }, 2] });
assert.equal(calculate(power.results[0].formula, [35]), 70);
assert.equal(calculate(power.results[0].formula, [20]), 40);
assert.equal(simulator({ op: "fetch", args: ["https://example.org"] }), null);
assert.equal(simulator({ op: "constructor", args: [1, 2] }), null);
assert.equal(simulator({ field: "secret" }), null);
const duration = parse({ kind: "simulator", fields: [
  { id: "d", label: "Distance", type: "range", min: 1, max: 30, defaultValue: 10 },
  { id: "v", label: "Allure", type: "select", options: [{ label: "Modérée", value: 4 }, { label: "Rapide", value: 5 }], default: 4 }
], results: [{ label: "Durée", formula: { op: "div", args: [{ field: "d" }, { field: "v" }] } }] });
assert.equal(calculate(duration.results[0].formula, duration.fields.map(field => field.value)), 2.5);
assert.equal(calculate(duration.results[0].formula, [10, "Rapide"]), 2);
const lab = parse({ kind: "simulator", fields: [
  { id: "a", label: "Pente", type: "range", min: 1, max: 5, value: 2 }
], plot: { min: -2, max: 2, curves: [
  { label: "Droite", formula: { op: "mul", args: [{ field: "a" }, { x: true }] } },
  { label: "Inverse", formula: { op: "div", args: [1, { x: true }] } }
] }, drawing: {
  bounds: [-2, -2, 6, 6], points: [
    { id: "A", x: 0, y: 0 }, { id: "B", x: { field: "a" }, y: 1, drag: true },
    { id: "C", x: { op: "mul", args: [{ field: "a" }, 2] }, y: 1, drag: true }
  ],
  shapes: [{ points: ["A", "B"], arrow: true }, { points: ["A", "inconnu"] }, { kind: "circle", center: "A", radius: { field: "a" } }]
} });
assert.equal(sampleSimulationPlot(lab.plot, [2])[0].points.at(-1).y, 4);
assert.equal(sampleSimulationPlot(lab.plot, [3])[0].points.at(-1).y, 6);
assert.equal(sampleSimulationPlot(lab.plot, [2])[1].points.find(point => point.x > 0).breakBefore, true);
assert.equal(calculate(lab.drawing.points[1].x, [3]), 3);
assert.equal(lab.drawing.points[1].dragX, 0);
assert.equal(lab.drawing.points[1].dragY, undefined);
assert.equal(lab.drawing.points[2].dragX, undefined);
assert.equal(lab.drawing.shapes.length, 2);
assert.equal(lab.drawing.shapes[0].arrow, true);
assert.equal(calculate(lab.drawing.shapes[1].radius, [4]), 4);
assert.equal(snapSimulationField({ min: 0.1, max: 2, step: 0.25 }, 0.55), 0.6);
assert.equal(snapSimulationField({ min: 0.1, max: 2, step: 0.25 }, 4), 1.85);
const timed = parse({ kind: "simulator",
  fields: [{ id: "t", label: "Temps", type: "range", min: 0, max: 4, step: .1, value: 0 }],
  plot: { min: 0, max: 4, cursor: "t", curves: [{ label: "Position", formula: { op: "pow", args: [{ x: true }, 2] } }] },
  playback: { field: "t", duration: 4 }
});
assert.deepEqual(timed.playback, { field: 0, durationMs: 4000 });
assert.deepEqual(simulationPlotProbe(timed.plot, [2]), { x: 2, points: [{ series: "Position", y: 4 }] });
assert.equal(simulationPlotProbe(timed.plot, [5]), undefined);
assert.deepEqual(advanceSimulationPlayback(.25, 1000, 4000, false), { progress: .5, ended: false });
assert.deepEqual(advanceSimulationPlayback(.75, 2000, 4000, false), { progress: 1, ended: true });
assert.deepEqual(advanceSimulationPlayback(.75, 2000, 4000, true), { progress: .25, ended: false });
const solid = parse({ kind: "simulator", fields: [{ id: "w", label: "Largeur", type: "range", min: 0, max: 5, value: 2 }],
  scene: { bounds: [-3, -3, -3, 3, 3, 3], objects: [{ kind: "box", center: [0, 0, 0], size: [{ field: "w" }, 2, 2] }],
    points: [{ id: "A", position: [0, 0, 0] }, { id: "B", position: [0, 1, 1] }],
    faces: [{ points: ["A", "B"] }, { points: ["A", "absent"] }] }
});
assert.equal(solid.scene.faces.length, 1);
assert.equal(evaluateSimulationScene(solid.scene, [2]).faces.length, 7);
assert.equal(evaluateSimulationScene(solid.scene, [0]).faces.length, 1);
assert.notDeepEqual(evaluateSimulationScene(solid.scene, [2]).faces[1], evaluateSimulationScene(solid.scene, [4]).faces[1]);
const projectScene = sceneProjection(solid.scene.bounds, DEFAULT_SCENE_CAMERA);
const rotatedScene = sceneProjection(solid.scene.bounds, { ...DEFAULT_SCENE_CAMERA, yaw: 1 });
assert.notDeepEqual(projectScene([1, 0, 0]), rotatedScene([1, 0, 0]));
assert.equal(parse({ kind: "simulator", scene: { bounds: [-2, -2, -2, 2, 2, 2], objects: [
  { kind: "sphere", center: [0, 0, 0], radius: 1 }, { kind: "cylinder", center: [0, 0, 0], radius: 1, height: 2 }
] } }).scene.objects.length, 2);
assert.equal(simulator({ x: true }), null);
assert.equal(parse({ kind: "form", fields: Array.from({ length: 25 }, () => fields[0]) }).fields.length, 1);
assert.equal(parse({ kind: "map", places: [{ title: "Illisible", lat: 100, lon: 1 }] }), null);
assert.deepEqual(parse({ kind: "diagram", items: [{ title: "A" }, { title: "B" }], edges: [[0, 1], [1, 9]] }).edges, [[0, 1]]);
const cards = parse({ kind: "carousel", items: [{ title: "Inerte", url: "javascript:alert(1)", image: "https://example.org/a.png" }] });
assert.equal(cards.items[0].href, "");
assert.equal(cards.items[0].image, "");
assert.equal(readDelimited("Courses", 'Nom;Valeur\r\n"Jean; Dupond";12\r\n"multi\nligne";13').rows[1][0], "multi\nligne");
assert.equal(readSheets("--- Feuille Budget ---\nNom\tValeur\nCoût\t12")[0].title, "Budget");
assert.equal(generatedArtifacts(fence + 'frst-ui\n{"version":1,"kind":"checklist","items":["a"]}\n' + fence).length, 0);
for (const [request, kind] of [
  ["fais-moi un tableau interactif", "table"], ["ouvre un simulateur", "simulator"], ["crée une carte interactive", "map"],
  ["prépare une frise chronologique", "timeline"], ["fais un formulaire", "form"], ["donne la météo", "cards"]
]) assert.match(withInteractiveRenderGuide(request, request), new RegExp('"kind":"' + kind + '"'));
console.log("Rendus structurés : formats, bornes, données inertes et reconnaissance du bloc vérifiés.");
