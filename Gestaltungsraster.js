/**
 * name: Gestaltungsraster-Generator
 * description: Legt 14 gängige Gestaltungsraster (Spalten-, Modul-, Manuskript-, hierarchisches Raster, Grundlinien, Satzspiegel nach Van de Graaf/Tschichold, Goldener Schnitt, Drittelregel, Fibonacci-Spirale, dynamische Symmetrie, Quadrat-/Punktraster, isometrisches/Dreiecks-, Hexagonal- und Polarraster) als Linienobjekte auf einer neuen Ebene an. Zweistufiger Dialog: erst Rastertyp, dann typspezifische Einstellungen (Ränder, Spaltenzahl, Abstände, Linienfarbe, Linienstärke ...). Bezugsfläche ist das markierte Objekt (bei mehreren Objekten deren Gesamtrahmen), sonst das markierte Artboard bzw. die aktuelle Seite.
 * version: 1.1.0
 */
'use strict';

const { Document } = require('/document.js');
const { Dialog, DialogResult } = require('/dialog.js');
const { AddChildNodesCommandBuilder } = require('/commands.js');
const { ContainerNodeDefinition, NodeChildType, PolyCurveNodeDefinition } = require('/nodes.js');
const { Curve, CurveBuilder, PolyCurve, Rectangle, unionRects } = require('/geometry.js');
const { FillDescriptor } = require('/fills.js');
const { LineStyleDescriptor } = require('/linestyle.js');
const { RGBA8 } = require('/colours.js');
const { UnitType } = require('/units.js');

const PHI = (1 + Math.sqrt(5)) / 2;
const MAX_ELEMENTS = 6000;
const EPS = 1e-6;

// ---------------------------------------------------------------------------
// Geometrie-Helfer (alle Koordinaten in Pixeln im Spread-Koordinatensystem)
// ---------------------------------------------------------------------------

function pt(x, y) { return { x: x, y: y }; }

function polyline(points, closed) {
    const b = CurveBuilder.create();
    b.begin(points[0]);
    for (let i = 1; i < points.length; i++) b.lineTo(points[i]);
    if (closed) b.close();
    return b.createCurve();
}

function lineCurve(a, b) { return polyline([a, b], false); }

function rectCurve(x, y, w, h) {
    return polyline([pt(x, y), pt(x + w, y), pt(x + w, y + h), pt(x, y + h)], true);
}

function circleCurve(cx, cy, r) {
    return Curve.createEllipse(new Rectangle(cx - r, cy - r, 2 * r, 2 * r));
}

function guard(n) {
    if (n > MAX_ELEMENTS) {
        throw new Error('Das Raster würde ' + Math.round(n) + ' Elemente erzeugen (Maximum ' + MAX_ELEMENTS + '). Bitte Zellen-/Abstandswerte vergrößern.');
    }
}

// Liang-Barsky: Strecke auf Rechteck r {x,y,w,h} beschneiden
function clipSeg(x0, y0, x1, y1, r) {
    let t0 = 0, t1 = 1;
    const dx = x1 - x0, dy = y1 - y0;
    const p = [-dx, dx, -dy, dy];
    const q = [x0 - r.x, r.x + r.w - x0, y0 - r.y, r.y + r.h - y0];
    for (let i = 0; i < 4; i++) {
        if (p[i] === 0) {
            if (q[i] < -EPS) return null;
        } else {
            const t = q[i] / p[i];
            if (p[i] < 0) { if (t > t1) return null; if (t > t0) t0 = t; }
            else { if (t < t0) return null; if (t < t1) t1 = t; }
        }
    }
    if (t1 - t0 < 1e-9) return null;
    return [pt(x0 + t0 * dx, y0 + t0 * dy), pt(x0 + t1 * dx, y0 + t1 * dy)];
}

// Schar paralleler Linien (Winkel ang, Abstand spacing), alle durch Raster-Ursprung O ausgerichtet
function lineFamily(O, ang, spacing, r, out) {
    const ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy, ny = ux;
    let dmin = Infinity, dmax = -Infinity;
    for (const c of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]]) {
        const d = (c[0] - O.x) * nx + (c[1] - O.y) * ny;
        dmin = Math.min(dmin, d); dmax = Math.max(dmax, d);
    }
    const k0 = Math.ceil(dmin / spacing - 1e-9), k1 = Math.floor(dmax / spacing + 1e-9);
    guard(k1 - k0 + 1);
    const L = 2 * Math.hypot(r.w, r.h);
    for (let k = k0; k <= k1; k++) {
        const px = O.x + k * spacing * nx, py = O.y + k * spacing * ny;
        const seg = clipSeg(px - ux * L, py - uy * L, px + ux * L, py + uy * L, r);
        if (seg) out.push(lineCurve(seg[0], seg[1]));
    }
}

function innerRect(F, mT, mB, mL, mR) {
    const r = { x: F.x + mL, y: F.y + mT, w: F.w - mL - mR, h: F.h - mT - mB };
    if (r.w <= 0 || r.h <= 0) throw new Error('Die Ränder sind zu groß für die Fläche.');
    return r;
}

function uniformInner(F, m) { return innerRect(F, m, m, m, m); }

function node(name, curves, filled) { return { name: name, curves: curves, filled: !!filled }; }

// ---------------------------------------------------------------------------
// Feld-Spezifikationen für den Einstellungsdialog
// ---------------------------------------------------------------------------

function fPx(key, label, def, group, o) { return Object.assign({ key, label, kind: 'px', def, group, min: 0, max: null, col: 0 }, o || {}); }
function fInt(key, label, def, min, max, group, o) { return Object.assign({ key, label, kind: 'int', def, min, max, group, col: 0 }, o || {}); }
function fNum(key, label, def, min, max, group, o) { return Object.assign({ key, label, kind: 'num', def, min, max, group, col: 0, prec: 2 }, o || {}); }
function fDeg(key, label, def, min, max, group, o) { return Object.assign({ key, label, kind: 'deg', def, min, max, group, col: 0 }, o || {}); }
function fChk(key, label, def, group, o) { return Object.assign({ key, label, kind: 'check', def, group, col: 0 }, o || {}); }
function fCmb(key, label, items, def, group, o) { return Object.assign({ key, label, kind: 'combo', items, def, group, col: 0 }, o || {}); }
function fTxt(key, label, def, group, o) { return Object.assign({ key, label, kind: 'text', def, group, col: 0 }, o || {}); }

function marginFields(F, frac) {
    const m = Math.round(Math.min(F.w, F.h) * (frac === undefined ? 0.06 : frac));
    return [
        fPx('mT', 'Rand oben', m, 'Ränder', { col: 1 }),
        fPx('mB', 'Rand unten', m, 'Ränder', { col: 1 }),
        fPx('mL', 'Rand links', m, 'Ränder', { col: 1 }),
        fPx('mR', 'Rand rechts', m, 'Ränder', { col: 1 }),
    ];
}

function marginField(F, frac) {
    const m = Math.round(Math.min(F.w, F.h) * (frac === undefined ? 0.06 : frac));
    return [fPx('m', 'Rand (alle Seiten)', m, 'Rand', { col: 1 })];
}

function appearanceFields(typeName) {
    return [
        { key: 'colour', label: 'Linienfarbe', kind: 'colour', def: RGBA8(0, 170, 255, 255), group: 'Darstellung', col: 1 },
        fPx('weight', 'Linienstärke', 1, 'Darstellung', { col: 1, min: 0.1 }),
        fTxt('layerName', 'Ebenenname', 'Raster – ' + typeName, 'Darstellung', { col: 1 }),
    ];
}

function parseRatios(text, label) {
    const parts = String(text).split(/[:;,\s]+/).map(Number).filter(v => Number.isFinite(v) && v > 0);
    if (parts.length === 0) throw new Error('Ungültige Eingabe bei "' + label + '". Beispiel: 1:2:1');
    return parts;
}

// ---------------------------------------------------------------------------
// Rastertypen
// ---------------------------------------------------------------------------

const TYPES = [
    // ---------------- Spalten- und Modulraster ----------------
    {
        id: 'columns', cat: 'Spalten & Module', name: 'Spaltenraster',
        desc: 'Klassisches Spaltenraster: Ränder, Spaltenzahl, Spaltenabstand (Stege).',
        fields: (F) => [
            fInt('cols', 'Spaltenzahl', 12, 1, 100, 'Spalten'),
            fPx('gutter', 'Spaltenabstand', Math.round(Math.min(F.w, F.h) * 0.02), 'Spalten'),
            ...marginFields(F),
        ],
        build: (p, F) => {
            const r = innerRect(F, p.mT, p.mB, p.mL, p.mR);
            const n = p.cols, g = p.gutter;
            const cw = (r.w - (n - 1) * g) / n;
            if (cw <= 0) throw new Error('Spaltenabstand und Spaltenzahl passen nicht in die Satzfläche.');
            const cols = [];
            for (let i = 0; i < n; i++) cols.push(rectCurve(r.x + i * (cw + g), r.y, cw, r.h));
            return [node('Spalten', cols)];
        },
    },
    {
        id: 'modules', cat: 'Spalten & Module', name: 'Modulraster',
        desc: 'Spalten × Zeilen: gleich große Module mit Spalten- und Zeilenabstand (z. B. Brockmann, Gerstner).',
        fields: (F) => {
            const g = Math.round(Math.min(F.w, F.h) * 0.02);
            return [
                fInt('cols', 'Spalten', 6, 1, 64, 'Module'),
                fInt('rows', 'Zeilen', 8, 1, 64, 'Module'),
                fPx('gx', 'Spaltenabstand', g, 'Module'),
                fPx('gy', 'Zeilenabstand', g, 'Module'),
                ...marginFields(F),
            ];
        },
        build: (p, F) => {
            const r = innerRect(F, p.mT, p.mB, p.mL, p.mR);
            const mw = (r.w - (p.cols - 1) * p.gx) / p.cols;
            const mh = (r.h - (p.rows - 1) * p.gy) / p.rows;
            if (mw <= 0 || mh <= 0) throw new Error('Abstände und Modulzahl passen nicht in die Satzfläche.');
            guard(p.cols * p.rows);
            const mods = [];
            for (let j = 0; j < p.rows; j++)
                for (let i = 0; i < p.cols; i++)
                    mods.push(rectCurve(r.x + i * (mw + p.gx), r.y + j * (mh + p.gy), mw, mh));
            return [node('Module', mods)];
        },
    },
    {
        id: 'manuscript', cat: 'Spalten & Module', name: 'Manuskriptraster',
        desc: 'Ein einziger großer Satzspiegel (Buch, Brief, Fließtext). Optional mit Kopf- und Fußbereich.',
        fields: (F) => [
            fPx('head', 'Kopfbereich (0 = aus)', 0, 'Bereiche'),
            fPx('foot', 'Fußbereich (0 = aus)', 0, 'Bereiche'),
            ...marginFields(F, 0.1),
        ],
        build: (p, F) => {
            const r = innerRect(F, p.mT, p.mB, p.mL, p.mR);
            const out = [node('Satzspiegel', [rectCurve(r.x, r.y, r.w, r.h)])];
            const seps = [];
            if (p.head > 0 && p.head < r.h) seps.push(lineCurve(pt(r.x, r.y + p.head), pt(r.x + r.w, r.y + p.head)));
            if (p.foot > 0 && p.foot < r.h) seps.push(lineCurve(pt(r.x, r.y + r.h - p.foot), pt(r.x + r.w, r.y + r.h - p.foot)));
            if (seps.length) out.push(node('Kopf-/Fußbereich', seps));
            return out;
        },
    },
    {
        id: 'hierarchical', cat: 'Spalten & Module', name: 'Hierarchisches Raster',
        desc: 'Spalten und Zeilen in frei wählbaren Verhältnissen, z. B. 1:2:1 oder 1:1:2 (asymmetrisch).',
        fields: (F) => [
            fTxt('colRatios', 'Spaltenverhältnis', '1:2:1', 'Verhältnisse'),
            fTxt('rowRatios', 'Zeilenverhältnis', '1', 'Verhältnisse'),
            fPx('gx', 'Spaltenabstand', Math.round(Math.min(F.w, F.h) * 0.02), 'Abstände'),
            fPx('gy', 'Zeilenabstand', Math.round(Math.min(F.w, F.h) * 0.02), 'Abstände'),
            ...marginFields(F),
        ],
        build: (p, F) => {
            const r = innerRect(F, p.mT, p.mB, p.mL, p.mR);
            const cr = parseRatios(p.colRatios, 'Spaltenverhältnis');
            const rr = parseRatios(p.rowRatios, 'Zeilenverhältnis');
            const cw = r.w - (cr.length - 1) * p.gx, rh = r.h - (rr.length - 1) * p.gy;
            if (cw <= 0 || rh <= 0) throw new Error('Abstände passen nicht in die Satzfläche.');
            const cs = cr.reduce((a, b) => a + b, 0), rs = rr.reduce((a, b) => a + b, 0);
            guard(cr.length * rr.length);
            const mods = [];
            let y = r.y;
            for (const rv of rr) {
                const h = rh * rv / rs;
                let x = r.x;
                for (const cv of cr) {
                    const w = cw * cv / cs;
                    mods.push(rectCurve(x, y, w, h));
                    x += w + p.gx;
                }
                y += h + p.gy;
            }
            return [node('Felder', mods)];
        },
    },

    // ---------------- Typografische Raster ----------------
    {
        id: 'baseline', cat: 'Typografie', name: 'Grundlinienraster',
        desc: 'Horizontale Grundlinien im festen Zeilenabstand für den Satz.',
        fields: (F) => [
            fPx('step', 'Zeilenabstand', Math.max(2, Math.round(Math.min(F.w, F.h) * 0.012)), 'Grundlinien', { min: 0.5 }),
            fChk('full', 'Über volle Seitenbreite', false, 'Grundlinien'),
            ...marginFields(F),
        ],
        build: (p, F) => {
            const r = innerRect(F, p.mT, p.mB, p.mL, p.mR);
            const n = Math.floor(r.h / p.step + EPS) + 1;
            guard(n);
            const x0 = p.full ? F.x : r.x, x1 = p.full ? F.x + F.w : r.x + r.w;
            const lines = [];
            for (let i = 0; i < n; i++) lines.push(lineCurve(pt(x0, r.y + i * p.step), pt(x1, r.y + i * p.step)));
            return [node('Grundlinien', lines)];
        },
    },
    {
        id: 'canon', cat: 'Typografie', name: 'Satzspiegel (Van de Graaf / Tschichold)',
        desc: 'Klassische Satzspiegelkonstruktion: Innenrand = Breite/n, Kopfsteg = Höhe/n, Außenrand = 2×, Fußsteg = 2× (n = 9 ergibt den Kanon der Buchseite).',
        fields: (F) => [
            fInt('n', 'Teiler n', 9, 3, 24, 'Satzspiegel'),
            fCmb('side', 'Seite', ['Rechte Seite (Bund links)', 'Linke Seite (Bund rechts)'], 0, 'Satzspiegel'),
            fChk('diag', 'Diagonalen (Konstruktion)', true, 'Konstruktion'),
            fChk('divs', 'Teilungslinien n × n', false, 'Konstruktion'),
        ],
        build: (p, F) => {
            const n = p.n;
            const inn = F.w / n, top = F.h / n, out = 2 * F.w / n, bot = 2 * F.h / n;
            const left = p.side === 0 ? inn : out, right = p.side === 0 ? out : inn;
            const r = { x: F.x + left, y: F.y + top, w: F.w - left - right, h: F.h - top - bot };
            if (r.w <= 0 || r.h <= 0) throw new Error('Der Teiler n ist zu klein für einen Satzspiegel.');
            const res = [node('Satzspiegel', [rectCurve(r.x, r.y, r.w, r.h)])];
            if (p.diag) {
                res.push(node('Konstruktion Diagonalen', [
                    lineCurve(pt(F.x, F.y), pt(F.x + F.w, F.y + F.h)),
                    lineCurve(pt(F.x + F.w, F.y), pt(F.x, F.y + F.h)),
                    lineCurve(pt(r.x, r.y), pt(r.x + r.w, r.y + r.h)),
                    lineCurve(pt(r.x + r.w, r.y), pt(r.x, r.y + r.h)),
                ]));
            }
            if (p.divs) {
                const ls = [];
                for (let i = 1; i < n; i++) {
                    ls.push(lineCurve(pt(F.x + i * F.w / n, F.y), pt(F.x + i * F.w / n, F.y + F.h)));
                    ls.push(lineCurve(pt(F.x, F.y + i * F.h / n), pt(F.x + F.w, F.y + i * F.h / n)));
                }
                res.push(node('Konstruktion Teilung', ls));
            }
            return res;
        },
    },

    // ---------------- Proportionsraster ----------------
    {
        id: 'golden', cat: 'Proportionen', name: 'Goldener Schnitt (Phi-Raster)',
        desc: 'Linien im Verhältnis 0,382 : 0,618, horizontal und vertikal; optional rekursiv weiter unterteilt.',
        fields: (F) => [
            fInt('levels', 'Teilungsstufen', 1, 1, 3, 'Goldener Schnitt'),
            fChk('vert', 'Vertikale Linien', true, 'Goldener Schnitt'),
            fChk('horiz', 'Horizontale Linien', true, 'Goldener Schnitt'),
            fChk('frame', 'Rahmen zeichnen', true, 'Goldener Schnitt'),
            ...marginField(F, 0),
        ],
        build: (p, F) => {
            const r = uniformInner(F, p.m);
            const divide = (a, b, levels) => {
                const segs = [[a, b]];
                const lines = [];
                let cur = segs;
                for (let lv = 0; lv < levels; lv++) {
                    const next = [];
                    for (const s of cur) {
                        const l = s[1] - s[0];
                        const p1 = s[0] + l * (1 - 1 / PHI), p2 = s[0] + l / PHI;
                        lines.push(p1, p2);
                        next.push([s[0], p1], [p1, p2], [p2, s[1]]);
                    }
                    cur = next;
                }
                return lines;
            };
            const curves = [];
            if (p.vert) for (const x of divide(r.x, r.x + r.w, p.levels)) curves.push(lineCurve(pt(x, r.y), pt(x, r.y + r.h)));
            if (p.horiz) for (const y of divide(r.y, r.y + r.h, p.levels)) curves.push(lineCurve(pt(r.x, y), pt(r.x + r.w, y)));
            const res = [];
            if (p.frame) res.push(node('Rahmen', [rectCurve(r.x, r.y, r.w, r.h)]));
            res.push(node('Goldener Schnitt', curves));
            return res;
        },
    },
    {
        id: 'thirds', cat: 'Proportionen', name: 'Drittelregel / Teilungsraster',
        desc: 'Gleichmäßige Teilung in n Spalten × m Zeilen (Standard 3 × 3), optional mit Kraftpunkten.',
        fields: (F) => [
            fInt('cols', 'Spalten', 3, 1, 64, 'Teilung'),
            fInt('rows', 'Zeilen', 3, 1, 64, 'Teilung'),
            fPx('pointR', 'Kraftpunkte Radius (0 = aus)', Math.round(Math.min(F.w, F.h) * 0.012), 'Teilung'),
            fChk('frame', 'Rahmen zeichnen', true, 'Teilung'),
            ...marginField(F, 0),
        ],
        build: (p, F) => {
            const r = uniformInner(F, p.m);
            const lines = [], pts = [];
            for (let i = 1; i < p.cols; i++) lines.push(lineCurve(pt(r.x + i * r.w / p.cols, r.y), pt(r.x + i * r.w / p.cols, r.y + r.h)));
            for (let j = 1; j < p.rows; j++) lines.push(lineCurve(pt(r.x, r.y + j * r.h / p.rows), pt(r.x + r.w, r.y + j * r.h / p.rows)));
            if (p.pointR > 0)
                for (let i = 1; i < p.cols; i++)
                    for (let j = 1; j < p.rows; j++)
                        pts.push(circleCurve(r.x + i * r.w / p.cols, r.y + j * r.h / p.rows, p.pointR));
            const res = [];
            if (p.frame) res.push(node('Rahmen', [rectCurve(r.x, r.y, r.w, r.h)]));
            res.push(node('Teilungslinien', lines));
            if (pts.length) res.push(node('Kraftpunkte', pts));
            return res;
        },
    },
    {
        id: 'fibonacci', cat: 'Proportionen', name: 'Fibonacci / Goldene Spirale',
        desc: 'Goldenes Rechteck, fortlaufend in Quadrate zerlegt, mit Spirale. Drehung und Spiegelung wählbar.',
        fields: (F) => [
            fInt('steps', 'Anzahl Quadrate', 8, 1, 20, 'Fibonacci'),
            fChk('squares', 'Unterteilung zeigen', true, 'Fibonacci'),
            fChk('spiral', 'Spirale zeigen', true, 'Fibonacci'),
            fCmb('rot', 'Drehung', ['0°', '90°', '180°', '270°'], 0, 'Fibonacci'),
            fChk('mirror', 'Horizontal spiegeln', false, 'Fibonacci'),
            ...marginField(F, 0),
        ],
        build: (p, F) => {
            const r = uniformInner(F, p.m);
            const odd = p.rot % 2 === 1;
            const b = odd ? Math.min(r.w, r.h / PHI) : Math.min(r.h, r.w / PHI);
            const a = b * PHI;
            const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
            const tf = (x, y) => {
                if (p.mirror) x = -x;
                let X, Y;
                switch (p.rot) {
                    case 1: X = -y; Y = x; break;
                    case 2: X = -x; Y = -y; break;
                    case 3: X = y; Y = -x; break;
                    default: X = x; Y = y;
                }
                return pt(cx + X, cy + Y);
            };
            const K = 4 / 3 * Math.tan(Math.PI / 8);
            let R = { x: -a / 2, y: -b / 2, w: a, h: b };
            const dirs = ['L', 'B', 'R', 'T'];
            const lines = [polyline([tf(R.x, R.y), tf(R.x + R.w, R.y), tf(R.x + R.w, R.y + R.h), tf(R.x, R.y + R.h)], true)];
            const sb = CurveBuilder.create();
            let started = false;
            for (let i = 0; i < p.steps; i++) {
                const d = dirs[i % 4];
                const s = (d === 'L' || d === 'R') ? R.h : R.w;
                let c, a0, a1;
                switch (d) {
                    case 'L':
                        lines.push(lineCurve(tf(R.x + s, R.y), tf(R.x + s, R.y + R.h)));
                        c = pt(R.x + s, R.y); a0 = Math.PI; a1 = Math.PI / 2;
                        R = { x: R.x + s, y: R.y, w: R.w - s, h: R.h };
                        break;
                    case 'B':
                        lines.push(lineCurve(tf(R.x, R.y + R.h - s), tf(R.x + R.w, R.y + R.h - s)));
                        c = pt(R.x, R.y + R.h - s); a0 = Math.PI / 2; a1 = 0;
                        R = { x: R.x, y: R.y, w: R.w, h: R.h - s };
                        break;
                    case 'R':
                        lines.push(lineCurve(tf(R.x + R.w - s, R.y), tf(R.x + R.w - s, R.y + R.h)));
                        c = pt(R.x + R.w - s, R.y + s); a0 = 0; a1 = -Math.PI / 2;
                        R = { x: R.x, y: R.y, w: R.w - s, h: R.h };
                        break;
                    default: // 'T'
                        lines.push(lineCurve(tf(R.x, R.y + s), tf(R.x + R.w, R.y + s)));
                        c = pt(R.x + s, R.y + s); a0 = -Math.PI / 2; a1 = -Math.PI;
                        R = { x: R.x, y: R.y + s, w: R.w, h: R.h - s };
                }
                const P0 = pt(c.x + s * Math.cos(a0), c.y + s * Math.sin(a0));
                const P3 = pt(c.x + s * Math.cos(a1), c.y + s * Math.sin(a1));
                const C1 = pt(P0.x + K * s * Math.sin(a0), P0.y - K * s * Math.cos(a0));
                const C2 = pt(P3.x - K * s * Math.sin(a1), P3.y + K * s * Math.cos(a1));
                if (!started) { sb.begin(tf(P0.x, P0.y)); started = true; }
                sb.addBezier(tf(C1.x, C1.y), tf(C2.x, C2.y), tf(P3.x, P3.y));
            }
            const res = [node('Goldenes Rechteck', p.squares ? lines : [lines[0]])];
            if (p.spiral) res.push(node('Spirale', [sb.createCurve()]));
            return res;
        },
    },
    {
        id: 'dynamic', cat: 'Proportionen', name: 'Diagonalen / Dynamische Symmetrie',
        desc: 'Diagonalen, Reziproke (Baroque/Sinister), Rabatment und Mittelachsen im Format.',
        fields: (F) => [
            fChk('frame', 'Rahmen', true, 'Elemente'),
            fChk('diag', 'Diagonalen', true, 'Elemente'),
            fChk('recip', 'Reziproke (Senkrechte auf Diagonalen)', true, 'Elemente'),
            fChk('rabat', 'Rabatment (Quadratlinien)', true, 'Elemente'),
            fChk('centre', 'Mittelachsen', false, 'Elemente'),
            ...marginField(F, 0),
        ],
        build: (p, F) => {
            const r = uniformInner(F, p.m);
            const TL = pt(r.x, r.y), TR = pt(r.x + r.w, r.y), BL = pt(r.x, r.y + r.h), BR = pt(r.x + r.w, r.y + r.h);
            const res = [];
            if (p.frame) res.push(node('Rahmen', [rectCurve(r.x, r.y, r.w, r.h)]));
            if (p.diag) res.push(node('Diagonalen', [lineCurve(TL, BR), lineCurve(TR, BL)]));
            if (p.recip) {
                const foot = (P, A, B) => {
                    const dx = B.x - A.x, dy = B.y - A.y;
                    const t = ((P.x - A.x) * dx + (P.y - A.y) * dy) / (dx * dx + dy * dy);
                    return pt(A.x + t * dx, A.y + t * dy);
                };
                res.push(node('Reziproke', [
                    lineCurve(TR, foot(TR, TL, BR)), lineCurve(BL, foot(BL, TL, BR)),
                    lineCurve(TL, foot(TL, TR, BL)), lineCurve(BR, foot(BR, TR, BL)),
                ]));
            }
            if (p.rabat) {
                const c = [];
                if (r.w >= r.h) {
                    c.push(lineCurve(pt(r.x + r.h, r.y), pt(r.x + r.h, r.y + r.h)));
                    c.push(lineCurve(pt(r.x + r.w - r.h, r.y), pt(r.x + r.w - r.h, r.y + r.h)));
                } else {
                    c.push(lineCurve(pt(r.x, r.y + r.w), pt(r.x + r.w, r.y + r.w)));
                    c.push(lineCurve(pt(r.x, r.y + r.h - r.w), pt(r.x + r.w, r.y + r.h - r.w)));
                }
                res.push(node('Rabatment', c));
            }
            if (p.centre) res.push(node('Mittelachsen', [
                lineCurve(pt(r.x + r.w / 2, r.y), pt(r.x + r.w / 2, r.y + r.h)),
                lineCurve(pt(r.x, r.y + r.h / 2), pt(r.x + r.w, r.y + r.h / 2)),
            ]));
            return res;
        },
    },

    // ---------------- Sonderraster ----------------
    {
        id: 'square', cat: 'Sonderraster', name: 'Quadrat- / Punktraster',
        desc: 'Gleichmäßiges Quadratraster als Linien, Kreuze oder Punkte.',
        fields: (F) => [
            fPx('cell', 'Zellengröße', Math.max(4, Math.round(Math.min(F.w, F.h) / 20)), 'Raster', { min: 1 }),
            fCmb('mode', 'Darstellung', ['Linien', 'Kreuze', 'Punkte'], 0, 'Raster'),
            fPx('size', 'Kreuzlänge / Punktradius', Math.max(1, Math.round(Math.min(F.w, F.h) / 250)), 'Raster', { min: 0.2 }),
            fCmb('origin', 'Ursprung', ['Oben links', 'Zentriert'], 0, 'Raster'),
            ...marginField(F, 0),
        ],
        build: (p, F) => {
            const r = uniformInner(F, p.m);
            const centred = p.origin === 1;
            const ox = centred ? r.x + r.w / 2 : r.x, oy = centred ? r.y + r.h / 2 : r.y;
            const idx = (o, start, len) => {
                const lo = Math.ceil((start - o) / p.cell - 1e-9), hi = Math.floor((start + len - o) / p.cell + 1e-9);
                const arr = [];
                for (let k = lo; k <= hi; k++) arr.push(o + k * p.cell);
                return arr;
            };
            const xs = idx(ox, r.x, r.w), ys = idx(oy, r.y, r.h);
            if (p.mode === 0) {
                guard(xs.length + ys.length);
                const ls = [];
                for (const x of xs) ls.push(lineCurve(pt(x, r.y), pt(x, r.y + r.h)));
                for (const y of ys) ls.push(lineCurve(pt(r.x, y), pt(r.x + r.w, y)));
                return [node('Quadratraster', ls)];
            }
            guard(xs.length * ys.length * (p.mode === 1 ? 2 : 1));
            const cs = [];
            for (const x of xs) for (const y of ys) {
                if (p.mode === 1) {
                    cs.push(lineCurve(pt(x - p.size, y), pt(x + p.size, y)));
                    cs.push(lineCurve(pt(x, y - p.size), pt(x, y + p.size)));
                } else {
                    cs.push(circleCurve(x, y, p.size));
                }
            }
            return [node(p.mode === 1 ? 'Kreuzraster' : 'Punktraster', cs, p.mode === 2)];
        },
    },
    {
        id: 'iso', cat: 'Sonderraster', name: 'Isometrisch / Dreiecksraster',
        desc: 'Drei Linienscharen im 60°-Winkel: gleichseitiges Dreiecksraster bzw. isometrisches Raster (30°).',
        fields: (F) => [
            fPx('size', 'Kantenlänge Dreieck', Math.max(4, Math.round(Math.min(F.w, F.h) / 12)), 'Raster', { min: 1 }),
            fCmb('orient', 'Ausrichtung', ['Horizontale Linien (Dreiecksraster)', 'Vertikale Linien (isometrisch 30°)'], 0, 'Raster'),
            fChk('frame', 'Rahmen zeichnen', false, 'Raster'),
            ...marginField(F, 0),
        ],
        build: (p, F) => {
            const r = uniformInner(F, p.m);
            const O = pt(r.x + r.w / 2, r.y + r.h / 2);
            const sp = p.size * Math.sqrt(3) / 2;
            const base = p.orient === 0 ? 0 : 90;
            const ls = [];
            for (const a of [0, 60, 120]) lineFamily(O, (base + a) * Math.PI / 180, sp, r, ls);
            const res = [];
            if (p.frame) res.push(node('Rahmen', [rectCurve(r.x, r.y, r.w, r.h)]));
            res.push(node('Dreiecksraster', ls));
            return res;
        },
    },
    {
        id: 'hex', cat: 'Sonderraster', name: 'Hexagonalraster (Waben)',
        desc: 'Sechsecke im Wabenmuster, am Rahmen beschnitten.',
        fields: (F) => [
            fPx('R', 'Radius Sechseck', Math.max(4, Math.round(Math.min(F.w, F.h) / 14)), 'Raster', { min: 1 }),
            fCmb('orient', 'Ausrichtung', ['Spitze oben', 'Flache Kante oben'], 0, 'Raster'),
            ...marginField(F, 0),
        ],
        build: (p, F) => {
            const r = uniformInner(F, p.m);
            const R = p.R, s3 = Math.sqrt(3);
            const pointy = p.orient === 0;
            const stepX = pointy ? s3 * R : 1.5 * R, stepY = pointy ? 1.5 * R : s3 * R;
            const nx = Math.ceil(r.w / stepX) + 3, ny = Math.ceil(r.h / stepY) + 3;
            guard(nx * ny);
            const seen = new Set();
            const curves = [];
            const key = (a, b) => {
                const ka = a.x.toFixed(2) + ',' + a.y.toFixed(2), kb = b.x.toFixed(2) + ',' + b.y.toFixed(2);
                return ka < kb ? ka + '|' + kb : kb + '|' + ka;
            };
            for (let j = -2; j < ny; j++) {
                for (let i = -2; i < nx; i++) {
                    let cx, cy;
                    if (pointy) { cx = r.x + i * stepX + ((j & 1) ? stepX / 2 : 0); cy = r.y + j * stepY; }
                    else { cx = r.x + i * stepX; cy = r.y + j * stepY + ((i & 1) ? stepY / 2 : 0); }
                    const v = [];
                    for (let k = 0; k < 6; k++) {
                        const a = (pointy ? -90 + 60 * k : 60 * k) * Math.PI / 180;
                        v.push(pt(cx + R * Math.cos(a), cy + R * Math.sin(a)));
                    }
                    for (let k = 0; k < 6; k++) {
                        const a = v[k], b = v[(k + 1) % 6];
                        const kk = key(a, b);
                        if (seen.has(kk)) continue;
                        seen.add(kk);
                        const seg = clipSeg(a.x, a.y, b.x, b.y, r);
                        if (seg) curves.push(lineCurve(seg[0], seg[1]));
                    }
                }
            }
            return [node('Hexagonalraster', curves)];
        },
    },
    {
        id: 'polar', cat: 'Sonderraster', name: 'Polar- / Radialraster',
        desc: 'Konzentrische Ringe und Strahlen um die Mitte der Fläche.',
        fields: (F) => {
            const half = Math.min(F.w, F.h) / 2;
            return [
                fInt('rings', 'Anzahl Ringe', 8, 0, 100, 'Polarraster'),
                fPx('spacing', 'Ringabstand', Math.max(2, Math.round(half * 0.9 / 8)), 'Polarraster', { min: 1 }),
                fInt('rays', 'Anzahl Strahlen', 24, 0, 360, 'Polarraster'),
                fDeg('offset', 'Startwinkel', 0, -360, 360, 'Polarraster'),
                fChk('clip', 'Strahlen bis zum Rahmen', false, 'Polarraster'),
                ...marginField(F, 0),
            ];
        },
        build: (p, F) => {
            const r = uniformInner(F, p.m);
            const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
            guard(p.rings + p.rays);
            const res = [];
            const rings = [];
            for (let i = 1; i <= p.rings; i++) rings.push(circleCurve(cx, cy, i * p.spacing));
            if (rings.length) res.push(node('Ringe', rings));
            const maxR = p.rings > 0 ? p.rings * p.spacing : Math.min(r.w, r.h) / 2;
            const rays = [];
            for (let i = 0; i < p.rays; i++) {
                const a = (p.offset + 360 * i / p.rays) * Math.PI / 180;
                const ex = cx + Math.cos(a) * (p.clip ? 2 * Math.hypot(r.w, r.h) : maxR);
                const ey = cy + Math.sin(a) * (p.clip ? 2 * Math.hypot(r.w, r.h) : maxR);
                const seg = p.clip ? clipSeg(cx, cy, ex, ey, r) : [pt(cx, cy), pt(ex, ey)];
                if (seg) rays.push(lineCurve(seg[0], seg[1]));
            }
            if (rays.length) res.push(node('Strahlen', rays));
            if (res.length === 0) throw new Error('Weder Ringe noch Strahlen: Es gibt nichts zu zeichnen.');
            return res;
        },
    },
];

// ---------------------------------------------------------------------------
// Bezugsfläche: markiertes Objekt (bzw. Gesamtrahmen mehrerer Objekte),
// ein markiertes Artboard, sonst die aktuelle Seite
// ---------------------------------------------------------------------------

function selectionFrame(doc) {
    const sel = doc.selection;
    if (!sel || sel.length === 0) return null;
    let rc = null, count = 0, artboard = null;
    for (let i = 0; i < sel.length; i++) {
        let n = null;
        try { n = sel.at(i).node; } catch (e) { continue; }
        if (!n) continue;
        const ai = n.artboardInterface;
        if (ai && ai.isArtboardEnabled === true) {
            // Das Artboard selbst ist markiert: gilt als Seite, nicht als Objekt
            if (!artboard) {
                const b = ai.spreadBaseBox;
                const desc = (ai.description && String(ai.description).trim()) ? String(ai.description).trim() : 'Artboard';
                artboard = { x: b.x, y: b.y, w: b.width, h: b.height, desc: desc };
            }
            continue;
        }
        let box = null;
        try { box = n.getSpreadBaseBox(false); } catch (e) {
            try { box = n.getSpreadBaseBox(); } catch (e2) { box = null; }
        }
        if (!box || !(box.width > 0 && box.height > 0)) continue;
        rc = rc ? unionRects(rc, box) : box;
        count++;
    }
    if (count > 0) {
        return { x: rc.x, y: rc.y, w: rc.width, h: rc.height, desc: count === 1 ? 'Markiertes Objekt' : 'Markierte Objekte (' + count + ')' };
    }
    return artboard;
}

function getFrame(doc, spread) {
    const selFrame = selectionFrame(doc);
    if (selFrame) return selFrame;
    const hasArtboards = !!(doc.hasArtboards && doc.artboards && doc.artboards.length);
    if (hasArtboards && doc.artboards.length > 1) {
        alert('Dieses Dokument hat mehrere Artboards. Bitte zuerst ein Artboard oder ein Objekt markieren und das Script erneut starten.');
        return null;
    }
    let box = null;
    try { box = spread.baseBox; } catch (e) { }
    if (!box || !(box.width > 0 && box.height > 0)) {
        try { box = spread.spreadBaseBox; } catch (e) { }
    }
    if (!box || !(box.width > 0 && box.height > 0)) box = new Rectangle(0, 0, doc.widthPixels || 1200, doc.heightPixels || 800);
    return { x: box.x, y: box.y, w: box.width, h: box.height, desc: 'Seite' };
}

// ---------------------------------------------------------------------------
// Dialoge
// ---------------------------------------------------------------------------

function chooseType(frame) {
    const dlg = Dialog.create('Gestaltungsraster – Schritt 1 von 2');
    dlg.initialWidth = 460;
    const col = dlg.addColumn();
    const g = col.addGroup('Rastertyp');
    const items = TYPES.map(t => t.cat + ' · ' + t.name);
    const combo = g.addComboBox('Raster', items, 0);
    const info = g.addStaticText('Beschreibung', TYPES[0].desc);
    info.isFullWidth = true;
    const g2 = col.addGroup('Bezugsfläche');
    g2.addStaticText(frame.desc, Math.round(frame.w) + ' × ' + Math.round(frame.h) + ' px');
    dlg.onControlValueChangedHandler = () => { info.text = TYPES[combo.selectedIndex].desc; };
    if (dlg.runModal() !== DialogResult.Ok) return null;
    return TYPES[combo.selectedIndex];
}

function buildFieldsDialog(doc, type, specs) {
    const dlg = Dialog.create('Gestaltungsraster – Schritt 2 von 2: ' + type.name);
    dlg.initialWidth = 560;
    const cols = [dlg.addColumn(), dlg.addColumn()];
    const groups = {}, ctrls = {};
    const units = doc.units;
    for (const s of specs) {
        const gk = s.col + '|' + s.group;
        if (!groups[gk]) groups[gk] = cols[s.col].addGroup(s.group);
        const g = groups[gk];
        let c;
        switch (s.kind) {
            case 'px':
                c = g.addUnitValueEditor(s.label, UnitType.Pixel, units, s.def, s.min, s.max);
                c.value = s.def; // Workaround: SDK setzt den Wert bei max = null auf 0 zurück
                break;
            case 'int':
                c = g.addUnitValueEditor(s.label, UnitType.Number, UnitType.Number, s.def, s.min, s.max);
                c.precision = 0;
                c.value = s.def;
                break;
            case 'num':
                c = g.addUnitValueEditor(s.label, UnitType.Number, UnitType.Number, s.def, s.min, s.max);
                c.precision = s.prec;
                c.value = s.def;
                break;
            case 'deg':
                c = g.addUnitValueEditor(s.label, UnitType.Degree, UnitType.Degree, s.def, s.min, s.max);
                c.value = s.def;
                break;
            case 'check': c = g.addCheckBox(s.label, s.def); break;
            case 'combo': c = g.addComboBox(s.label, s.items, s.def); break;
            case 'text': c = g.addTextBox(s.label, s.def); break;
            case 'colour': c = g.addColourPicker(s.label, s.def); break;
        }
        ctrls[s.key] = c;
    }
    const read = () => {
        const v = {};
        for (const s of specs) {
            const c = ctrls[s.key];
            switch (s.kind) {
                case 'px': case 'num': case 'deg': v[s.key] = Number.isFinite(c.value) ? c.value : s.def; break;
                case 'int': v[s.key] = Number.isFinite(c.value) ? Math.round(c.value) : s.def; break;
                case 'check': v[s.key] = !!c.value; break;
                case 'combo': v[s.key] = c.selectedIndex; break;
                case 'text': v[s.key] = String(c.text); break;
                case 'colour': v[s.key] = c.value || s.def; break;
            }
        }
        return v;
    };
    return { dlg, read };
}

// ---------------------------------------------------------------------------
// Objekte auf neuer Ebene anlegen
// ---------------------------------------------------------------------------

function makeDefinition(n, colour, weight) {
    const pc = PolyCurve.create();
    for (const c of n.curves) pc.addCurve(c);
    const none = FillDescriptor.createNone();
    let def;
    if (n.filled) {
        def = PolyCurveNodeDefinition.create(pc, FillDescriptor.createSolid(colour), none, LineStyleDescriptor.createDefault(0.1), none);
    } else {
        def = PolyCurveNodeDefinition.create(pc, none, FillDescriptor.createSolid(colour), LineStyleDescriptor.createDefault(weight), none);
    }
    def.userDescription = n.name;
    return def;
}

function uniqueLayerName(spread, wanted) {
    const used = new Set();
    for (const child of spread.children) used.add(child.userDescription);
    if (!used.has(wanted)) return wanted;
    let i = 2;
    while (used.has(wanted + ' ' + i)) i++;
    return wanted + ' ' + i;
}

function addToDocument(doc, spread, layerName, nodes, colour, weight) {
    const name = uniqueLayerName(spread, layerName || 'Raster');
    const cb = AddChildNodesCommandBuilder.create();
    cb.addNode(ContainerNodeDefinition.create(name));
    cb.setInsertionTarget(spread);
    doc.executeCommand(cb.createCommand(false, NodeChildType.Main));

    let container = null;
    for (const child of spread.children) {
        if (child.userDescription === name && child.isContainerNode) container = child;
    }
    if (!container) throw new Error('Die neue Rasterebene konnte nicht angelegt werden.');

    const kb = AddChildNodesCommandBuilder.create();
    for (const n of nodes) {
        if (n.curves.length) kb.addNode(makeDefinition(n, colour, weight));
    }
    kb.setInsertionTarget(container);
    doc.executeCommand(kb.createCommand(false, NodeChildType.Main));
    doc.selection = [container];
    return name;
}

// ---------------------------------------------------------------------------
// Hauptablauf
// ---------------------------------------------------------------------------

function main() {
    const doc = Document.current;
    if (!doc) { alert('Bitte zuerst ein Dokument öffnen.'); return; }
    const spread = doc.currentSpread || doc.spreads.first;
    if (!spread) { alert('Keine Seite gefunden.'); return; }

    const frame = getFrame(doc, spread);
    if (!frame) return;

    // Schritt 1: Rastertyp
    const type = chooseType(frame);
    if (!type) return;

    // Schritt 2: typspezifische Einstellungen
    const specs = type.fields(frame).concat(appearanceFields(type.name));
    const { dlg, read } = buildFieldsDialog(doc, type, specs);
    while (dlg.runModal() === DialogResult.Ok) {
        try {
            const v = read();
            const nodes = type.build(v, frame);
            const name = addToDocument(doc, spread, v.layerName, nodes, v.colour, Math.max(0.1, v.weight));
            console.log('[Gestaltungsraster] "' + name + '" angelegt (' + type.name + ').');
            break;
        } catch (err) {
            alert(err.message || String(err));
        }
    }
}

if (typeof __GRID_TEST__ === 'undefined') {
    main();
}
