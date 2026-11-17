// Đọc file DXF dạng văn bản (ASCII) thành cấu trúc giống DwgDatabase của LibreDWG,
// để dùng chung bộ chuyển đổi chuyen-doi.js và phần vẽ.

const RAD = Math.PI / 180;

const CODEPAGE = {
  ANSI_874: 'windows-874', ANSI_1250: 'windows-1250', ANSI_1251: 'windows-1251', ANSI_1252: 'windows-1252',
  ANSI_1253: 'windows-1253', ANSI_1254: 'windows-1254', ANSI_1255: 'windows-1255', ANSI_1256: 'windows-1256',
  ANSI_1257: 'windows-1257', ANSI_1258: 'windows-1258', ANSI_932: 'shift_jis', ANSI_936: 'gbk', ANSI_949: 'euc-kr', ANSI_950: 'big5',
};

export function laDxf(buf) {
  const head = new TextDecoder('latin1').decode(new Uint8Array(buf, 0, Math.min(buf.byteLength, 4096)));
  if (head.startsWith('AutoCAD Binary DXF')) return 'nhiphan';
  return /^\s*0\s*\r?\n\s*SECTION\s*\r?\n/.test(head) || /\r?\n\s*0\s*\r?\n\s*SECTION\s*\r?\n\s*2\s*\r?\n\s*(HEADER|CLASSES|TABLES|BLOCKS|ENTITIES)/.test(head) ? 'dxf' : null;
}

function giaiMaVanBan(buf) {
  const u8 = new Uint8Array(buf);
  const head = new TextDecoder('latin1').decode(u8.subarray(0, Math.min(u8.length, 65536)));
  const ver = (head.match(/\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*(\S+)/) || [])[1] || '';
  const cp = (head.match(/\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*(\S+)/) || [])[1] || '';
  let enc = 'windows-1252';
  if (ver >= 'AC1021') enc = 'utf-8';                     // từ AutoCAD 2007 DXF lưu UTF-8
  else if (CODEPAGE[cp.toUpperCase()]) enc = CODEPAGE[cp.toUpperCase()];
  let text;
  try { text = new TextDecoder(enc).decode(u8); } catch (e) { text = new TextDecoder('windows-1252').decode(u8); }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return { text, ver, cp };
}

// ---- tách thành các bản ghi: mỗi bản ghi bắt đầu bằng mã 0 ----
function banGhi(text) {
  const L = text.split(/\r\n|\n|\r/);
  const recs = [];
  let cur = null;
  for (let i = 0; i + 1 < L.length; i += 2) {
    const code = parseInt(L[i], 10);
    if (Number.isNaN(code)) { i--; continue; }            // dòng lạc: dịch lại một dòng cho khớp cặp
    const val = L[i + 1];
    if (code === 0) { cur = { t: val.trim(), p: [] }; recs.push(cur); }
    else if (cur) cur.p.push([code, val]);
  }
  return recs;
}

// ---- tiện ích đọc cặp mã ----
function bo(p) {
  const first = new Map();
  for (const [c, v] of p) if (!first.has(c)) first.set(c, v);
  const s = (c, d = '') => (first.has(c) ? String(first.get(c)) : d);
  const n = (c, d = 0) => { if (!first.has(c)) return d; const x = parseFloat(first.get(c)); return Number.isFinite(x) ? x : d; };
  const pt = (cx, d) => (first.has(cx) ? { x: n(cx), y: n(cx + 10), z: n(cx + 20) } : d);
  return { s, n, pt, has: c => first.has(c) };
}

function chung(t, p) {
  const g = bo(p);
  const e = {
    type: t, handle: g.s(5).trim(), layer: g.s(8, '0').trim(), lineType: g.s(6, '').trim(),
    colorIndex: g.has(62) ? Math.abs(g.n(62)) : 256, lineTypeScale: g.n(48, 1),
    isVisible: g.n(60, 0) !== 1, isInPaperSpace: g.n(67, 0) === 1,
    ownerBlockRecordSoftId: g.s(330).trim(),
  };
  if (g.has(420)) e.color = g.n(420) & 0xffffff;
  if (g.has(210) || g.has(230)) e.extrusionDirection = { x: g.n(210), y: g.n(220), z: g.n(230, 1) };
  // từ điển mở rộng (dùng cho XCLIP): 102 {ACAD_XDICTIONARY / 360 handle / 102 }
  const ix = p.findIndex(x => x[0] === 102 && x[1].trim() === '{ACAD_XDICTIONARY');
  if (ix >= 0 && p[ix + 1] && p[ix + 1][0] === 360) e.ownerDictionaryHardId = p[ix + 1][1].trim();
  return { e, g };
}

function textBase(g, vCode) {
  return {
    text: g.s(1), startPoint: g.pt(10, { x: 0, y: 0, z: 0 }), endPoint: g.pt(11, { x: 0, y: 0, z: 0 }),
    textHeight: g.n(40), rotation: g.n(50) * RAD, xScale: g.n(41, 1), obliqueAngle: g.n(51) * RAD,
    styleName: g.s(7, 'STANDARD').trim(), halign: g.n(72), valign: g.n(vCode), generationFlag: g.n(71),
  };
}

function hatch(e, p) {
  let k = 0;
  const peek = () => (k < p.length ? p[k][0] : -1);
  const rd = (code, d = 0) => { if (peek() === code) { const v = parseFloat(p[k][1]); k++; return Number.isFinite(v) ? v : d; } return d; };
  // phần đầu đến số đường biên (91)
  while (k < p.length && p[k][0] !== 91) {
    const [c, v] = p[k];
    if (c === 2) e.patternName = String(v).trim();
    else if (c === 70) e.solidFill = parseInt(v, 10) || 0;
    k++;
  }
  const npath = rd(91);
  e.boundaryPaths = [];
  for (let b = 0; b < npath && k < p.length; b++) {
    while (k < p.length && peek() !== 92) k++;
    const flag = rd(92);
    if (flag & 2) {
      const hasBulge = rd(72), closed = rd(73); rd(93);
      const vertices = [];
      while (peek() === 10) { const x = rd(10), y = rd(20); const bulge = peek() === 42 ? rd(42) : 0; vertices.push({ x, y, bulge }); }
      e.boundaryPaths.push({ boundaryPathTypeFlag: flag, hasBulge, isClosed: closed, vertices });
    } else {
      const ne = rd(93), edges = [];
      for (let j = 0; j < ne && k < p.length; j++) {
        const type = rd(72);
        if (type === 1) edges.push({ type, start: { x: rd(10), y: rd(20) }, end: { x: rd(11), y: rd(21) } });
        else if (type === 2) {
          const center = { x: rd(10), y: rd(20) }, radius = rd(40), sa = rd(50), ea = rd(51), ccw = rd(73, 1);
          edges.push({ type, center, radius, startAngle: sa * RAD, endAngle: ea * RAD, isCCW: !!ccw });
        } else if (type === 3) {
          const center = { x: rd(10), y: rd(20) }, end = { x: rd(11), y: rd(21) }, ratio = rd(40), sa = rd(50), ea = rd(51), ccw = rd(73, 1);
          edges.push({ type, center, end, lengthOfMinorAxis: ratio, startAngle: sa * RAD, endAngle: ea * RAD, isCCW: !!ccw });
        } else if (type === 4) {
          const degree = rd(94); rd(73); rd(74); rd(95); rd(96);
          const knots = [], controlPoints = [], fitDatum = [];
          while (peek() === 40) knots.push(rd(40));
          while (peek() === 10) { const c = { x: rd(10), y: rd(20) }; if (peek() === 42) c.weight = rd(42); controlPoints.push(c); }
          if (peek() === 97) { rd(97); while (peek() === 11) fitDatum.push({ x: rd(11), y: rd(21) }); }
          if (peek() === 12) { rd(12); rd(22); } if (peek() === 13) { rd(13); rd(23); }
          edges.push({ type, degree, knots, controlPoints, fitDatum });
        } else break;                                     // dữ liệu lạ: dừng đọc biên này
      }
      e.boundaryPaths.push({ boundaryPathTypeFlag: flag, edges });
    }
    if (peek() === 97) { const ns = rd(97); for (let j = 0; j < ns && peek() === 330; j++) k++; }
  }
  // phần sau: kiểu, góc, tỉ lệ, các đường mẫu
  e.definitionLines = [];
  while (k < p.length) {
    const c = p[k][0];
    if (c === 52) e.patternAngle = rd(52) * RAD;
    else if (c === 41) e.patternScale = rd(41);
    else if (c === 78) {
      const nl = rd(78);
      for (let j = 0; j < nl && k < p.length; j++) {
        while (k < p.length && peek() !== 53) k++;
        const angle = rd(53) * RAD, base = { x: rd(43), y: rd(44) }, offset = { x: rd(45), y: rd(46) };
        rd(79);
        const dashLengths = [];
        while (peek() === 49) dashLengths.push(rd(49));
        e.definitionLines.push({ angle, base, offset, dashLengths });
      }
    } else k++;
  }
  return e;
}

function thucThe(r) {
  const { e, g } = chung(r.t, r.p);
  switch (r.t) {
    case 'LINE': e.startPoint = g.pt(10); e.endPoint = g.pt(11); break;
    case 'CIRCLE': e.center = g.pt(10); e.radius = g.n(40); break;
    case 'ARC': e.center = g.pt(10); e.radius = g.n(40); e.startAngle = g.n(50) * RAD; e.endAngle = g.n(51) * RAD; break;
    case 'ELLIPSE': e.center = g.pt(10); e.majorAxisEndPoint = g.pt(11); e.axisRatio = g.n(40, 1); e.startAngle = g.n(41, 0); e.endAngle = g.n(42, Math.PI * 2); break;
    case 'LWPOLYLINE': {
      e.flag = g.n(70); e.constantWidth = g.n(43);
      if (e.flag & 1) e.flag |= 512;                      // quy cờ khép kín của DXF (bit 1) về kiểu DWG (bit 512)
      const v = [];
      for (const [c, val] of r.p) {
        if (c === 10) v.push({ x: parseFloat(val), y: 0, bulge: 0 });
        else if (c === 20 && v.length) v[v.length - 1].y = parseFloat(val);
        else if (c === 42 && v.length) v[v.length - 1].bulge = parseFloat(val);
      }
      e.vertices = v; break;
    }
    case 'SPLINE': {
      e.flag = g.n(70); e.degree = g.n(71, 3);
      const knots = [], cps = [], fit = [], w = [];
      for (const [c, val] of r.p) {
        const x = parseFloat(val);
        if (c === 40) knots.push(x);
        else if (c === 41) w.push(x);
        else if (c === 10) cps.push({ x, y: 0, z: 0 }); else if (c === 20 && cps.length) cps[cps.length - 1].y = x;
        else if (c === 11) fit.push({ x, y: 0, z: 0 }); else if (c === 21 && fit.length) fit[fit.length - 1].y = x;
      }
      w.forEach((x, i) => { if (cps[i]) cps[i].weight = x; });
      e.knots = knots; e.controlPoints = cps; e.fitPoints = fit; break;
    }
    case 'TEXT': Object.assign(e, textBase(g, 73)); break;
    case 'MTEXT': {
      let s = '';
      for (const [c, val] of r.p) if (c === 3) s += val;
      e.text = s + g.s(1); e.insertionPoint = g.pt(10, { x: 0, y: 0, z: 0 }); e.textHeight = g.n(40); e.rectWidth = g.n(41);
      e.attachmentPoint = g.n(71, 1); e.drawingDirection = g.n(72, 1); e.styleName = g.s(7, 'STANDARD').trim();
      e.extentsWidth = g.n(42); e.extentsHeight = g.n(43);   // bề rộng/cao thật AutoCAD đã vẽ
      e.rotation = g.n(50); e.lineSpacing = g.n(44, 1);
      if (g.has(11)) e.direction = g.pt(11);
      break;
    }
    case 'INSERT':
      e.name = g.s(2).trim(); e.insertionPoint = g.pt(10, { x: 0, y: 0, z: 0 });
      e.xScale = g.n(41, 1); e.yScale = g.n(42, 1); e.zScale = g.n(43, 1); e.rotation = g.n(50) * RAD;
      e.columnCount = g.n(70, 1); e.rowCount = g.n(71, 1); e.columnSpacing = g.n(44); e.rowSpacing = g.n(45);
      e.attribs = []; break;
    case 'ATTRIB': case 'ATTDEF':
      e.text = textBase(g, 74); if (e.extrusionDirection) e.text.extrusionDirection = e.extrusionDirection;
      e.tag = g.s(2).trim(); e.flags = g.n(70); e.mtextFlag = 0; break;
    case 'ACAD_TABLE':
      // bảng: 2 = block *T chứa hình đã dựng, 10/20 = điểm chèn, 11/21 = hướng ngang
      e.name = g.s(2).trim(); e.insertionPoint = g.pt(10, { x: 0, y: 0, z: 0 });
      e.rotation = g.has(11) ? Math.atan2(g.n(21), g.n(11)) : 0; break;
    case 'DIMENSION':
      e.name = g.s(2).trim(); e.definitionPoint = g.pt(10); e.textPoint = g.pt(11);
      if (g.has(12)) e.insertionPoint = g.pt(12);
      e.dimensionType = g.n(70); e.text = g.s(1); e.styleName = g.s(3).trim(); break;
    case 'SOLID': case 'TRACE': case '3DFACE':
      e.corner1 = g.pt(10); e.corner2 = g.pt(11); e.corner3 = g.pt(12); e.corner4 = g.pt(13, e.corner3); e.flag = g.n(70); break;
    case 'LEADER': {
      const v = [];
      for (const [c, val] of r.p) { if (c === 10) v.push({ x: parseFloat(val), y: 0 }); else if (c === 20 && v.length) v[v.length - 1].y = parseFloat(val); }
      e.vertices = v; break;
    }
    case 'VIEWPORT':
      e.viewportCenter = g.pt(10); e.width = g.n(40); e.height = g.n(41); e.viewportId = g.n(69);
      e.displayCenter = g.pt(12, { x: 0, y: 0 }); e.viewHeight = g.n(45); e.statusBitFlags = g.n(90);
      e.targetPoint = g.pt(17, { x: 0, y: 0, z: 0 }); e.twistAngle = g.n(51) * RAD; break;
    case 'HATCH': hatch(e, r.p); break;
    case 'POLYLINE':
      e.flag = g.n(70); e.startWidth = g.n(40); e.endWidth = g.n(41); e.vertices = [];
      e.type = (e.flag & (8 | 16 | 64)) ? 'POLYLINE3D' : 'POLYLINE2D'; break;
    case 'VERTEX':
      Object.assign(e, g.pt(10, { x: 0, y: 0, z: 0 })); e.bulge = g.n(42); e.flag = g.n(70); e.startWidth = g.n(40); e.endWidth = g.n(41); break;
    default: break;
  }
  return e;
}

// ---- dựng cơ sở dữ liệu ----
export function docDxf(buf) {
  const { text, ver } = giaiMaVanBan(buf);
  const recs = banGhi(text);
  const header = {};
  const tables = { LAYER: { entries: [] }, LTYPE: { entries: [] }, STYLE: { entries: [] }, BLOCK_RECORD: { entries: [] } };
  const layouts = [], dictionaries = [], filters = [];
  const blocks = [];          // {name, basePoint, handle, owner, entities, xref}
  const entities = [];
  let sec = '', block = null;

  // gom thực thể kèm VERTEX/ATTRIB theo sau
  const them = (list, e) => list.push(e);
  let seqOwner = null;

  for (const r of recs) {
    if (r.t === 'SECTION') {
      sec = (r.p.find(x => x[0] === 2) || [0, ''])[1].trim();
      if (sec === 'HEADER') {
        for (let i = 0; i < r.p.length; i++) {
          if (r.p[i][0] !== 9) continue;
          const name = r.p[i][1].trim(), v = r.p[i + 1];
          if (!v) continue;
          // mã 1..9 là chuỗi, còn lại là số (điểm thì lấy tọa độ đầu)
          const x = parseFloat(v[1]);
          header[name.slice(1)] = v[0] < 10 || !Number.isFinite(x) ? v[1].trim() : x;
        }
      }
      continue;
    }
    if (r.t === 'ENDSEC') { sec = ''; continue; }

    if (sec === 'TABLES') {
      const g = bo(r.p);
      if (r.t === 'LAYER') {
        const c = g.n(62, 7);
        tables.LAYER.entries.push({ name: g.s(2).trim(), colorIndex: g.has(420) ? 256 : Math.abs(c), color: g.has(420) ? g.n(420) & 0xffffff : undefined,
          off: c < 0, frozen: !!(g.n(70) & 1), lineType: g.s(6, 'Continuous').trim() });
      } else if (r.t === 'LTYPE') {
        tables.LTYPE.entries.push({ name: g.s(2).trim(), pattern: r.p.filter(x => x[0] === 49).map(x => ({ elementLength: parseFloat(x[1]) })) });
      } else if (r.t === 'STYLE') {
        tables.STYLE.entries.push({ name: g.s(2).trim(), font: g.s(3).trim(), bigFont: g.s(4).trim(), fixedTextHeight: g.n(40), widthFactor: g.n(41, 1), lastHeight: g.n(42) });
      } else if (r.t === 'BLOCK_RECORD') {
        tables.BLOCK_RECORD.entries.push({ name: g.s(2).trim(), handle: g.s(5).trim(), layout: g.s(340).trim(), entities: [], basePoint: { x: 0, y: 0, z: 0 } });
      }
      continue;
    }

    if (sec === 'OBJECTS') {
      if (r.t === 'LAYOUT') {
        // tên, thứ tự, block của layout nằm sau mốc 100 AcDbLayout (trước đó là thiết lập in)
        const i = r.p.findIndex(x => x[0] === 100 && x[1].trim() === 'AcDbLayout');
        const g = bo(i >= 0 ? r.p.slice(i) : r.p);
        layouts.push({ layoutName: g.s(1).trim(), tabOrder: g.n(71), handle: bo(r.p).s(5).trim(), paperSpaceTableId: g.s(330).trim() });
      } else if (r.t === 'DICTIONARY') {
        // mục từ điển: 3 = tên, 350/360 = handle
        const entries = {};
        for (let i = 0; i < r.p.length; i++) if (r.p[i][0] === 3 && r.p[i + 1] && (r.p[i + 1][0] === 350 || r.p[i + 1][0] === 360)) entries[r.p[i][1].trim()] = r.p[i + 1][1].trim();
        dictionaries.push({ handle: bo(r.p).s(5).trim(), entries });
      } else if (r.t === 'SPATIAL_FILTER') {
        // khung XCLIP: 70 số điểm, 10/20 các điểm, rồi hai ma trận (xem dưới)
        const vertices = [], d40 = [];
        for (const [c, v] of r.p) {
          if (c === 10) vertices.push({ x: parseFloat(v), y: 0 });
          else if (c === 20 && vertices.length) vertices[vertices.length - 1].y = parseFloat(v);
          else if (c === 40) d40.push(parseFloat(v));
        }
        // thứ tự mã 40: [khoảng cắt trước nếu có] + 12 số ma trận nghịch đảo block + 12 số ma trận khung cắt,
        // mỗi ma trận 4x3 ghi theo cột -> đổi sang dạng 3x4 theo hàng như dữ liệu DWG
        const n = d40.length;
        const hang = c => [c[0], c[3], c[6], c[9], c[1], c[4], c[7], c[10], c[2], c[5], c[8], c[11]];
        const inv = n >= 24 ? hang(d40.slice(n - 24, n - 12)) : null, mat = n >= 24 ? hang(d40.slice(n - 12)) : null;
        filters.push({ handle: bo(r.p).s(5).trim(), vertices, invertBlockMatrix: inv, matrix: mat });
      }
      continue;
    }

    if (sec === 'BLOCKS' || sec === 'ENTITIES') {
      if (r.t === 'BLOCK') {
        const g = bo(r.p);
        block = { name: g.s(2).trim(), basePoint: g.pt(10, { x: 0, y: 0, z: 0 }), owner: g.s(330).trim(), entities: [], xref: !!(g.n(70) & 4) };
        blocks.push(block); seqOwner = null; continue;
      }
      if (r.t === 'ENDBLK') { block = null; seqOwner = null; continue; }
      const list = sec === 'BLOCKS' ? (block ? block.entities : null) : entities;
      if (!list) continue;
      if (r.t === 'SEQEND') { seqOwner = null; continue; }
      const e = thucThe(r);
      if (r.t === 'VERTEX') { if (seqOwner && seqOwner.vertices) seqOwner.vertices.push(e); continue; }
      if (r.t === 'ATTRIB') { if (seqOwner && seqOwner.attribs) seqOwner.attribs.push(e); continue; }
      seqOwner = (r.t === 'POLYLINE' || r.t === 'INSERT') ? e : null;
      them(list, e);
    }
  }

  // ghép BLOCK với BLOCK_RECORD; DXF R12 không có BLOCK_RECORD thì tạo từ BLOCK
  const recBy = new Map(tables.BLOCK_RECORD.entries.map(b => [b.name.toUpperCase(), b]));
  for (const b of blocks) {
    let name = b.name;
    if (/^\$MODEL_SPACE$/i.test(name)) name = '*Model_Space';
    if (/^\$PAPER_SPACE$/i.test(name)) name = '*Paper_Space';
    let rec = recBy.get(name.toUpperCase());
    if (!rec) { rec = { name, handle: b.owner, layout: '', entities: [], basePoint: b.basePoint }; tables.BLOCK_RECORD.entries.push(rec); recBy.set(name.toUpperCase(), rec); }
    rec.basePoint = b.basePoint;
    if (!b.xref) rec.entities.push(...b.entities);
  }
  const get = name => {
    let rec = recBy.get(name.toUpperCase());
    if (!rec) { rec = { name, handle: '', layout: '', entities: [], basePoint: { x: 0, y: 0, z: 0 } }; tables.BLOCK_RECORD.entries.push(rec); recBy.set(name.toUpperCase(), rec); }
    return rec;
  };
  const ms = get('*Model_Space'), ps = get('*Paper_Space');
  for (const e of entities) (e.isInPaperSpace ? ps : ms).entities.push(e);

  if (!header.INSUNITS && header.INSUNITS !== 0) header.INSUNITS = 0;
  return { header, tables, objects: { LAYOUT: layouts, DICTIONARY: dictionaries, SPATIAL_FILTER: filters }, entities, version: ver };
}
