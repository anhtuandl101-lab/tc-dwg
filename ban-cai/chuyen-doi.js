// Chuyển DwgDatabase (LibreDWG) thành danh sách hình vẽ phẳng để vẽ nhanh trên canvas.
// Dùng chung cho luồng nền trong app và cho script thử bằng Node.

import { giaiMa, kieuMa } from './ma-viet.js';

const TAU = Math.PI * 2;
const CHUNK = 6000;          // số phần tử Float64 tối đa mỗi khối dữ liệu
const MAX_DEPTH = 16;        // độ sâu block lồng tối đa

// ---------- Bảng màu ACI ----------
export const ACI = (() => {
  const t = new Array(256).fill(0xffffff);
  const base = [0, 0xff0000, 0xffff00, 0x00ff00, 0x00ffff, 0x0000ff, 0xff00ff, 0xffffff, 0x808080, 0xc0c0c0];
  for (let i = 0; i < 10; i++) t[i] = base[i];
  const lv = [255, 165, 127, 76, 38];
  for (let i = 10; i < 250; i++) {
    const hue = Math.floor((i - 10) / 10) * 15, v = i % 10;
    const val = lv[v >> 1] / 255, half = v & 1;
    const h = hue / 60, c = val, x = c * (1 - Math.abs((h % 2) - 1));
    let r, g, b;
    if (h < 1) [r, g, b] = [c, x, 0]; else if (h < 2) [r, g, b] = [x, c, 0];
    else if (h < 3) [r, g, b] = [0, c, x]; else if (h < 4) [r, g, b] = [0, x, c];
    else if (h < 5) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
    if (half) { r = r + (val - r) * 0.5; g = g + (val - g) * 0.5; b = b + (val - b) * 0.5; }
    t[i] = (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
  }
  const grays = [0x333333, 0x505050, 0x696969, 0x828282, 0xbebebe, 0xffffff];
  for (let i = 0; i < 6; i++) t[250 + i] = grays[i];
  return t;
})();

// ---------- Ma trận affine 2D [a b c d e f]: x' = a x + c y + e, y' = b x + d y + f ----------
const I = [1, 0, 0, 1, 0, 0];
function mul(m, n) {
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
          m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
          m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}
const tr = (x, y) => [1, 0, 0, 1, x, y];
const rot = a => { const c = Math.cos(a), s = Math.sin(a); return [c, s, -s, c, 0, 0]; };
const sc = (x, y) => [x, 0, 0, y, 0, 0];

// Ma trận OCS -> WCS (chiếu bỏ z) theo thuật toán trục tùy ý của AutoCAD
function ocs(n) {
  if (!n) return I;
  let { x = 0, y = 0, z = 1 } = n;
  const L = Math.hypot(x, y, z) || 1; x /= L; y /= L; z /= L;
  if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) return z >= 0 ? I : [-1, 0, 0, 1, 0, 0];
  let ax;
  if (Math.abs(x) < 1 / 64 && Math.abs(y) < 1 / 64) ax = [z, 0, -x];      // Wy x N
  else ax = [-y, x, 0];                                                      // Wz x N
  const la = Math.hypot(...ax); ax = ax.map(v => v / la);
  const ay = [y * ax[2] - z * ax[1], z * ax[0] - x * ax[2], x * ax[1] - y * ax[0]];
  return [ax[0], ax[1], ay[0], ay[1], 0, 0];
}

// ---------- Hình học ----------
function arcPts(out, cx, cy, r, a0, a1, ccw = true) {
  if (!ccw) { const t = a0; a0 = a1; a1 = t; }
  while (a1 <= a0) a1 += TAU;
  if (a1 - a0 > TAU + 1e-9) a1 = a0 + TAU;
  const n = Math.max(4, Math.min(180, Math.ceil((a1 - a0) / (TAU / 90))));
  const s = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; s.push(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
  if (!ccw) { for (let i = s.length - 2; i >= 0; i -= 2) out.push(s[i], s[i + 1]); } else out.push(...s);
}

function bulgePts(out, x1, y1, x2, y2, b) {
  if (!b || Math.abs(b) < 1e-9) { out.push(x2, y2); return; }
  const th = 4 * Math.atan(b), dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy);
  if (d < 1e-12) { out.push(x2, y2); return; }
  const r = d / (2 * Math.sin(th / 2));
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, h = r * Math.cos(th / 2);
  const cx = mx - h * dy / d, cy = my + h * dx / d;
  const a0 = Math.atan2(y1 - cy, x1 - cx);
  const n = Math.max(2, Math.ceil(Math.abs(th) / (TAU / 90)));
  for (let i = 1; i <= n; i++) { const a = a0 + th * i / n; out.push(cx + Math.abs(r) * Math.cos(a), cy + Math.abs(r) * Math.sin(a)); }
  out[out.length - 2] = x2; out[out.length - 1] = y2;
}

function vertsPts(verts, closed) {
  const out = [];
  const n = verts.length; if (!n) return out;
  out.push(verts[0].x, verts[0].y);
  const m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const a = verts[i], b = verts[(i + 1) % n];
    bulgePts(out, a.x, a.y, b.x, b.y, a.bulge || 0);
  }
  return out;
}

function ellipsePts(out, c, m, ratio, t0, t1, nz) {
  const sgn = nz < 0 ? -1 : 1;
  const nx = -m.y * sgn * ratio, ny = m.x * sgn * ratio;
  while (t1 <= t0) t1 += TAU;
  if (t1 - t0 > TAU + 1e-9) t1 = t0 + TAU;
  const n = Math.max(8, Math.min(180, Math.ceil((t1 - t0) / (TAU / 90))));
  for (let i = 0; i <= n; i++) { const t = t0 + (t1 - t0) * i / n; out.push(c.x + m.x * Math.cos(t) + nx * Math.sin(t), c.y + m.y * Math.cos(t) + ny * Math.sin(t)); }
}

function splinePts(e) {
  const cps = e.controlPoints || [], knots = e.knots || [], p = e.degree || 3;
  const out = [];
  if (cps.length > p && knots.length >= cps.length + p + 1) {
    const w = cps.map(c => (c.weight > 0 ? c.weight : 1));
    const lo = knots[p], hi = knots[cps.length];
    const n = Math.min(400, Math.max(16, cps.length * 10));
    for (let s = 0; s <= n; s++) {
      let u = lo + (hi - lo) * s / n; if (s === n) u = hi - 1e-10 * (hi - lo || 1);
      let k = p; while (k < cps.length - 1 && knots[k + 1] <= u) k++;
      const d = [];
      for (let j = 0; j <= p; j++) { const c = cps[k - p + j], ww = w[k - p + j]; d.push([c.x * ww, c.y * ww, ww]); }
      for (let r = 1; r <= p; r++) for (let j = p; j >= r; j--) {
        const i = k - p + j, den = knots[i + p - r + 1] - knots[i];
        const a = den ? (u - knots[i]) / den : 0;
        d[j] = [(1 - a) * d[j - 1][0] + a * d[j][0], (1 - a) * d[j - 1][1] + a * d[j][1], (1 - a) * d[j - 1][2] + a * d[j][2]];
      }
      out.push(d[p][0] / d[p][2], d[p][1] / d[p][2]);
    }
    return out;
  }
  const f = e.fitPoints || e.fitDatum || [];
  if (f.length < 2) return out;
  // Catmull-Rom qua các điểm fit
  for (let i = 0; i < f.length - 1; i++) {
    const p0 = f[Math.max(0, i - 1)], p1 = f[i], p2 = f[i + 1], p3 = f[Math.min(f.length - 1, i + 2)];
    for (let s = 0; s < 8; s++) {
      const t = s / 8, t2 = t * t, t3 = t2 * t;
      out.push(0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
               0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3));
    }
  }
  out.push(f[f.length - 1].x, f[f.length - 1].y);
  return out;
}

// ---------- Chữ ----------
function textCodes(s) {
  return String(s || '')
    .replace(/\\U\+([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±')
    .replace(/%%[uUoOkK]/g, '').replace(/%%%/g, '%')
    .replace(/%%(\d{3})/g, (_, n) => String.fromCharCode(+n))
    .replace(/\t/g, '   ');
}
// enc0: bảng mã của kiểu chữ (null | 'tcvn3' | 'tcvn3H' | 'vni'); \f và \F trong MTEXT đổi font giữa chừng
function mtextPlain(s, enc0 = null) {
  s = String(s || '');
  let o = '', run = '', enc = enc0;
  const stack = [];
  const flush = () => { if (run) { o += giaiMa(run, enc); run = ''; } };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '{') { stack.push(enc); continue; }
    if (c === '}') { flush(); enc = stack.length ? stack.pop() : enc0; continue; }
    if (c !== '\\') { run += c; continue; }
    const n = s[++i];
    if (n === undefined) break;
    if (n === 'P' || n === 'N' || n === 'X') { run += '\n'; continue; }
    if (n === '~') { run += ' '; continue; }
    if (n === '\\' || n === '{' || n === '}') { run += n; continue; }
    // \U+XXXX: bản vẽ cũ lưu chữ có dấu dạng mã thoát; giải ra rồi để chung đoạn, cùng qua bước đổi VNI/TCVN3
    if (n === 'U' && s[i + 1] === '+') { run += String.fromCharCode(parseInt(s.substr(i + 2, 4), 16) || 63); i += 5; continue; }
    if (n === 'S') { const j = s.indexOf(';', i); run += s.slice(i + 1, j < 0 ? s.length : j).replace(/[\^#]/, '/'); i = j < 0 ? s.length : j; continue; }
    if ('LlOoKk'.includes(n)) continue;
    if (n === 'f' || n === 'F') {
      const j = s.indexOf(';', i);
      flush(); enc = kieuMa(s.slice(i + 1, j < 0 ? s.length : j).split('|')[0]);
      i = j < 0 ? s.length : j; continue;
    }
    if ('ACcHhQqTtWp'.includes(n)) { const j = s.indexOf(';', i); i = j < 0 ? s.length : j; continue; }
    run += n;
  }
  flush();
  return textCodes(o);
}

// Khung "xem toàn bộ" bỏ đối tượng lạc ở rất xa: lấy vùng chứa 98% số điểm, nới ra mỗi phía 1,5 lần
// bề rộng vùng đó; điểm nằm ngoài nữa coi là lạc. Bản vẽ không có điểm lạc thì trùng khung bao đầy đủ.
function khungXem(xs, ys, bbox) {
  if (xs.length < 50) return bbox;
  const mot = (arr, lo0, hi0) => {
    const a = Float64Array.from(arr).sort();
    const n = a.length, lo = a[Math.floor(n * 0.01)], hi = a[Math.min(n - 1, Math.floor(n * 0.99))];
    const w = Math.max(hi - lo, 1e-9), wa = lo - 1.5 * w, wb = hi + 1.5 * w;
    let i = 0; while (i < n && a[i] < wa) i++;
    let j = n - 1; while (j > 0 && a[j] > wb) j--;
    // điểm mẫu là 1/8 số đỉnh: dùng khung đầy đủ nếu nó không vượt cửa sổ
    const v0 = lo0 >= wa ? lo0 : a[i], v1 = hi0 <= wb ? hi0 : a[j];
    const m = (v1 - v0) * 0.02;
    return [v0 - (lo0 >= wa ? 0 : m), v1 + (hi0 <= wb ? 0 : m)];
  };
  const [x0, x1] = mot(xs, bbox[0], bbox[2]), [y0, y1] = mot(ys, bbox[1], bbox[3]);
  return [x0, y0, x1, y1];
}

// ---------- Bộ chuyển đổi ----------
// Chữ bị cắt thành nhiều mảnh MTEXT trên cùng một dòng (bản vẽ chuyển từ PDF, hoặc mỗi chữ có dấu một mảnh):
// AutoCAD xếp các mảnh theo bề rộng font SHX gốc. Font điện thoại hẹp/rộng khác nên vẽ từng mảnh riêng sẽ hở
// hoặc chồng ("CH Ỉ NG ẮT" thay vì "CHỈ NGẮT"). Ghép các mảnh liền nhau (cùng layer, màu, cỡ, góc, kiểu, cùng dòng,
// khe hở nhỏ hơn 0,6 lần chiều cao chữ) thành một chuỗi; bề rộng mực = từ đầu mảnh đầu tới cuối mảnh cuối.
function ghepManh(texts) {
  if (!texts || texts.length < 2) return texts;
  const giu = [], nhom = new Map();
  for (const t of texts) {
    if (!t.ml || !(t.ew > 0) || t.ha !== 'left' || t.flip || t.s.indexOf(String.fromCharCode(10)) >= 0) { giu.push(t); continue; }
    const key = t.layer + '|' + t.rgb + '|' + t.font + '|' + t.wf + '|' + t.va + '|' + Math.round(t.h * 1000) + '|' + Math.round(t.r * 1e5);
    let a = nhom.get(key); if (!a) nhom.set(key, a = []);
    const c = Math.cos(t.r), sn = Math.sin(t.r);
    a.push({ t, u: t.x * c + t.y * sn, v: -t.x * sn + t.y * c });
  }
  let ghep = 0;
  for (const a of nhom.values()) {
    if (a.length < 2) { for (const o of a) giu.push(o.t); continue; }
    a.sort((p, q) => p.v - q.v);
    for (let i = 0; i < a.length;) {
      // một dòng: các mảnh có v lệch nhau dưới 0,1 lần chiều cao chữ
      let j = i + 1; const h = a[i].t.h;
      while (j < a.length && a[j].v - a[j - 1].v < 0.1 * h) j++;
      const dongM = a.slice(i, j).sort((p, q) => p.u - q.u);
      let cur = null, cu0 = 0, cuEnd = 0;
      for (const o of dongM) {
        const t = o.t;
        if (cur) {
          const khe = o.u - cuEnd;
          // khe nhỏ: ghép. Khe tới 1,5 lần chiều cao: chỉ ghép khi hai bên chỗ nối đều là chữ cái và có chữ có dấu
          // (font gốc thiếu chữ Việt nên chữ có dấu thành mảnh riêng, đặt cách xa hơn). Số kích thước không bao giờ dính nhau.
          const c1 = cur.s.slice(-1), c2 = t.s.charAt(0);
          const chuViet = /\p{L}/u.test(c1) && /\p{L}/u.test(c2) && (c1.charCodeAt(0) > 127 || c2.charCodeAt(0) > 127);
          if (khe > -0.2 * h && (khe < 0.6 * h || chuViet && khe < 1.5 * h)) {
            cur.s += t.s; cuEnd = o.u + t.ew; cur.ew = cuEnd - cu0; ghep++;
            continue;
          }
          giu.push(cur);
        }
        cur = Object.assign({}, t); cu0 = o.u; cuEnd = o.u + t.ew;
        if (cur.w > 0) cur.w = 0;            // không ngắt dòng chuỗi đã ghép
      }
      if (cur) giu.push(cur);
      i = j;
    }
  }
  return ghep ? giu : texts;
}

export function chuyenDoi(db, baoTienDo) {
  const T = db.tables || {};
  const layers = [], layerIdx = new Map();
  for (const L of (T.LAYER?.entries || [])) {
    const rgb = L.colorIndex >= 1 && L.colorIndex <= 255 ? ACI[L.colorIndex] : (L.color ?? 0xffffff);
    layerIdx.set(L.name.toUpperCase(), layers.length);
    layers.push({ name: L.name, rgb, on: !L.off && !L.frozen && L.colorIndex >= 0, ltype: (L.lineType || 'Continuous').toUpperCase(), n: 0 });
  }
  const getLayer = name => {
    const k = String(name || '0').toUpperCase();
    let i = layerIdx.get(k);
    if (i === undefined) { i = layers.length; layerIdx.set(k, i); layers.push({ name: name || '0', rgb: 0xffffff, on: true, ltype: 'CONTINUOUS', n: 0 }); }
    return i;
  };
  getLayer('0');

  const ltypes = {};
  for (const lt of (T.LTYPE?.entries || [])) {
    const pat = (lt.pattern || []).map(p => p.elementLength).filter(v => Number.isFinite(v));
    if (!pat.length || !pat.some(v => v < 0)) continue;
    // ép thành dãy nét/khoảng xen kẽ
    const arr = [];
    for (const v of pat) {
      const isDash = v >= 0, len = Math.abs(v) || 0;
      const wantDash = arr.length % 2 === 0;
      if (isDash === wantDash) arr.push(len); else if (arr.length) arr[arr.length - 1] += len; else arr.push(0, len);
    }
    if (arr.length % 2) arr.push(0);
    ltypes[lt.name.toUpperCase()] = arr;
  }
  const LTSCALE = db.header?.LTSCALE > 0 ? db.header.LTSCALE : 1;

  const styles = new Map();
  for (const s of (T.STYLE?.entries || [])) styles.set(s.name.toUpperCase(), s);

  const blocks = new Map();
  for (const b of (T.BLOCK_RECORD?.entries || [])) blocks.set(b.name.toUpperCase(), b);

  // XCLIP: INSERT -> từ điển mở rộng -> ACAD_FILTER -> SPATIAL -> SPATIAL_FILTER (khung cắt)
  const dicts = new Map(), filters = new Map();
  for (const d of (db.objects?.DICTIONARY || [])) dicts.set(String(d.handle), d);
  for (const f of (db.objects?.SPATIAL_FILTER || [])) filters.set(String(f.handle), f);
  const ap34 = (m, x, y) => [m[0] * x + m[1] * y + m[3], m[4] * x + m[5] * y + m[7]];   // ma trận 3x4 theo hàng
  function khungCat(e) {
    // trả về đa giác khung cắt theo tọa độ định nghĩa block (mảng phẳng x,y) hoặc null
    if (!filters.size || !e.ownerDictionaryHardId) return null;
    const x = dicts.get(String(e.ownerDictionaryHardId));
    const d2 = x && x.entries && dicts.get(String(x.entries.ACAD_FILTER));
    const f = d2 && d2.entries && filters.get(String(d2.entries.SPATIAL));
    if (!f || !f.vertices || f.vertices.length < 2) return null;
    let v = f.vertices.map(p => [p.x, p.y]);
    if (v.length === 2) { const [a, b] = v; v = [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]]; }
    const cm = Array.isArray(f.matrix) && f.matrix.length >= 12 ? f.matrix : null;
    const im = Array.isArray(f.invertBlockMatrix) && f.invertBlockMatrix.length >= 12 ? f.invertBlockMatrix : null;
    const out = [];
    for (let [px, py] of v) {
      if (cm) [px, py] = ap34(cm, px, py);
      if (im) [px, py] = ap34(im, px, py);
      out.push(px, py);
    }
    return out;
  }

  const boQua = {};
  let tong = 0;

  function lamKhong(entities, limitMsg) {
    // một "không gian" (model hoặc một layout)
    // thùng chứa: hình thường vào thùng chính; hình trong block bị XCLIP vào thùng riêng kèm khung cắt
    const root = { groups: new Map(), hatches: [], texts: [], clip: null };
    const clips = [];
    let cur = root;
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    // khung bao: bỏ tọa độ hỏng (NaN, vô cực, quá xa); lấy mẫu 1/8 số điểm để tính khung xem bỏ đối tượng lạc
    const mx = [], my = []; let dem = 0;
    const ext = (x, y) => {
      if (!(Math.abs(x) < 1e12 && Math.abs(y) < 1e12)) return;
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
      if ((dem++ & 7) === 0) { mx.push(x); my.push(y); }
    };

    function group(kind, li, rgb, lt, lts, w) {
      const key = kind + '|' + li + '|' + rgb + '|' + (lt || '') + '|' + (lt ? lts.toPrecision(4) : '') + '|' + (w ? w.toPrecision(4) : '');
      let g = cur.groups.get(key);
      if (!g) { g = { kind, layer: li, rgb, lt: lt || null, lts, w: w || 0, chunks: [], cur: null }; cur.groups.set(key, g); }
      return g;
    }
    function push(g, arr) {
      if (!g.cur || g.cur.n + arr.length > CHUNK) {
        g.cur = { n: 0, parts: [], x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
        g.chunks.push(g.cur);
      }
      const c = g.cur; c.parts.push(arr); c.n += arr.length;
      return c;
    }
    function addLine(st, pts, m, closed, width, khongKhung) {
      if (pts.length < 4) return;
      const n = pts.length / 2, arr = new Array(1 + pts.length + (closed ? 2 : 0));
      arr[0] = n + (closed ? 1 : 0);
      const g = group('L', st.li, st.rgb, st.lt, st.lts, width ? width * st.s : 0);
      const c = push(g, arr);
      for (let i = 0; i < n; i++) {
        const x = pts[2 * i], y = pts[2 * i + 1];
        const X = m[0] * x + m[2] * y + m[4], Y = m[1] * x + m[3] * y + m[5];
        arr[1 + 2 * i] = X; arr[2 + 2 * i] = Y;
        if (X < c.x0) c.x0 = X; if (X > c.x1) c.x1 = X; if (Y < c.y0) c.y0 = Y; if (Y > c.y1) c.y1 = Y;
        if (!khongKhung) ext(X, Y);
      }
      if (closed) { arr[arr.length - 2] = arr[1]; arr[arr.length - 1] = arr[2]; }
      layers[st.li].n++; tong++;
    }
    function rings(st, list, m) {
      // list: mảng các vòng (mảng điểm phẳng) -> mảng mã hóa [nRings, n, pts...]
      const arr = [list.length];
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const pts of list) {
        arr.push(pts.length / 2);
        for (let i = 0; i < pts.length; i += 2) {
          const x = pts[i], y = pts[i + 1];
          const X = m[0] * x + m[2] * y + m[4], Y = m[1] * x + m[3] * y + m[5];
          arr.push(X, Y);
          if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
          ext(X, Y);
        }
      }
      return { arr, x0, y0, x1, y1 };
    }
    function addFill(st, list, m) {
      const r = rings(st, list, m);
      const g = group('F', st.li, st.rgb, null, 1, 0);
      const c = push(g, r.arr);
      if (r.x0 < c.x0) c.x0 = r.x0; if (r.x1 > c.x1) c.x1 = r.x1; if (r.y0 < c.y0) c.y0 = r.y0; if (r.y1 > c.y1) c.y1 = r.y1;
      layers[st.li].n++; tong++;
    }
    function addText(st, m, x, y, h, rotA, s, wf, ha, va, obl, extra) {
      if (!s || !(h > 0)) return;
      const X = m[0] * x + m[2] * y + m[4], Y = m[1] * x + m[3] * y + m[5];
      const ux = m[0] * Math.cos(rotA) + m[2] * Math.sin(rotA), uy = m[1] * Math.cos(rotA) + m[3] * Math.sin(rotA);
      const det = m[0] * m[3] - m[1] * m[2];
      const k = Math.sqrt(Math.abs(det)) || 1;
      const t = { x: X, y: Y, h: h * k, r: Math.atan2(uy, ux), s, wf: wf || 1, ha, va, rgb: st.rgb, layer: st.li, flip: det < 0 };
      if (extra) Object.assign(t, extra, extra.w ? { w: extra.w * k } : {}, extra.ew ? { ew: extra.ew * k } : {});
      cur.texts.push(t);
      // vùng chữ để tính khung: theo bề rộng khung MTEXT (hoặc dòng dài nhất) và số dòng, không theo tổng số ký tự
      const dong = String(s).split('\n');
      let dai = 1; for (const l of dong) if (l.length > dai) dai = l.length;
      const rong = extra && (extra.ew > 0 || extra.w > 0) ? Math.max(extra.ew || 0, extra.w || 0) * k : h * k * dai * 0.7 * (wf || 1);
      const L = Math.max(rong, h * k * dong.length * 1.7);
      ext(X - L, Y - L); ext(X + L, Y + L);
      layers[st.li].n++; tong++;
    }

    function resolve(e, par) {
      // trạng thái hiển thị đã giải: layer, màu, nét
      let li = getLayer(e.layer);
      if (par && li === 0) li = par.li;            // layer 0 trong block theo layer của INSERT
      let rgb;
      if (e.color !== undefined && e.color !== null && e.colorIndex !== 0 && e.colorIndex !== 256) rgb = e.color;
      else if (e.colorIndex === 0) rgb = par ? par.rgb : 0xffffff;
      else if (e.colorIndex >= 1 && e.colorIndex <= 255) rgb = ACI[e.colorIndex];
      else rgb = layers[li].rgb;
      let ltn = String(e.lineType || 'BYLAYER').toUpperCase();
      if (ltn === 'BYLAYER' || ltn === '') ltn = layers[li].ltype;
      else if (ltn === 'BYBLOCK') ltn = par ? par.ltn : 'CONTINUOUS';
      const s = par ? par.s : 1;
      const lts = (e.lineTypeScale > 0 ? e.lineTypeScale : 1) * (par ? par.ltsk : LTSCALE);
      return { li, rgb, ltn, lt: ltypes[ltn] ? ltn : null, lts: lts * s, ltsk: lts, s };
    }

    function walk(list, m, par, depth, stack) {
      for (const e of list) {
        try { one(e, m, par, depth, stack); }
        catch (err) { boQua['LỖI ' + e.type] = (boQua['LỖI ' + e.type] || 0) + 1; }
      }
    }

    function insertBlock(name, M, st, depth, stack) {
      const b = blocks.get(String(name || '').toUpperCase());
      if (!b) { if (name) boQua['Block thiếu: ' + name] = (boQua['Block thiếu: ' + name] || 0) + 1; return; }
      if ((b.flags & 4) && !(b.entities || []).length) { boQua['XREF: ' + b.name] = (boQua['XREF: ' + b.name] || 0) + 1; return; }
      if (depth >= MAX_DEPTH || stack.has(b)) return;
      stack.add(b);
      walk(b.entities || [], M, st, depth + 1, stack);
      stack.delete(b);
    }

    function one(e, m, par, depth, stack) {
      if (e.isVisible === false) return;
      const st = resolve(e, par);
      const O = e.extrusionDirection ? mul(m, ocs(e.extrusionDirection)) : m;
      switch (e.type) {
        case 'LINE':
          addLine(st, [e.startPoint.x, e.startPoint.y, e.endPoint.x, e.endPoint.y], m); break;
        case 'CIRCLE': { const p = []; arcPts(p, e.center.x, e.center.y, e.radius, 0, TAU); addLine(st, p, O); break; }
        case 'ARC': { const p = []; arcPts(p, e.center.x, e.center.y, e.radius, e.startAngle, e.endAngle); addLine(st, p, O); break; }
        case 'ELLIPSE': {
          const p = []; let t0 = e.startAngle || 0, t1 = e.endAngle ?? TAU;
          if (Math.abs(t1 - t0) < 1e-9) t1 = t0 + TAU;
          ellipsePts(p, e.center, e.majorAxisEndPoint, e.axisRatio || 1, t0, t1, e.extrusionDirection?.z ?? 1);
          addLine(st, p, m); break;
        }
        case 'MLINE': {
          // mỗi đường thành phần: đỉnh + hướng vát góc × độ lệch (tham số đoạn đầu); bỏ qua ngắt nét trong đoạn
          const vs = e.vertices || [];
          if (vs.length < 2) break;
          const nl = Math.max(e.numberOfLines || 0, ...vs.map(v => (v.lines || []).length));
          const kin = (e.flags & 2) !== 0;
          for (let j = 0; j < nl; j++) {
            const p = [];
            for (const v of vs) {
              const ln = v.lines && v.lines[j];
              const off = ln && ln.segmentParams && ln.segmentParams.length ? ln.segmentParams[0] : 0;
              const md = v.miterDirection || { x: 0, y: 0 };
              p.push(v.vertex.x + md.x * off, v.vertex.y + md.y * off);
            }
            addLine(st, p, m, kin);
          }
          break;
        }
        case 'XLINE': case 'RAY': {
          // đường vô hạn: vẽ đoạn rất dài, không tính vào khung xem (như AutoCAD Zoom Extents)
          const p = e.firstPoint, u = e.unitDirection;
          if (!p || !u || !(Math.abs(u.x) + Math.abs(u.y) > 0)) break;
          const L = 1e7, a = e.type === 'RAY' ? 0 : -L;
          addLine(st, [p.x + u.x * a, p.y + u.y * a, p.x + u.x * L, p.y + u.y * L], m, false, 0, true);
          break;
        }
        case 'LWPOLYLINE': {
          // cờ khép kín: DWG (LibreDWG trả cờ gốc) là bit 512, DXF là bit 1 (dxf.js đã quy về 512)
          const closed = !!(e.flag & 512);
          const w = e.constantWidth > 0 ? e.constantWidth : 0;
          addLine(st, vertsPts(e.vertices || [], closed), O, false, w); break;
        }
        case 'POLYLINE2D': case 'POLYLINE3D': case 'POLYLINE': {
          const vs = (e.vertices || []).filter(v => !(v.flag & 16));
          const closed = !!(e.flag & 1);
          const w = e.startWidth > 0 && e.startWidth === e.endWidth ? e.startWidth : 0;
          addLine(st, vertsPts(vs, closed), e.type === 'POLYLINE3D' ? m : O, false, w); break;
        }
        case 'SPLINE': addLine(st, splinePts(e), m); break;
        case 'SOLID': case 'TRACE': {
          const c = [e.corner1, e.corner2, e.corner4 || e.corner3, e.corner3].filter(Boolean);
          addFill(st, [c.flatMap(p => [p.x, p.y])], O); break;
        }
        case '3DFACE': {
          const c = [e.corner1, e.corner2, e.corner3, e.corner4 || e.corner3];
          addLine(st, c.flatMap(p => [p.x, p.y]), m, true); break;
        }
        case 'LEADER': {
          const v = e.vertices || []; addLine(st, v.flatMap(p => [p.x, p.y]), m); break;
        }
        case 'HATCH': hatch(e, st, O); break;
        case 'TEXT': text(e, st, O); break;
        case 'MTEXT': mtext(e, st, m); break;
        case 'ATTDEF': break;                      // định nghĩa thuộc tính: không hiện khi chèn
        case 'POINT': break;
        case 'VIEWPORT': break;
        case 'INSERT': {
          const ip = e.insertionPoint || { x: 0, y: 0 };
          const b = blocks.get(String(e.name || '').toUpperCase());
          const base = b?.basePoint || { x: 0, y: 0 };
          const sx = e.xScale || 1, sy = e.yScale || 1;
          const nc = Math.max(1, e.columnCount || 1), nr = Math.max(1, e.rowCount || 1);
          const child = { ...st, s: st.s * Math.sqrt(Math.abs(sx * sy)), ltsk: par ? par.ltsk : LTSCALE };
          const cat = khungCat(e), truoc = cur;
          for (let r = 0; r < nr && r < 200; r++) for (let c = 0; c < nc && c < 200; c++) {
            const M = mul(O, mul(tr(ip.x, ip.y), mul(rot(e.rotation || 0), mul(tr(c * (e.columnSpacing || 0), r * (e.rowSpacing || 0)), mul(sc(sx, sy), tr(-base.x, -base.y))))));
            if (cat && r === 0 && c === 0) {
              // block bị XCLIP: hình bên trong vào thùng riêng, kèm khung cắt đổi ra tọa độ bản vẽ
              const w = [];
              for (let i = 0; i < cat.length; i += 2) w.push(M[0] * cat[i] + M[2] * cat[i + 1] + M[4], M[1] * cat[i] + M[3] * cat[i + 1] + M[5]);
              cur = { groups: new Map(), hatches: [], texts: [], clip: (truoc.clip || []).concat([w]) };
              clips.push(cur);
            }
            insertBlock(e.name, M, child, depth, stack);
          }
          for (const a of (e.attribs || [])) {
            if (a.flags & 1) continue;
            const ast = resolve(a, par);
            const t = a.text || {};
            if (a.mtextFlag && a.mtext && a.mtext.text) mtext({ ...a.mtext, layer: a.layer }, ast, m);
            else text({ ...t, text: t.text ?? a.value ?? '' , extrusionDirection: t.extrusionDirection }, ast, t.extrusionDirection ? mul(m, ocs(t.extrusionDirection)) : m);
          }
          cur = truoc;
          break;
        }
        case 'MULTILEADER': mleader(e, st, m); break;
        case 'ACAD_TABLE': {
          // DXF có tên block *T... và điểm chèn; DWG 2010+ LibreDWG chưa giải mã được (không có tên block)
          if (e.name && blocks.get(String(e.name).toUpperCase())) {
            const ip = e.insertionPoint || { x: 0, y: 0 };
            insertBlock(e.name, mul(O, mul(tr(ip.x, ip.y), rot(e.rotation || 0))), st, depth, stack);
          } else boQua['ACAD_TABLE'] = (boQua['ACAD_TABLE'] || 0) + 1;
          break;
        }
        case 'WIPEOUT': break;                   // mảng che nền: không vẽ
        case 'DIMENSION': {
          // block của DIM nằm theo WCS; insertionPoint (mã 12) là độ dời của block nếu có
          const ip = e.insertionPoint;
          if (e.name) insertBlock(e.name, ip && (ip.x || ip.y) ? mul(m, tr(ip.x, ip.y)) : m, st, depth, stack);
          break;
        }
        default:
          boQua[e.type] = (boQua[e.type] || 0) + 1;
      }
    }

    function text(e, st, m) {
      const sty = styles.get(String(e.styleName || '').toUpperCase());
      const raw = String(e.text ?? '').replace(/\\U\+([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      const s = textCodes(giaiMa(raw, maCua(sty)));
      if (!s.trim()) return;
      const h = e.textHeight > 0 ? e.textHeight : (sty?.fixedTextHeight || sty?.lastHeight || 2.5);
      const wf = e.xScale > 0 ? e.xScale : (sty?.widthFactor || 1);
      const ha = e.halign || 0, va = e.valign || 0;
      let p = e.startPoint, rA = e.rotation || 0;
      let H = 'left', V = 'alphabetic';
      if (ha === 3 || ha === 5) {
        const a = e.startPoint, b = e.endPoint || a;
        p = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; H = 'center';
        if (b !== a && Math.hypot(b.x - a.x, b.y - a.y) > 0) rA = Math.atan2(b.y - a.y, b.x - a.x);
      } else if (ha || va) {
        p = e.endPoint && (e.endPoint.x || e.endPoint.y) ? e.endPoint : e.startPoint;
        H = ha === 1 || ha === 4 ? 'center' : ha === 2 ? 'right' : 'left';
        V = ha === 4 ? 'middle' : ['alphabetic', 'bottom', 'middle', 'top'][va] || 'alphabetic';
      }
      addText(st, m, p.x, p.y, h, rA, s, wf, H, V, e.obliqueAngle || 0, { font: fontOf(sty) });
    }
    function mtext(e, st, m) {
      const sty = styles.get(String(e.styleName || '').toUpperCase());
      const s = mtextPlain(e.text, maCua(sty));
      if (!s.trim()) return;
      const h = e.textHeight > 0 ? e.textHeight : 2.5;
      const ap = e.attachmentPoint || 1;
      const H = ['left', 'center', 'right'][(ap - 1) % 3], V = ['top', 'middle', 'bottom'][Math.floor((ap - 1) / 3)];
      let rA = e.rotation || 0;
      if (e.direction && (e.direction.x || e.direction.y)) {
        // direction là WCS; quy về hệ của block cha
        rA = Math.atan2(e.direction.y, e.direction.x);
      }
      const ls = (e.lineSpacing > 0 ? e.lineSpacing : 1) * 1.667;
      addText(st, m, e.insertionPoint.x, e.insertionPoint.y, h, rA, s, sty?.widthFactor || 1, H, V, 0,
        { ml: 1, ls, w: e.rectWidth > 0 ? e.rectWidth : 0, font: fontOf(sty),
          ew: e.extentsWidth > 0 ? e.extentsWidth : 0 });     // bề rộng thật AutoCAD đã vẽ: dùng để co giãn chữ cho khớp
    }
    // MULTILEADER: đường dẫn + mũi tên + chữ (nội dung block chưa vẽ)
    function mauMl(v, st) {
      const c = (v >>> 0), k = c >>> 24;
      if (k === 0xC3) { const i = c & 0xff; return i >= 1 && i <= 255 ? ACI[i] : st.rgb; }
      if (k === 0xC2) return c & 0xffffff;
      return st.rgb;                           // theo layer / theo block
    }
    function mleader(e, st, m) {
      const sc = e.contextScale > 0 ? e.contextScale : e.contentScale > 0 ? e.contentScale : 1;
      // cỡ mũi tên: ưu tiên số trong dữ liệu ngữ cảnh (đã nhân tỉ lệ), không có thì lấy cỡ chung × tỉ lệ
      const muiTen = e.contextArrowSize > 0 ? e.contextArrowSize : (e.arrowheadSize || 0) * sc;
      const lst = { ...st, rgb: mauMl(e.leaderLineColor, st) };
      for (const sec of (e.leaderSections || [])) {
        const last = sec.lastLeaderLinePoint;
        for (const ln of (sec.leaderLines || [])) {
          const v = (ln.vertices || []).map(p => [p.x, p.y]);
          if (last && sec.lastLeaderLinePointSet !== false) v.push([last.x, last.y]);
          if (v.length >= 2) addLine(lst, v.flat(), m);
          // mũi tên tô đặc ở điểm đầu
          if (v.length >= 2 && muiTen > 0) {
            const [x0, y0] = v[0], [x1, y1] = v[1], L = muiTen, a = Math.atan2(y1 - y0, x1 - x0);
            if (Math.hypot(x1 - x0, y1 - y0) > L * 0.5) addFill(lst, [[x0, y0, x0 + L * Math.cos(a + 0.3), y0 + L * Math.sin(a + 0.3), x0 + L * Math.cos(a - 0.3), y0 + L * Math.sin(a - 0.3)]], m);
          }
        }
        if (last && e.doglegEnabled && sec.doglegVector) {
          // độ dài đoạn gãy của nhánh (dữ liệu ngữ cảnh) đã nhân tỉ lệ; giá trị chung của đối tượng thì chưa
          const dl = sec.doglegLength > 0 ? sec.doglegLength : (e.doglegLength || 0) * sc;
          if (dl > 0) addLine(lst, [last.x, last.y, last.x + sec.doglegVector.x * dl, last.y + sec.doglegVector.y * dl], m);
        }
      }
      if (e.hasMText !== false && e.textContent && e.textAnchor) {
        const tst = { ...st, rgb: mauMl(e.textColor, st) };
        const sty = [...styles.values()].find(s => String(s.handle) === String(e.textStyleId));
        const sMt = mtextPlain(e.textContent, maCua(sty));
        const ap = e.textAttachmentPoint || 1;
        const H = ['left', 'center', 'right'][(ap - 1) % 3] || 'left', V = ['top', 'middle', 'bottom'][Math.floor((ap - 1) / 3)] || 'top';
        const d = e.textDirection && (e.textDirection.x || e.textDirection.y) ? Math.atan2(e.textDirection.y, e.textDirection.x) : (e.textRotation || 0);
        // cỡ chữ, bề rộng khung lấy từ dữ liệu ngữ cảnh (MLEADER_AnnotContext) đã nhân tỉ lệ: không nhân contentScale nữa
        if (sMt.trim()) addText(tst, m, e.textAnchor.x, e.textAnchor.y, e.textHeight > 0 ? e.textHeight : 2.5 * sc, d, sMt, sty?.widthFactor || 1, H, V, 0,
          { ml: 1, ls: 1.667 * (e.textLineSpacingFactor || 1), w: e.textWidth > 0 ? e.textWidth : 0, font: fontOf(sty) });
      }
      layers[st.li].n++;
    }

    // bảng mã chữ Việt cũ theo font của kiểu chữ (font trống thì xét tên kiểu chữ)
    function maCua(sty) {
      if (!sty) return null;
      return sty.font ? kieuMa(sty.font) : kieuMa(sty.name);
    }
    function fontOf(sty) {
      const f = (String(sty?.font || '') + ' ' + String(sty?.name || '')).toLowerCase();
      // font hẹp: nhận cả theo tên kiểu chữ vì kiểu chữ TrueType hay để trống ô font (vd TTP-HelCon, VNI-HELVEC250)
      if (/cond|narrow|compress|arialn\.ttf|helcon|helvec|helv-?c\b|vhelvcn|vhelvc/.test(f)) return 'sans-serif-condensed, "Roboto Condensed", "Arial Narrow", sans-serif';
      if (/times|vntime|roman[tc]/.test(f)) return 'serif';
      return 'sans-serif';
    }

    function hatch(e, st, m) {
      const loops = [];
      for (const bp of (e.boundaryPaths || [])) {
        let pts = [];
        if (bp.vertices) pts = vertsPts(bp.vertices, true);
        else if (bp.edges) {
          for (const ed of bp.edges) {
            const seg = [];
            if (ed.type === 1) seg.push(ed.start.x, ed.start.y, ed.end.x, ed.end.y);
            else if (ed.type === 2 || ed.type === 3) {
              // cung tròn / cung elip. isCCW là 0/1 (LibreDWG) hoặc true/false (DXF); không có thì coi là ngược kim đồng hồ.
              // Cung chiều kim đồng hồ: AutoCAD lưu góc theo chiều ngược, góc thật = 2π - góc lưu; vẽ xong đảo thứ tự điểm.
              const ccw = ed.isCCW === undefined || ed.isCCW === null ? true : !!ed.isCCW;
              let a0 = ed.startAngle, a1 = ed.endAngle;
              if (!ccw) { const t = a0; a0 = TAU - a1; a1 = TAU - t; }
              const tmp = [];
              if (ed.type === 2) arcPts(tmp, ed.center.x, ed.center.y, ed.radius, a0, a1, true);
              else ellipsePts(tmp, ed.center, { x: ed.end.x, y: ed.end.y }, ed.lengthOfMinorAxis || 1, a0, a1, 1);
              if (!ccw) for (let i = tmp.length - 2; i >= 0; i -= 2) seg.push(tmp[i], tmp[i + 1]); else seg.push(...tmp);
            } else if (ed.type === 4) seg.push(...splinePts({ ...ed, fitPoints: ed.fitDatum }));
            pts.push(...seg);
          }
        }
        if (pts.length >= 6) loops.push(pts);
      }
      if (!loops.length) return;
      const solid = e.solidFill === 1 || String(e.patternName || '').toUpperCase() === 'SOLID';
      if (solid) { addFill(st, loops, m); return; }
      // hatch mẫu: lưu vòng biên + các họ đường mẫu (đã biến đổi)
      const r = rings(st, loops, m);
      const diag = Math.hypot(r.x1 - r.x0, r.y1 - r.y0) || 1;
      const k = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
      let fam = [];
      for (const d of (e.definitionLines || [])) {
        const off = Math.hypot(d.offset.x, d.offset.y) * k;
        if (!(off > diag / 3000) || off > diag) { fam = null; break; }
        const ux = Math.cos(d.angle), uy = Math.sin(d.angle);
        const bx = m[0] * d.base.x + m[2] * d.base.y + m[4], by = m[1] * d.base.x + m[3] * d.base.y + m[5];
        const dx = m[0] * ux + m[2] * uy, dy = m[1] * ux + m[3] * uy, dl = Math.hypot(dx, dy) || 1;
        const ox = m[0] * d.offset.x + m[2] * d.offset.y, oy = m[1] * d.offset.x + m[3] * d.offset.y;
        fam.push({ bx, by, dx: dx / dl, dy: dy / dl, ox, oy, dash: (d.dashLengths || []).map(v => v * k) });
      }
      if (!fam || !fam.length) {
        // số liệu mẫu không hợp lý: thay bằng gạch chéo 45° (kiểu ANSI31)
        const sp = 3.175 * (e.patternScale > 0 ? e.patternScale : 1) * k;
        const a = (e.patternAngle || 0) + Math.PI / 4 + Math.atan2(m[1], m[0]);
        fam = [{ bx: r.x0, by: r.y0, dx: Math.cos(a), dy: Math.sin(a), ox: -Math.sin(a) * sp, oy: Math.cos(a) * sp, dash: [] }];
      }
      cur.hatches.push({ layer: st.li, rgb: st.rgb, rings: Float64Array.from(r.arr), x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1, fam });
      layers[st.li].n++; tong++;
    }

    walk(entities, I, null, 0, new Set());

    // đóng gói thành Float64Array
    const buffers = [];
    const dong = k => {
      const out = [];
      for (const g of k.groups.values()) {
        const chunks = g.chunks.map(c => {
          const a = new Float64Array(c.n); let o = 0;
          for (const p of c.parts) { a.set(p, o); o += p.length; }
          buffers.push(a.buffer);
          return { d: a, x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 };
        });
        out.push({ kind: g.kind, layer: g.layer, rgb: g.rgb, lt: g.lt, lts: g.lts, w: g.w, chunks });
      }
      for (const h of k.hatches) buffers.push(h.rings.buffer);
      return { groups: out, hatches: k.hatches, texts: ghepManh(k.texts), clip: k.clip };
    };
    const chinh = dong(root);
    const cat = clips.map(dong).filter(k => k.groups.length || k.hatches.length || k.texts.length);
    const bbox = Number.isFinite(bx0) ? [bx0, by0, bx1, by1] : [0, 0, 100, 100];
    return { groups: chinh.groups, hatches: chinh.hatches, texts: chinh.texts, clips: cat, bbox, bboxXem: khungXem(mx, my, bbox), buffers };
  }

  // ----- Model -----
  baoTienDo && baoTienDo('Đang dựng hình Model...');
  const ms = [...blocks.values()].find(b => b.name.toUpperCase() === '*MODEL_SPACE');
  const msEnts = (ms && ms.entities && ms.entities.length) ? ms.entities : (db.entities || []).filter(e => !e.isInPaperSpace);
  const model = lamKhong(msEnts);

  // ----- Layout -----
  const layouts = [];
  const LAY = (db.objects?.LAYOUT || []).filter(l => String(l.layoutName).toUpperCase() !== 'MODEL').sort((a, b) => (a.tabOrder || 0) - (b.tabOrder || 0));
  for (const L of LAY) {
    const rec = [...blocks.values()].find(b => b.handle === L.paperSpaceTableId || b.layout === L.handle);
    if (!rec) continue;
    const ents = rec.entities || [];
    if (!ents.length) continue;
    baoTienDo && baoTienDo('Đang dựng layout ' + L.layoutName + '...');
    const sp = lamKhong(ents);
    // layout không có đối tượng riêng: khung chỉ lấy theo viewport (không lấy khung mặc định 0..100)
    if (!sp.groups.length && !sp.hatches.length && !sp.texts.length && !(sp.clips || []).length) sp.bbox = [Infinity, Infinity, -Infinity, -Infinity];
    const vps = [];
    for (const v of ents) {
      if (v.type !== 'VIEWPORT' || v.viewportId === 1 || !(v.width > 0) || !(v.viewHeight > 0)) continue;
      if (v.statusBitFlags & 0x20000) continue; // viewport tắt
      // viewport của chính tờ giấy (nhìn 1:1 vào tâm giấy) thì bỏ
      const dc = v.displayCenter || { x: 0, y: 0 };
      if (Math.abs(v.height / v.viewHeight - 1) < 1e-9 && Math.abs(dc.x - v.viewportCenter.x) < 1e-6 && Math.abs(dc.y - v.viewportCenter.y) < 1e-6) continue;
      vps.push({ cx: v.viewportCenter.x, cy: v.viewportCenter.y, w: v.width, h: v.height,
        vx: (v.displayCenter?.x || 0) + (v.targetPoint?.x || 0), vy: (v.displayCenter?.y || 0) + (v.targetPoint?.y || 0),
        k: v.height / v.viewHeight, tw: v.twistAngle || 0 });
      const x0 = v.viewportCenter.x - v.width / 2, y0 = v.viewportCenter.y - v.height / 2;
      sp.bbox = [Math.min(sp.bbox[0], x0), Math.min(sp.bbox[1], y0), Math.max(sp.bbox[2], x0 + v.width), Math.max(sp.bbox[3], y0 + v.height)];
    }
    sp.vps = vps;
    if (!Number.isFinite(sp.bbox[0])) sp.bbox = [0, 0, 100, 100];
    sp.bboxXem = sp.bbox;
    layouts.push({ name: L.layoutName, space: sp });
  }

  const buffers = [...model.buffers, ...layouts.flatMap(l => l.space.buffers)];
  delete model.buffers; layouts.forEach(l => delete l.space.buffers);
  const units = db.header?.INSUNITS ?? 0;
  return { layers, ltypes, model, layouts, units, tong, boQua, buffers };
}
