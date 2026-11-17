// TC DWG: xem bản vẽ DWG, DXF trên điện thoại. Giao diện, cử chỉ, layer, đo, ghi chú, xuất file.
import { Ve, mauHienThi, gocKhong, dichMaTran } from './ve.js';

const $ = id => document.getElementById(id);
const C = window.Capacitor;
const isNative = !!(C && C.isNativePlatform && C.isNativePlatform());
const plugin = name => { try { return C.registerPlugin ? C.registerPlugin(name) : C.Plugins[name]; } catch (e) { return C && C.Plugins && C.Plugins[name]; } };
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};

// ---------- thông báo, chờ, hỏi ----------
let toastT = 0;
function toast(msg, ms = 2600) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), ms); }
const busy = (on, text) => { $('busy').hidden = !on; if (text) $('busyText').textContent = text; };
// hỏi nhập chữ; chiXacNhan = true thì chỉ hỏi Đồng ý / Hủy (trả về true hoặc null)
function ask(title, value = '', chiXacNhan = false) {
  return new Promise(res => {
    $('askTitle').textContent = title; $('askText').value = value; $('ask').hidden = false;
    $('askText').hidden = chiXacNhan;
    if (!chiXacNhan) setTimeout(() => $('askText').focus(), 50);
    const done = v => { $('ask').hidden = true; $('askText').hidden = false; $('askYes').onclick = $('askNo').onclick = null; res(v); };
    $('askYes').onclick = () => done(chiXacNhan ? true : $('askText').value.trim());
    $('askNo').onclick = () => done(null);
  });
}

// ---------- trạng thái ----------
const cv = $('cv'), ctx = cv.getContext('2d');
const ve = new Ve();
let doc = null, docKey = '', docName = '';
let sp = 0;                          // 0 = Model, i = layout thứ i
const views = [];                    // khung nhìn mỗi không gian: {cx, cy, s}
let W = 0, H = 0, dpr = 1;
let mode = 'xem';                    // xem | do | ghi
const cfg = Object.assign({ nenSang: false, donVi: 'auto', snap: true }, store.get('cfg', {}));
ve.nenSang = cfg.nenSang;

const space = () => (sp === 0 ? doc.model : doc.layouts[sp - 1].space);
const view = () => views[sp];
function matran(v = view(), w = W, h = H) { return [v.s, 0, 0, -v.s, w / 2 - v.cx * v.s, h / 2 + v.cy * v.s]; }
function visRect(v = view(), w = W, h = H) { const hw = w / 2 / v.s, hh = h / 2 / v.s; return [v.cx - hw, v.cy - hh, v.cx + hw, v.cy + hh]; }
const toWorld = (x, y, v = view()) => [v.cx + (x * dpr - W / 2) / v.s, v.cy - (y * dpr - H / 2) / v.s];
const toScreen = (X, Y, v = view()) => [((X - v.cx) * v.s + W / 2) / dpr, (H / 2 - (Y - v.cy) * v.s) / dpr];

// ---------- đơn vị ----------
function heSoMet() {
  // trả về số mét của 1 đơn vị bản vẽ
  const u = cfg.donVi !== 'auto' ? cfg.donVi : ({ 4: 'mm', 5: 'cm', 6: 'm' }[doc?.units] || 'mm');
  return { mm: 0.001, cm: 0.01, m: 1 }[u] || 0.001;
}
const fmt = (v, d) => v.toLocaleString('vi-VN', { minimumFractionDigits: d, maximumFractionDigits: d });
function chieuDai(len) { const m = len * heSoMet(); return fmt(m * 1000, 0) + ' mm = ' + fmt(m, 3) + ' m'; }
function dienTich(a) { const k = heSoMet(); return fmt(a * k * k, 3) + ' m²'; }

// ---------- kích thước canvas ----------
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);   // trên 2 thì nét không mịn hơn bao nhiêu mà vẽ chậm gấp đôi
  const r = cv.getBoundingClientRect();
  const nw = Math.max(1, Math.round(r.width * dpr)), nh = Math.max(1, Math.round(r.height * dpr));
  if (nw === W && nh === H) return;
  const old = { W, H };
  W = cv.width = nw; H = cv.height = nh;
  snap.width = W; snap.height = H; snapView = null;
  if (doc) {
    // khung vẽ trước đó chưa có kích thước thật (WebView chưa dựng xong): tính lại khung nhìn từ đầu
    if (old.W < 20 || old.H < 20) views.forEach((v, i) => { if (v) fit(i); });
    else views.forEach(v => { if (v) v.s *= Math.min(W / old.W, H / old.H) || 1; });
  }
  veLai();
}
// Android: kích thước khung vẽ có thể đổi sau khi hiện màn xem, hoặc khung vẽ bị mất khi thiếu bộ nhớ đồ họa
try { new ResizeObserver(() => resize()).observe(cv); } catch (e) {}
cv.addEventListener('contextlost', e => { e.preventDefault(); snapView = null; });
cv.addEventListener('contextrestored', () => { snapView = null; veLai(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && doc) { snapView = null; veLai(); } });
const snap = document.createElement('canvas'), sctx = snap.getContext('2d');
let snapView = null, lastMs = 0, fullT = 0, raf = 0;

function fit(i = sp) {
  const s = i === 0 ? doc.model : doc.layouts[i - 1].space;
  const [x0, y0, x1, y1] = s.bboxXem || s.bbox;     // khung bỏ đối tượng lạc ở rất xa
  const w = Math.max(x1 - x0, 1e-6), h = Math.max(y1 - y0, 1e-6);
  const pad = 0.92;
  views[i] = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, s: Math.min(W * pad / w, (H - 120 * dpr) * pad / h) };
}

// ---------- vẽ ----------
function nenMau() { return cfg.nenSang ? '#ffffff' : '#1b1f24'; }
function veDay(c, w, h, v, nenSang, d = dpr) {
  // vẽ đầy đủ một khung (dùng cho màn hình và cho xuất file)
  const M = matran(v, w, h), vis = visRect(v, w, h);
  const old = ve.nenSang; ve.nenSang = nenSang;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = nenSang ? '#ffffff' : '#1b1f24'; c.fillRect(0, 0, w, h);
  if (sp === 0) ve.veKhong(c, doc.model, M, vis, d);
  else ve.veLayout(c, doc.layouts[sp - 1], doc.model, M, vis, d, w, h);
  ve.nenSang = old;
  return M;
}
function veNhanh() {
  // khi đang kéo/phóng: dùng ảnh chụp lần vẽ trước rồi biến đổi, sau đó mới vẽ đầy đủ
  const v = view();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = nenMau(); ctx.fillRect(0, 0, W, H);
  const k = v.s / snapView.s;
  ctx.setTransform(k, 0, 0, k, W / 2 - W / 2 * k + (snapView.cx - v.cx) * v.s, H / 2 - H / 2 * k - (snapView.cy - v.cy) * v.s);
  ctx.drawImage(snap, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  veLop(ctx, matran(), dpr);
}
function veLai(nhanh = false) {
  if (!doc || !W) return;
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    if (nhanh && snapView && lastMs > 30) { veNhanh(); clearTimeout(fullT); fullT = setTimeout(() => veLai(false), 160); return; }
    const t0 = performance.now();
    veDay(ctx, W, H, view(), cfg.nenSang);
    lastMs = performance.now() - t0;
    sctx.setTransform(1, 0, 0, 1, 0, 0); sctx.clearRect(0, 0, W, H); sctx.drawImage(cv, 0, 0);
    snapView = { ...view() };
    veLop(ctx, matran(), dpr);
  });
}

// lớp phủ: ghi chú + kết quả đo + điểm bắt
function veLop(c, M, d) {
  const s = Math.hypot(M[0], M[1]);
  // trừ gốc tọa độ của không gian trước khi đưa vào canvas (bản vẽ đặt xa gốc, xem gocKhong ở ve.js)
  const g = gocKhong(space()), Mg = dichMaTran(M, g);
  c.save();
  c.setTransform(Mg[0], Mg[1], Mg[2], Mg[3], Mg[4], Mg[5]);
  c.lineCap = 'round'; c.lineJoin = 'round';
  if (cfg.hienGhi !== false || mode === 'ghi') for (const a of ghiChu.filter(a => a.sp === sp).concat(nét ? [nét] : [])) veGhi(c, a, s, M, g);
  c.restore();
  if (mode === 'do' || doPts.length) veDo(c, M, d);
  if (bat) {
    const [x, y] = [M[0] * bat.x + M[2] * bat.y + M[4], M[1] * bat.x + M[3] * bat.y + M[5]];
    c.save(); c.strokeStyle = '#00e676'; c.lineWidth = 2 * d; const r = 7 * d;
    c.beginPath();
    if (bat.k === 'mid') { c.moveTo(x, y - r); c.lineTo(x + r, y + r * 0.8); c.lineTo(x - r, y + r * 0.8); c.closePath(); }
    else if (bat.k === 'int') { c.moveTo(x - r, y - r); c.lineTo(x + r, y + r); c.moveTo(x + r, y - r); c.lineTo(x - r, y + r); }
    else if (bat.k === 'near') { c.arc(x, y, r * 0.8, 0, 7); }
    else c.rect(x - r, y - r, 2 * r, 2 * r);
    c.stroke(); c.restore();
  }
}
function veGhi(c, a, s, M, g) {
  c.strokeStyle = c.fillStyle = a.col; c.lineWidth = a.w;
  const gx = g[0], gy = g[1];
  if (a.t === 'pen') {
    c.beginPath(); c.moveTo(a.p[0] - gx, a.p[1] - gy);
    for (let i = 2; i < a.p.length; i += 2) c.lineTo(a.p[i] - gx, a.p[i + 1] - gy);
    c.stroke();
  } else if (a.t === 'rect') {
    c.strokeRect(Math.min(a.p[0], a.p[2]) - gx, Math.min(a.p[1], a.p[3]) - gy, Math.abs(a.p[2] - a.p[0]), Math.abs(a.p[3] - a.p[1]));
  } else if (a.t === 'arrow') {
    const x0 = a.p[0] - gx, y0 = a.p[1] - gy, x1 = a.p[2] - gx, y1 = a.p[3] - gy, ang = Math.atan2(y1 - y0, x1 - x0), L = a.w * 5;
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    c.beginPath(); c.moveTo(x1, y1);
    c.lineTo(x1 - L * Math.cos(ang - 0.45), y1 - L * Math.sin(ang - 0.45));
    c.lineTo(x1 - L * Math.cos(ang + 0.45), y1 - L * Math.sin(ang + 0.45)); c.closePath(); c.fill();
  } else if (a.t === 'text') {
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    const X = M[0] * a.p[0] + M[2] * a.p[1] + M[4], Y = M[1] * a.p[0] + M[3] * a.p[1] + M[5];
    const fp = a.h * s;
    if (fp > 2) {
      c.font = '600 ' + fp + 'px sans-serif'; c.textBaseline = 'top';
      const lines = a.s.split('\n');
      c.lineWidth = fp / 5; c.strokeStyle = cfg.nenSang ? '#fff' : '#000';
      lines.forEach((l, i) => { c.strokeText(l, X, Y + i * fp * 1.25); c.fillText(l, X, Y + i * fp * 1.25); });
    }
    c.restore();
  }
}

// ---------- tải file ----------
let worker = null;
function docFile(buf) {
  return new Promise((res, rej) => {
    if (!worker) worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    // nút Hủy: file lỗi hoặc quá nặng làm bộ đọc chạy mãi thì anh dừng được, không bị kẹt màn hình chờ
    const huy = $('busyHuy');
    const dong = () => { huy.hidden = true; huy.onclick = null; };
    huy.hidden = false;
    huy.onclick = () => { dong(); if (worker) { worker.terminate(); worker = null; } rej(new Error('Đã hủy mở file.')); };
    worker.onmessage = ev => {
      const m = ev.data;
      if (m.tienDo) busy(true, m.tienDo);
      // xong thì đóng luồng đọc: bộ nhớ WASM (gấp ~30 lần cỡ file) không tự thu nhỏ, giữ lại dễ bị Android tắt app
      else if (m.xong) { dong(); worker.terminate(); worker = null; res(m.xong); }
      else if (m.loi) {
        dong(); worker.terminate(); worker = null;
        rej(new Error(/memory|out of bounds|Aborted|OOM|allocation/i.test(m.loi) ? 'File quá nặng so với bộ nhớ trống của máy (' + m.loi + '). Anh đóng bớt app khác rồi mở lại.' : m.loi));
      }
    };
    worker.onerror = e => { dong(); worker.terminate(); worker = null; rej(new Error(e.message || 'Lỗi luồng đọc file')); };
    worker.postMessage({ buf }, [buf]);
  });
}

// ---------- kho bản đã dựng (IndexedDB): mở lại cùng bản vẽ không phải đọc, giải mã DWG lần nữa ----------
const KHO_BAN = 'v2026-11-14b';             // đổi khi sửa bộ chuyển đổi để bỏ bản lưu cũ
const KHO_TOI_DA = 6;                       // giữ tối đa 6 bản vẽ gần nhất
let khoP = null;
function kho() {
  if (!khoP) khoP = new Promise((res, rej) => {
    const q = indexedDB.open('tcdwg-kho', 1);
    q.onupgradeneeded = () => q.result.createObjectStore('ban');
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
  return khoP;
}
async function khoLay(key) {
  try {
    const db = await kho();
    return await new Promise(res => {
      const q = db.transaction('ban').objectStore('ban').get(key);
      q.onsuccess = () => res(q.result || null); q.onerror = () => res(null);
    });
  } catch (e) { return null; }
}
async function khoCat(key, val) {
  try {
    const db = await kho();
    const ds = store.get('kho', []).filter(k => k !== key && k.startsWith(KHO_BAN + '|'));
    const bo = store.get('kho', []).filter(k => k !== key && !ds.includes(k));
    while (ds.length >= KHO_TOI_DA) bo.push(ds.pop());
    const tx = db.transaction('ban', 'readwrite'), os = tx.objectStore('ban');
    for (const k of bo) os.delete(k);
    os.put(val, key);                           // put chép dữ liệu ngay lúc gọi (trước khi bộ vẽ gắn Path2D vào)
    ds.unshift(key); store.set('kho', ds);
    await new Promise(res => { tx.oncomplete = res; tx.onerror = res; tx.onabort = res; });
  } catch (e) { console.warn('Không lưu được bản dựng sẵn', e); }
}
// dấu vân tay nhanh của file (lấy mẫu ~2000 vị trí + đầu/cuối) để không nhầm hai file cùng tên, cùng cỡ
function vanTay(buf) {
  const u = new Uint8Array(buf), n = u.length;
  let h = 2166136261 >>> 0;
  const an = i => { h = Math.imul(h ^ u[i], 16777619) >>> 0; };
  for (let i = 0; i < Math.min(n, 4096); i++) an(i);
  for (let i = Math.max(0, n - 4096); i < n; i++) an(i);
  const buoc = Math.max(1, Math.floor(n / 2000));
  for (let i = 0; i < n; i += buoc) an(i);
  return h.toString(16);
}

async function moBuffer(buf, name, opt = {}) {
  busy(true, 'Đang mở ' + name + '...');
  const size = buf.byteLength;
  // bản sao cho "Mở gần đây": không chép buf (tốn gấp đôi bộ nhớ); lưu sau từ file gốc (opt.file hoặc opt.cache)
  const keep = isNative && !opt.fromRecent ? { file: opt.file || null, cache: opt.cache || null } : null;
  try {
    const t0 = performance.now();
    const khoaKho = KHO_BAN + '|' + name + '|' + size + '|' + vanTay(buf);
    let r = await khoLay(khoaKho), coSan = !!r;
    if (r) buf = null;
    else {
      r = await docFile(buf);
      buf = null;
      if (r.tong > 20000) { busy(true, 'Đang lưu bản dựng sẵn để lần sau mở nhanh...'); await khoCat(khoaKho, r); }
    }
    doc = r; docName = name; docKey = name + '|' + size;
    ve.layers = r.layers; ve.ltypes = r.ltypes;
    // trạng thái layer đã lưu cho file này
    const saved = store.get('lyr:' + docKey, null);
    if (saved) r.layers.forEach(L => { if (L.name in saved) L.on = saved[L.name]; });
    sp = 0; views.length = 0;
    ghiChu = store.get('ghi:' + docKey, []);
    doPts = []; bat = null;
    // Model trống mà Layout có hình thì mở thẳng Layout đầu tiên có nội dung
    const coHinh = s => s.groups.length + s.hatches.length + s.texts.length + (s.clips || []).length > 0;
    if (!coHinh(r.model)) { const k = r.layouts.findIndex(l => coHinh(l.space) || l.space.vps.length); if (k >= 0) sp = k + 1; }
    showViewer();
    // đợi WebView dựng xong màn xem (có hạn chờ phòng khi trang đang chạy ngầm)
    await new Promise(res => { let xong = false; const f = () => { if (!xong) { xong = true; res(); } }; requestAnimationFrame(() => requestAnimationFrame(f)); setTimeout(f, 150); });
    resize(); fit(sp); veLai();
    buildTabs();
    const ms = Math.round(performance.now() - t0);
    const sk = Object.entries(r.boQua || {}).filter(([k]) => !/^(POINT|ATTDEF)$/.test(k));
    const xref = sk.filter(([k]) => /^(XREF|Block thiếu): /.test(k)).map(([k]) => k.replace(/^[^:]+: /, ''));
    const khac = sk.filter(([k]) => !/^(XREF|Block thiếu): /.test(k));
    let msg = 'Đã mở ' + r.tong.toLocaleString('vi-VN') + ' đối tượng trong ' + (ms / 1000).toFixed(1) + ' giây' + (coSan ? ' (bản dựng sẵn)' : '');
    if (!r.tong) msg = 'File không có đối tượng nào hiển thị được';
    if (xref.length) msg += '. Bản vẽ tham chiếu file ngoài (XREF) không gửi kèm: ' + xref.slice(0, 4).join(', ') + (xref.length > 4 ? '... (' + xref.length + ' file)' : '');
    const TEN = { OLE2FRAME: 'ảnh chèn OLE', IMAGE: 'ảnh chèn', ACAD_TABLE: 'bảng AutoCAD 2010+ (bộ đọc chưa hỗ trợ)', MULTILEADER: 'đường dẫn chú thích', PROXY: 'đối tượng riêng của phần mềm khác', RAY: 'tia', XLINE: 'đường vô hạn' };
    if (khac.length) msg += '. Chưa hiển thị: ' + khac.slice(0, 5).map(([k, n]) => (TEN[k] || k) + ' (' + n + ')').join(', ');
    if (sp) msg += '. Model trống, đang mở ' + r.layouts[sp - 1].name;
    if (ghiChu.length) msg += '. File có ' + ghiChu.length + ' ghi chú tay anh đã vẽ (xóa trong Ghi chú → Xóa hết, ẩn trong ⋮ Tùy chọn)';
    toast(msg, xref.length || khac.length || !r.tong || ghiChu.length ? 8000 : 3000);
    themGanDay(name, size, keep, opt);
  } catch (e) {
    console.error(e);
    toast('Không mở được file: ' + e.message, 7000);
  } finally { busy(false); }
}

// ---------- mở gần đây ----------
const FS = isNative ? plugin('Filesystem') : null;
function ab2b64(buf) {
  const u = new Uint8Array(buf); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
const safeName = n => n.replace(/[\\/:*?"<>|]/g, '_');
async function themGanDay(name, size, keep, opt) {
  const list = store.get('recent', []).filter(x => !(x.name === name && x.size === size));
  const item = { name, size, t: Date.now(), path: opt.path || null };
  if (keep && FS && (keep.file || keep.cache)) {
    try {
      const path = 'banve/' + safeName(name);
      if (keep.cache) {
        // file do app khác gửi sang đã nằm trong cache: chép bằng Java, không qua chuỗi base64
        await plugin('MoFile').luuBanSao({ src: keep.cache, dst: path });
      } else {
        // file chọn trong máy: ghi từng khúc 3 MB (cả file thành một chuỗi base64 làm tràn bộ nhớ Java)
        const K = 3 * 1024 * 1024, f = keep.file;
        for (let o = 0; o < f.size; o += K) {
          const data = ab2b64(await f.slice(o, o + K).arrayBuffer());
          if (o === 0) await FS.writeFile({ path, data, directory: 'DATA', recursive: true });
          else await FS.appendFile({ path, data, directory: 'DATA' });
        }
      }
      item.path = path;
    } catch (e) { console.warn('Không lưu được bản sao', e); }
  }
  list.unshift(item);
  while (list.length > 15) list.pop();
  store.set('recent', list);
  renderRecent();
}
function renderRecent() {
  const list = store.get('recent', []);
  const el = $('recent'); el.innerHTML = '';
  if (!list.length) { el.innerHTML = '<div class="empty">Chưa có bản vẽ nào. Bấm “Mở bản vẽ DWG / DXF” để chọn file trong máy (Zalo, Download, Drive...).</div>'; return; }
  for (const it of list) {
    const b = document.createElement('button'); b.className = 'rc';
    const d = new Date(it.t);
    const duoi = (/\.(dxf|dwg)$/i.exec(it.name) || [, 'dwg'])[1].toUpperCase();
    b.innerHTML = '<div class="ico">' + duoi + '</div><div><div class="nm"></div><div class="mt"></div></div><span class="x" title="Bỏ khỏi danh sách">✕</span>';
    b.querySelector('.nm').textContent = it.name;
    b.querySelector('.mt').textContent = (it.size / 1048576).toFixed(1) + ' MB · ' + d.toLocaleDateString('vi-VN') + ' ' + d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + (it.path ? '' : ' · cần chọn lại file');
    b.onclick = async ev => {
      if (ev.target.classList.contains('x')) {
        store.set('recent', store.get('recent', []).filter(x => !(x.name === it.name && x.size === it.size)));
        if (it.path && FS) FS.deleteFile({ path: it.path, directory: 'DATA' }).catch(() => {});
        renderRecent(); return;
      }
      if (!it.path || !FS) { $('file').click(); return; }
      try {
        busy(true, 'Đang mở ' + it.name + '...');
        const u = await FS.getUri({ path: it.path, directory: 'DATA' });
        const buf = await (await fetch(C.convertFileSrc(u.uri))).arrayBuffer();
        moBuffer(buf, it.name, { fromRecent: true, path: it.path });
      } catch (e) { busy(false); toast('Không tìm thấy bản sao, anh chọn lại file.'); $('file').click(); }
    };
    el.appendChild(b);
  }
}

// Android thường không biết kiểu DWG/DXF nên bộ chọn file lọc mất: trên điện thoại cho hiện mọi file
if (isNative) $('file').removeAttribute('accept');
$('btnOpen').onclick = () => $('file').click();
$('file').onchange = async () => {
  const f = $('file').files[0]; $('file').value = '';
  if (!f) return;
  if (!/\.(dwg|dxf)$/i.test(f.name)) toast('File không có đuôi .dwg hay .dxf, em vẫn thử mở.');
  busy(true, 'Đang chép file...');
  moBuffer(await f.arrayBuffer(), f.name, { file: f });
};

// ---------- chuyển màn ----------
function showViewer() { $('home').hidden = true; $('viewer').hidden = false; $('fname').textContent = docName; }
function showHome() {
  setMode('xem'); closeSheet();
  $('viewer').hidden = true; $('home').hidden = false; renderRecent();
}
$('btnBack').onclick = showHome;

function buildTabs() {
  const el = $('tabs'); el.innerHTML = '';
  const has = doc.layouts.length > 0;
  el.hidden = !has; document.body.classList.toggle('has-tabs', has);
  if (!has) return;
  ['Model', ...doc.layouts.map(l => l.name)].forEach((n, i) => {
    const b = document.createElement('button'); b.textContent = n; if (i === sp) b.className = 'on';
    b.onclick = () => { sp = i; if (!views[i]) fit(i); doPts = []; bat = null; buildTabs(); veLai(); };
    el.appendChild(b);
  });
}

// ---------- cử chỉ ----------
const ptr = new Map();
let g = null, lastTap = 0;
cv.addEventListener('pointerdown', e => {
  try { cv.setPointerCapture(e.pointerId); } catch (err) {}
  ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptr.size === 1) {
    g = { x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false, pinch: false };
    if (mode === 'ghi' && ghiTool !== 'text') batDauNet(e.clientX, e.clientY);
  } else if (ptr.size === 2) {
    if (nét) nét = null;           // ngón thứ hai: hủy nét vẽ, chuyển sang phóng to
    g.pinch = true; g.moved = true;
    const [a, b] = [...ptr.values()];
    g.d = Math.hypot(a.x - b.x, a.y - b.y); g.m = [(a.x + b.x) / 2, (a.y + b.y) / 2];
  }
});
cv.addEventListener('pointermove', e => {
  if (!ptr.has(e.pointerId)) { if (doc && e.pointerType === 'mouse') hienToaDo(e.clientX, e.clientY); return; }
  const p = ptr.get(e.pointerId), dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (!g || !doc) return;
  if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > 8) g.moved = true;
  const v = view();
  if (ptr.size >= 2) {
    const [a, b] = [...ptr.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y), m = [(a.x + b.x) / 2, (a.y + b.y) / 2];
    const before = toWorld(g.m[0], g.m[1]);
    v.s *= d / (g.d || d);
    const after = toWorld(m[0], m[1]);
    v.cx += before[0] - after[0]; v.cy += before[1] - after[1];
    g.d = d; g.m = m;
    veLai(true);
  } else if (nét) {
    themDiemNet(e.clientX, e.clientY); veLai(true);
  } else if (g.moved) {
    v.cx -= dx * dpr / v.s; v.cy += dy * dpr / v.s;
    veLai(true);
  }
});
function upPtr(e) {
  if (!ptr.has(e.pointerId)) return;
  ptr.delete(e.pointerId);
  if (ptr.size > 0) { if (ptr.size === 1 && g) { const [a] = [...ptr.values()]; g.m = [a.x, a.y]; g.d = 0; } return; }
  if (!g) return;
  const tap = !g.moved && performance.now() - g.t0 < 450;
  if (nét) ketThucNet();
  else if (tap) onTap(e.clientX, e.clientY);
  g = null;
  veLai(false);
}
cv.addEventListener('pointerup', upPtr);
cv.addEventListener('pointercancel', e => { nét = null; upPtr(e); });
cv.addEventListener('wheel', e => {
  if (!doc) return; e.preventDefault();
  const v = view(), before = toWorld(e.clientX, e.clientY);
  v.s *= Math.exp(-e.deltaY * 0.0015);
  const after = toWorld(e.clientX, e.clientY);
  v.cx += before[0] - after[0]; v.cy += before[1] - after[1];
  veLai(true);
}, { passive: false });

function onTap(x, y) {
  if (mode === 'do') { themDiemDo(x, y); return; }
  if (mode === 'ghi' && ghiTool === 'text') { themChu(x, y); return; }
  const now = performance.now();
  if (now - lastTap < 320) {           // chạm hai lần: phóng to tại chỗ
    const v = view(), before = toWorld(x, y);
    v.s *= 2.2; const after = toWorld(x, y);
    v.cx += before[0] - after[0]; v.cy += before[1] - after[1];
    lastTap = 0; veLai(); return;
  }
  lastTap = now;
  hienToaDo(x, y);
}
function hienToaDo(x, y) {
  const [X, Y] = toWorld(x, y);
  $('coord').textContent = 'X ' + fmt(X, 0) + '   Y ' + fmt(Y, 0);
}
$('btnFit').onclick = () => { fit(); veLai(); };

// ---------- bắt điểm ----------
let bat = null;
function timDiemBat(x, y) {
  const [X, Y] = toWorld(x, y), v = view();
  const tol = 16 * dpr / v.s;
  const box = [X - tol, Y - tol, X + tol, Y + tol];
  // gom các đoạn thẳng nằm gần chỗ chạm (nét, biên vùng tô)
  const segs = [], ends = [];
  const segIn = (ax, ay, bx, by) => !(Math.max(ax, bx) < box[0] || Math.min(ax, bx) > box[2] || Math.max(ay, by) < box[1] || Math.min(ay, by) > box[3]);
  const s = space();
  // nét của thùng chính và các thùng XCLIP
  for (const gr of [s, ...(s.clips || [])].flatMap(k => k.groups)) {
    if (!ve.layers[gr.layer]?.on) continue;
    for (const c of gr.chunks) {
      if (c.x1 < box[0] || c.x0 > box[2] || c.y1 < box[1] || c.y0 > box[3]) continue;
      const d = c.d;
      const poly = (i, n, real) => {
        for (let k = 0; k < n; k++) {
          const px = d[i + 2 * k], py = d[i + 2 * k + 1];
          if (Math.abs(px - X) <= tol && Math.abs(py - Y) <= tol) ends.push([px, py]);
          if (k > 0) {
            const ax = d[i + 2 * k - 2], ay = d[i + 2 * k - 1];
            if (segs.length < 1500 && segIn(ax, ay, px, py)) segs.push([ax, ay, px, py, real]);
          }
        }
      };
      if (gr.kind === 'L') {
        for (let i = 0; i < d.length;) { const n = d[i++]; poly(i, n, n <= 3); i += 2 * n; }
      } else {
        for (let i = 0; i < d.length;) { const nr = d[i++]; for (let r = 0; r < nr; r++) { const n = d[i++]; poly(i, n, true); i += 2 * n; } }
      }
    }
  }
  const cand = [];   // [x, y, loại, hệ số ưu tiên]
  for (const [x, y] of ends) cand.push([x, y, 'end', 1]);
  for (const sg of segs) if (sg[4]) cand.push([(sg[0] + sg[2]) / 2, (sg[1] + sg[3]) / 2, 'mid', 1.3]);
  // giao điểm giữa các đoạn gần nhau
  const n = Math.min(segs.length, 400);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const [a1, b1, a2, b2] = segs[i], [c1, d1, c2, d2] = segs[j];
    const rx = a2 - a1, ry = b2 - b1, sx = c2 - c1, sy = d2 - d1, den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-12 * (Math.hypot(rx, ry) * Math.hypot(sx, sy) + 1e-30)) continue;
    const t = ((c1 - a1) * sy - (d1 - b1) * sx) / den, u = ((c1 - a1) * ry - (d1 - b1) * rx) / den;
    if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) continue;
    const ix = a1 + t * rx, iy = b1 + t * ry;
    if (Math.abs(ix - X) <= tol && Math.abs(iy - Y) <= tol) cand.push([ix, iy, 'int', 1]);
  }
  let best = null, bd = Infinity;
  for (const [x, y, k, w] of cand) {
    const e = Math.hypot(x - X, y - Y) * w;
    if (e <= tol && e < bd) { bd = e; best = { x, y, k }; }
  }
  if (best) return best;
  // không có điểm đặc biệt: lấy điểm gần nhất trên nét
  for (const [a1, b1, a2, b2] of segs) {
    const dx = a2 - a1, dy = b2 - b1, L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((X - a1) * dx + (Y - b1) * dy) / L2)) : 0;
    const x = a1 + t * dx, y = b1 + t * dy, e = Math.hypot(x - X, y - Y);
    if (e <= tol * 0.6 && e < bd) { bd = e; best = { x, y, k: 'near' }; }
  }
  return best;
}

// ---------- đo ----------
let doKieu = 'dai', doPts = [];
function themDiemDo(x, y) {
  let p;
  const b = cfg.snap ? timDiemBat(x, y) : null;
  if (b) { p = [b.x, b.y]; bat = b; } else { p = toWorld(x, y); bat = null; }
  doPts.push(p);
  capNhatDo(); veLai();
}
function capNhatDo() {
  const n = doPts.length;
  let len = 0;
  for (let i = 1; i < n; i++) len += Math.hypot(doPts[i][0] - doPts[i - 1][0], doPts[i][1] - doPts[i - 1][1]);
  let html;
  if (!n) html = 'Chạm vào bản vẽ để chọn điểm' + (cfg.snap ? ' (tự bắt đầu mút, trung điểm)' : '');
  else if (doKieu === 'dai') {
    html = n === 1 ? 'Chọn điểm tiếp theo' : 'Tổng chiều dài: ' + chieuDai(len);
    if (n >= 2) { const a = doPts[n - 2], b = doPts[n - 1]; html += '<small>Đoạn cuối: ' + chieuDai(Math.hypot(b[0] - a[0], b[1] - a[1])) + ' · ΔX ' + fmt(Math.abs(b[0] - a[0]), 0) + ' · ΔY ' + fmt(Math.abs(b[1] - a[1]), 0) + '</small>'; }
  } else {
    if (n < 3) html = 'Chọn ít nhất 3 điểm (đã có ' + n + ')';
    else {
      let a = 0; for (let i = 0; i < n; i++) { const p = doPts[i], q = doPts[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; }
      const per = len + Math.hypot(doPts[0][0] - doPts[n - 1][0], doPts[0][1] - doPts[n - 1][1]);
      html = 'Diện tích: ' + dienTich(Math.abs(a) / 2) + '<small>Chu vi: ' + chieuDai(per) + ' · ' + n + ' điểm</small>';
    }
  }
  const u = cfg.donVi !== 'auto' ? cfg.donVi : ({ 4: 'mm', 5: 'cm', 6: 'm' }[doc?.units] || 'mm');
  $('doRes').innerHTML = html + (n ? '' : '<small>Đơn vị bản vẽ: ' + u + (doc?.units ? '' : ' (giả định, đổi trong ⋮ Tùy chọn)') + '</small>');
}
function veDo(c, M, d) {
  const n = doPts.length; if (!n) return;
  const P = doPts.map(p => [M[0] * p[0] + M[2] * p[1] + M[4], M[1] * p[0] + M[3] * p[1] + M[5]]);
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
  c.lineWidth = 2.2 * d; c.strokeStyle = '#ff4081'; c.fillStyle = '#ff408133';
  c.beginPath(); P.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
  if (doKieu === 'dt' && n >= 3) { c.closePath(); c.fill(); }
  c.stroke();
  c.fillStyle = '#ff4081';
  for (const p of P) { c.beginPath(); c.arc(p[0], p[1], 4.5 * d, 0, 7); c.fill(); }
  // nhãn chiều dài từng đoạn
  c.font = '600 ' + (12 * d) + 'px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  const segs = []; for (let i = 1; i < n; i++) segs.push([i - 1, i]);
  if (doKieu === 'dt' && n >= 3) segs.push([n - 1, 0]);
  for (const [i, j] of segs) {
    const L = Math.hypot(doPts[j][0] - doPts[i][0], doPts[j][1] - doPts[i][1]) * heSoMet() * 1000;
    const x = (P[i][0] + P[j][0]) / 2, y = (P[i][1] + P[j][1]) / 2, t = fmt(L, 0);
    const w = c.measureText(t).width + 8 * d;
    c.fillStyle = '#000000b0'; c.fillRect(x - w / 2, y - 9 * d, w, 18 * d);
    c.fillStyle = '#fff'; c.fillText(t, x, y);
  }
  c.restore();
}
document.querySelectorAll('[data-do]').forEach(b => b.onclick = () => {
  doKieu = b.dataset.do; document.querySelectorAll('[data-do]').forEach(x => x.classList.toggle('on', x === b)); capNhatDo(); veLai();
});
$('doSnap').onclick = () => { cfg.snap = !cfg.snap; store.set('cfg', cfg); $('doSnap').textContent = 'Bắt điểm: ' + (cfg.snap ? 'bật' : 'tắt'); capNhatDo(); };
$('doUndo').onclick = () => { doPts.pop(); bat = null; capNhatDo(); veLai(); };
$('doClear').onclick = () => { doPts = []; bat = null; capNhatDo(); veLai(); };
$('doDone').onclick = () => setMode('xem');

// ---------- ghi chú ----------
let ghiChu = [], nét = null, ghiTool = 'pen';
const MAU = ['#ff1744', '#2979ff', '#00c853', '#ffd600', '#ff9100', '#ffffff', '#000000'];
let ghiCol = store.get('ghiCol', MAU[0]);
function luuGhi() { store.set('ghi:' + docKey, ghiChu); }
function batDauNet(x, y) {
  const [X, Y] = toWorld(x, y), w = 3 * dpr / view().s;
  nét = { t: ghiTool, sp, col: ghiCol, w, p: ghiTool === 'pen' ? [X, Y] : [X, Y, X, Y] };
}
function themDiemNet(x, y) {
  const [X, Y] = toWorld(x, y);
  if (nét.t === 'pen') nét.p.push(X, Y); else { nét.p[2] = X; nét.p[3] = Y; }
}
function ketThucNet() {
  const a = nét; nét = null;
  if (a.t === 'pen' ? a.p.length >= 4 : Math.hypot(a.p[2] - a.p[0], a.p[3] - a.p[1]) > a.w * 2) { ghiChu.push(a); luuGhi(); }
}
async function themChu(x, y) {
  const s = await ask('Nội dung ghi chú');
  if (!s) return;
  const [X, Y] = toWorld(x, y);
  ghiChu.push({ t: 'text', sp, col: ghiCol, p: [X, Y], h: 16 * dpr / view().s, s });
  luuGhi(); veLai();
}
function renderMau() {
  const el = $('ghiMau'); el.innerHTML = '';
  for (const m of MAU) {
    const b = document.createElement('button'); b.className = 'sw' + (m === ghiCol ? ' on' : ''); b.style.background = m;
    b.onclick = () => { ghiCol = m; store.set('ghiCol', m); renderMau(); };
    el.appendChild(b);
  }
}
document.querySelectorAll('[data-ghi]').forEach(b => b.onclick = () => {
  ghiTool = b.dataset.ghi; document.querySelectorAll('[data-ghi]').forEach(x => x.classList.toggle('on', x === b));
  if (ghiTool === 'text') toast('Chạm vào chỗ cần ghi chữ');
});
$('ghiUndo').onclick = () => { const i = ghiChu.map(a => a.sp).lastIndexOf(sp); if (i >= 0) { ghiChu.splice(i, 1); luuGhi(); veLai(); } };
$('ghiClear').onclick = async () => {
  if (!ghiChu.some(a => a.sp === sp)) return;
  const n = ghiChu.filter(a => a.sp === sp).length;
  if (!(await ask('Xóa hết ' + n + ' ghi chú tay trên trang này? Không khôi phục lại được.', '', true))) return;
  ghiChu = ghiChu.filter(a => a.sp !== sp); luuGhi(); veLai();
};
$('ghiDone').onclick = () => setMode('xem');

function setMode(m) {
  mode = m;
  $('barDo').hidden = m !== 'do'; $('barGhi').hidden = m !== 'ghi';
  $('btnDo').classList.toggle('on', m === 'do'); $('btnGhi').classList.toggle('on', m === 'ghi');
  if (m === 'do') { $('doSnap').textContent = 'Bắt điểm: ' + (cfg.snap ? 'bật' : 'tắt'); capNhatDo(); }
  if (m === 'ghi') renderMau();
  if (m !== 'do') { doPts = []; bat = null; }
  veLai();
}
$('btnDo').onclick = () => setMode(mode === 'do' ? 'xem' : 'do');
$('btnGhi').onclick = () => setMode(mode === 'ghi' ? 'xem' : 'ghi');

// ---------- tấm trượt ----------
function openSheet(title, body, tools) {
  $('sheetTitle').textContent = title; $('sheetBody').innerHTML = ''; $('sheetTools').innerHTML = '';
  if (tools) $('sheetTools').append(...tools);
  $('sheetBody').append(...[].concat(body));
  $('sheet').hidden = $('sheetBg').hidden = false;
}
function closeSheet() { $('sheet').hidden = $('sheetBg').hidden = true; }
$('sheetClose').onclick = $('sheetBg').onclick = closeSheet;
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

// Giới thiệu + giấy phép GPLv3 (bắt buộc khi phát hành vì app dùng LibreDWG).
// NGUON_URL: kho mã nguồn công khai của app; điền khi đã tạo kho GitHub, trước khi build bản Google Play.
const PHIEN_BAN = '1.0', NGUON_URL = 'https://github.com/anhtuandl101-lab/tc-dwg';
function moGioiThieu() {
  const nguon = NGUON_URL ? `<a href="${NGUON_URL}" style="color:var(--accent);word-break:break-all">${NGUON_URL}</a>` : '(đang cập nhật)';
  const b = el('div', null, `
    <p><b>TC DWG ${PHIEN_BAN}</b>: xem bản vẽ DWG, DXF trên điện thoại. Phát triển bởi C.S.O, Đà Nẵng.</p>
    <p>App là phần mềm tự do theo <b>Giấy phép Công cộng GNU phiên bản 3 (GPLv3) hoặc mới hơn</b>. Anh chị được dùng, sao chép, sửa đổi và phát hành lại theo điều kiện của giấy phép. App được cung cấp <b>không kèm bất kỳ bảo đảm nào</b>.</p>
    <p>Mã nguồn đầy đủ (gồm phần LibreDWG đã sửa): ${nguon}</p>
    <p><b>Thư viện dùng trong app</b><br>
    • LibreDWG (GNU, GPLv3+), bản đóng gói libredwg-web của mlightcad (GPL-3.0). C.S.O đã sửa: thu gọn bộ nhớ khi đọc, sửa lỗi đọc DWG R2004, chuỗi văn bản, tăng ngăn xếp.<br>
    • Capacitor (MIT).</p>
    <p>DWG là định dạng tệp của AutoCAD. AutoCAD là nhãn hiệu của Autodesk, Inc.; app không liên kết với Autodesk.</p>`);
  const gp = el('button', 'chip', 'Xem toàn văn giấy phép');
  gp.onclick = async () => {
    try { const t = await (await fetch('COPYING.txt')).text(); const p = el('pre'); p.style.cssText = 'white-space:pre-wrap;font-size:11px;user-select:text'; p.textContent = t; gp.replaceWith(p); }
    catch (e) { toast('Không đọc được tệp giấy phép'); }
  };
  b.append(gp);
  openSheet('Giới thiệu', b);
}
$('btnGioiThieu').onclick = e => { e.preventDefault(); moGioiThieu(); };

// Layer
function moLayer() {
  const list = el('div');
  const luu = () => { const o = {}; doc.layers.forEach(L => (o[L.name] = L.on)); store.set('lyr:' + docKey, o); veLai(); };
  const rows = [];
  doc.layers.map((L, i) => ({ L, i })).filter(x => x.L.n > 0).sort((a, b) => a.L.name.localeCompare(b.L.name, 'vi')).forEach(({ L }) => {
    const r = el('div', 'lyr');
    r.innerHTML = '<span class="sq"></span><span class="nm"></span><span class="ct"></span><span class="tg"></span>';
    r.querySelector('.sq').style.background = mauHienThi(L.rgb, false);
    r.querySelector('.nm').textContent = L.name;
    r.querySelector('.ct').textContent = L.n.toLocaleString('vi-VN');
    const tg = r.querySelector('.tg'); tg.classList.toggle('on', L.on);
    r.onclick = () => { L.on = !L.on; tg.classList.toggle('on', L.on); luu(); };
    rows.push({ L, tg }); list.appendChild(r);
  });
  const all = on => () => { rows.forEach(x => { x.L.on = on; x.tg.classList.toggle('on', on); }); luu(); };
  const bOn = el('button', 'chip', 'Bật hết'), bOff = el('button', 'chip', 'Tắt hết');
  bOn.onclick = all(true); bOff.onclick = all(false);
  bOn.style.marginRight = '6px';
  openSheet('Layer (' + rows.length + ')', list, [bOn, bOff]);
}
$('btnLayer').onclick = () => doc && moLayer();

// Tùy chọn
function moTuyChon() {
  const body = [];
  const optNen = el('div', 'opt', '<div class="nm">Nền bản vẽ<small>Nền tối giống AutoCAD, nền trắng giống bản in</small></div>');
  const sNen = el('div', 'seg', '<button data-v="0">Tối</button><button data-v="1">Trắng</button>');
  const updNen = () => sNen.querySelectorAll('button').forEach(b => b.classList.toggle('on', (b.dataset.v === '1') === cfg.nenSang));
  sNen.onclick = e => { if (!e.target.dataset.v) return; cfg.nenSang = e.target.dataset.v === '1'; ve.nenSang = cfg.nenSang; store.set('cfg', cfg); updNen(); snapView = null; veLai(); };
  updNen(); optNen.appendChild(sNen); body.push(optNen);

  const optDv = el('div', 'opt', '<div class="nm">Đơn vị bản vẽ<small>Dùng để đổi kết quả đo ra mét. Tự động: theo file (' + ({ 4: 'mm', 5: 'cm', 6: 'm' }[doc.units] || 'không ghi, coi là mm') + ')</small></div>');
  const sDv = el('div', 'seg', '<button data-v="auto">Tự động</button><button data-v="mm">mm</button><button data-v="cm">cm</button><button data-v="m">m</button>');
  const updDv = () => sDv.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === cfg.donVi));
  sDv.onclick = e => { if (!e.target.dataset.v) return; cfg.donVi = e.target.dataset.v; store.set('cfg', cfg); updDv(); capNhatDo(); veLai(); };
  updDv(); optDv.appendChild(sDv); body.push(optDv);

  const optChu = el('div', 'opt', '<div class="nm">Hiện chữ<small>Tắt chữ để kéo, phóng nhanh hơn với bản vẽ nặng</small></div>');
  const tg = el('span', 'tg' + (ve.textOn ? ' on' : ''));
  optChu.onclick = () => { ve.textOn = !ve.textOn; tg.classList.toggle('on', ve.textOn); snapView = null; veLai(); };
  optChu.appendChild(tg); body.push(optChu);

  const optGhi = el('div', 'opt', '<div class="nm">Hiện ghi chú tay<small>Nét bút, khung, mũi tên, chữ anh vẽ lên bản vẽ (' + ghiChu.length + ' ghi chú)</small></div>');
  const tgG = el('span', 'tg' + (cfg.hienGhi !== false ? ' on' : ''));
  optGhi.onclick = () => { cfg.hienGhi = cfg.hienGhi === false; store.set('cfg', cfg); tgG.classList.toggle('on', cfg.hienGhi !== false); veLai(); };
  optGhi.appendChild(tgG); body.push(optGhi);

  const info = el('div', 'opt', '<div class="nm">Thông tin file<small></small></div>');
  const cnt = Object.entries(doc.boQua || {}).map(([k, n]) => k + ': ' + n).join(', ');
  info.querySelector('small').textContent = docName + ' · phiên bản ' + verName(doc.version) + ' · ' + doc.tong.toLocaleString('vi-VN') + ' đối tượng · ' + doc.layers.length + ' layer · ' + doc.layouts.length + ' layout' + (cnt ? ' · chưa hiển thị: ' + cnt : '');
  body.push(info);
  openSheet('Tùy chọn', body);
}
function verName(v) {
  if (/^DXF /.test(v)) return 'DXF ' + verName(v.slice(4));
  return ({ AC1012: 'R13', AC1014: 'R14', AC1015: '2000', AC1018: '2004', AC1021: '2007', AC1024: '2010', AC1027: '2013', AC1032: '2018' })[v] || v; }
$('btnMenu').onclick = () => doc && moTuyChon();

// ---------- xuất ảnh / PDF ----------
function moXuat() {
  let nenTrang = true, toanBo = false;
  const body = [];
  const o1 = el('div', 'opt', '<div class="nm">Nền<small>Nền trắng: chữ, nét màu trắng in thành đen</small></div>');
  const s1 = el('div', 'seg', '<button data-v="1" class="on">Trắng</button><button data-v="0">Như màn hình</button>');
  s1.onclick = e => { if (!e.target.dataset.v) return; nenTrang = e.target.dataset.v === '1'; s1.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === e.target)); };
  o1.appendChild(s1); body.push(o1);
  const o2 = el('div', 'opt', '<div class="nm">Phạm vi</div>');
  const s2 = el('div', 'seg', '<button data-v="0" class="on">Đang xem</button><button data-v="1">Toàn bộ</button>');
  s2.onclick = e => { if (!e.target.dataset.v) return; toanBo = e.target.dataset.v === '1'; s2.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === e.target)); };
  o2.appendChild(s2); body.push(o2);
  const mk = (ico, t, sub, fn) => { const b = el('button', 'act', '<span style="font-size:22px">' + ico + '</span><span class="nm">' + t + '<small>' + sub + '</small></span>'); b.onclick = fn; return b; };
  body.push(mk('🖼', 'Ảnh PNG', 'Gửi nhanh qua Zalo, Messenger', () => xuat('png', nenTrang, toanBo)));
  body.push(mk('📄', 'PDF khổ A3', 'Ảnh độ phân giải cao, kèm ghi chú và kết quả đo', () => xuat('pdf', nenTrang, toanBo)));
  openSheet('Xuất bản vẽ', body);
}
$('btnXuat').onclick = () => doc && moXuat();

function renderXuat(w, h, nenTrang, toanBo) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  let v = { ...view() };
  const kx = w / W, ky = h / H;
  if (toanBo) {
    const [x0, y0, x1, y1] = space().bboxXem || space().bbox;
    v = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, s: Math.min(w * 0.95 / (x1 - x0 || 1), h * 0.95 / (y1 - y0 || 1)) };
  } else v.s *= Math.min(kx, ky);
  const nenSang = nenTrang ? true : cfg.nenSang;
  const oldBg = cfg.nenSang; cfg.nenSang = nenSang;
  const d = Math.max(dpr, w / 1600);
  const M = veDay(x, w, h, v, nenSang, d);
  veLop(x, M, d);
  cfg.nenSang = oldBg;
  return c;
}
async function xuat(kind, nenTrang, toanBo) {
  closeSheet();
  busy(true, 'Đang tạo ' + kind.toUpperCase() + '...');
  await new Promise(r => setTimeout(r, 40));
  try {
    const t = new Date(), p2 = n => String(n).padStart(2, '0');
    const stamp = t.getFullYear() + p2(t.getMonth() + 1) + p2(t.getDate()) + '_' + p2(t.getHours()) + p2(t.getMinutes());
    const base = docName.replace(/\.(dwg|dxf)$/i, '') + (sp ? '_' + doc.layouts[sp - 1].name : '') + '_' + stamp;
    let blob, fname;
    if (kind === 'png') {
      const k = Math.min(2, 4096 / Math.max(W, H));
      const c = renderXuat(Math.round(W * k), Math.round(H * k), nenTrang, toanBo);
      blob = await new Promise(r => c.toBlob(r, 'image/png'));
      fname = safeName(base) + '.png';
    } else {
      const land = toanBo ? (space().bbox[2] - space().bbox[0]) >= (space().bbox[3] - space().bbox[1]) : W >= H;
      const [pw, ph] = land ? [1190.55, 841.89] : [841.89, 1190.55];
      const scale = 4960 / Math.max(pw, ph);                    // ~300 dpi trên A3
      const cw = Math.round(pw * scale), ch = Math.round(ph * scale);
      const c = renderXuat(cw, ch, nenTrang, toanBo);
      const jpg = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
      blob = new Blob([pdfTuJpeg(new Uint8Array(await jpg.arrayBuffer()), cw, ch, pw, ph)], { type: 'application/pdf' });
      fname = safeName(base) + '.pdf';
    }
    await chiaSe(blob, fname);
  } catch (e) { console.error(e); toast('Lỗi khi xuất: ' + e.message, 6000); }
  finally { busy(false); }
}

// PDF một trang chứa một ảnh JPEG
function pdfTuJpeg(jpg, iw, ih, pw, ph) {
  const enc = new TextEncoder(), parts = [], offs = [];
  let len = 0;
  const put = x => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
  const obj = (n, body, stream) => {
    offs[n] = len;
    put(n + ' 0 obj\n' + body);
    if (stream) { put('stream\n'); put(stream); put('\nendstream'); }
    put('\nendobj\n');
  };
  put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const m = 14, k = Math.min((pw - 2 * m) / iw, (ph - 2 * m) / ih), dw = iw * k, dh = ih * k;
  const cs = 'q ' + dw.toFixed(2) + ' 0 0 ' + dh.toFixed(2) + ' ' + ((pw - dw) / 2).toFixed(2) + ' ' + ((ph - dh) / 2).toFixed(2) + ' cm /Im0 Do Q';
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pw + ' ' + ph + '] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>');
  obj(4, '<< /Type /XObject /Subtype /Image /Width ' + iw + ' /Height ' + ih + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpg.length + ' >>\n', jpg);
  obj(5, '<< /Length ' + cs.length + ' >>\n', enc.encode(cs));
  const xref = len;
  let x = 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
  put(x + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
  const out = new Uint8Array(len); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function chiaSe(blob, fname) {
  if (isNative) {
    const sh = plugin('Share');
    const w = await FS.writeFile({ path: fname, data: ab2b64(await blob.arrayBuffer()), directory: 'CACHE' });
    try { await sh.share({ title: fname, files: [w.uri], dialogTitle: 'Gửi ' + fname }); }
    catch (e) { if (!/cancel/i.test(e.message || '')) throw e; }
    return;
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fname;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('Đã tải ' + fname);
}

// ---------- mở file từ app khác (Zalo, Quản lý file: "Mở bằng") ----------
async function moFileNgoai(info) {
  if (!info || !info.path) return;
  try {
    busy(true, 'Đang mở ' + (info.name || 'bản vẽ') + '...');
    const buf = await (await fetch(C.convertFileSrc('file://' + info.path))).arrayBuffer();
    moBuffer(buf, info.name || 'banve.dwg', { cache: info.path });
  } catch (e) { busy(false); toast('Không đọc được file được gửi sang: ' + e.message, 6000); }
}
if (isNative) {
  const MF = plugin('MoFile');
  try {
    MF.addListener('fileMo', moFileNgoai);
    MF.layFileCho().then(r => r && r.path && moFileNgoai(r)).catch(() => {});
  } catch (e) {}
  // nút Quay lại của Android
  try {
    plugin('App').addListener('backButton', () => {
      if (!$('ask').hidden) { $('askNo').click(); return; }
      if (!$('sheet').hidden) { closeSheet(); return; }
      if (mode !== 'xem') { setMode('xem'); return; }
      if (!$('viewer').hidden) { showHome(); return; }
      plugin('App').exitApp();
    });
  } catch (e) {}
}

window.addEventListener('resize', () => resize());
renderRecent();
window.TCDWG = { moBuffer, get doc() { return doc; }, view, veLai, ve, timDiemBat, toWorld };
