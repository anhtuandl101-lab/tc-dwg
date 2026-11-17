// Vẽ dữ liệu bản vẽ lên canvas 2D. Hệ tọa độ: M = [a b c d e f] đổi tọa độ bản vẽ -> điểm ảnh.

const hex = rgb => '#' + (rgb & 0xffffff).toString(16).padStart(6, '0');

export function mauHienThi(rgb, nenSang) {
  rgb &= 0xffffff;
  if (nenSang) {
    if (rgb === 0xffffff) return '#000000';
    // làm tối màu quá sáng (vàng, cyan...) để đọc được trên nền trắng
    const r = rgb >> 16, g = (rgb >> 8) & 255, b = rgb & 255;
    const L = 0.299 * r + 0.587 * g + 0.114 * b;
    if (L > 170) { const k = 150 / L; return hex((Math.round(r * k) << 16) | (Math.round(g * k) << 8) | Math.round(b * k)); }
    return hex(rgb);
  }
  if (rgb === 0) return '#ffffff';
  return hex(rgb);
}

// Gốc tọa độ riêng của mỗi không gian (tâm khung bản vẽ). Canvas lưu điểm Path2D bằng số thực 32 bit:
// tọa độ cỡ 9e8 (bản vẽ đặt xa gốc) sai tới 64 đơn vị → nét nhòe thành vệt trên điện thoại.
// Mọi điểm đưa vào canvas đều trừ gốc này, ma trận cộng bù lại (tính bằng số thực 64 bit của JS).
export function gocKhong(sp) {
  if (!sp.goc) {
    const b = sp.bbox || [0, 0, 0, 0];
    const gx = Math.round((b[0] + b[2]) / 2), gy = Math.round((b[1] + b[3]) / 2);
    sp.goc = [Number.isFinite(gx) ? gx : 0, Number.isFinite(gy) ? gy : 0];
  }
  return sp.goc;
}
export const dichMaTran = (M, g) => [M[0], M[1], M[2], M[3], M[4] + M[0] * g[0] + M[2] * g[1], M[5] + M[1] * g[0] + M[3] * g[1]];

function pathLines(d, g) {
  const p = new Path2D(), gx = g[0], gy = g[1];
  for (let i = 0; i < d.length;) {
    const n = d[i++];
    p.moveTo(d[i] - gx, d[i + 1] - gy);
    for (let k = 1; k < n; k++) p.lineTo(d[i + 2 * k] - gx, d[i + 2 * k + 1] - gy);
    i += 2 * n;
  }
  return p;
}
function pathRings(d, g) {
  const p = new Path2D(), gx = g[0], gy = g[1];
  for (let i = 0; i < d.length;) {
    const nr = d[i++];
    for (let r = 0; r < nr; r++) {
      const n = d[i++];
      p.moveTo(d[i] - gx, d[i + 1] - gy);
      for (let k = 1; k < n; k++) p.lineTo(d[i + 2 * k] - gx, d[i + 2 * k + 1] - gy);
      p.closePath();
      i += 2 * n;
    }
  }
  return p;
}
function pathRingsOne(d, g) { // một hatch: [nRings, n, pts...]
  const p = new Path2D(), gx = g[0], gy = g[1];
  let i = 0; const nr = d[i++];
  for (let r = 0; r < nr; r++) {
    const n = d[i++];
    p.moveTo(d[i] - gx, d[i + 1] - gy);
    for (let k = 1; k < n; k++) p.lineTo(d[i + 2 * k] - gx, d[i + 2 * k + 1] - gy);
    p.closePath(); i += 2 * n;
  }
  return p;
}

// Nét đứt kiểu AutoCAD (dương: nét, âm: khoảng, 0: chấm) -> mảng xen kẽ cho setLineDash
function dashAcad(arr, k, px) {
  const out = [];
  for (const v of arr) {
    const isDash = v >= 0, len = Math.max(Math.abs(v) * k, isDash && v === 0 ? px : 0);
    const want = out.length % 2 === 0;
    if (isDash === want) out.push(len); else if (out.length) out[out.length - 1] += len; else out.push(0, len);
  }
  if (out.length % 2) out.push(0);
  return out;
}

// Đường nét giản lược theo mức chi tiết: bỏ đỉnh gần nhau hơn tol, bỏ hẳn hình nhỏ hơn tol.
// Mức được làm tròn theo lũy thừa 2 để dùng lại bộ nhớ đệm khi phóng to/thu nhỏ.
function pathLod(c, px, g) {
  const key = Math.floor(Math.log2(px * 1.5));
  const tol = Math.pow(2, key);
  if (!c.lod) c.lod = {};
  let e = c.lod[key];
  if (e === undefined) {
    const d = c.d, p = new Path2D();
    let kept = 0, total = 0;
    for (let i = 0; i < d.length;) {
      const n = d[i++], x0 = d[i], y0 = d[i + 1];
      total += n;
      let big = false;
      for (let k = 1; k < n; k++) if (Math.abs(d[i + 2 * k] - x0) > tol || Math.abs(d[i + 2 * k + 1] - y0) > tol) { big = true; break; }
      if (big) {
        p.moveTo(x0 - g[0], y0 - g[1]); kept++;
        let lx = x0, ly = y0;
        for (let k = 1; k < n; k++) {
          const x = d[i + 2 * k], y = d[i + 2 * k + 1];
          if (k === n - 1 || Math.abs(x - lx) > tol || Math.abs(y - ly) > tol) { p.lineTo(x - g[0], y - g[1]); lx = x; ly = y; kept++; }
        }
      }
      i += 2 * n;
    }
    e = kept > total * 0.75 ? null : p;          // giản lược không đáng kể thì dùng bản đầy đủ
    // chỉ giữ 2 mức gần nhất cho mỗi khối (file nặng: giữ hết các mức làm tràn bộ nhớ điện thoại)
    const ks = Object.keys(c.lod);
    if (ks.length >= 2) {
      let xa = ks[0];
      for (const k of ks) if (Math.abs(k - key) > Math.abs(xa - key)) xa = k;
      delete c.lod[xa];
    }
    c.lod[key] = e;
  }
  return e || c.p || (c.p = pathLines(c.d, g));
}

const giao = (c, v) => !(c.x1 < v[0] || c.x0 > v[2] || c.y1 < v[1] || c.y0 > v[3]);

export class Ve {
  constructor() { this.nenSang = false; this.layers = []; this.textOn = true; }

  // vẽ một không gian (model hoặc layout) với ma trận M; vis = khung nhìn [x0,y0,x1,y1] theo tọa độ bản vẽ.
  // Hình thuộc block bị XCLIP nằm trong sp.clips, mỗi thùng vẽ trong vùng cắt của nó.
  veKhong(ctx, sp, M, vis, dpr) {
    this.veNoiDung(ctx, sp, M, vis, dpr);
    for (const k of (sp.clips || [])) {
      ctx.save();
      const g = gocKhong(sp), Mg = dichMaTran(M, g);
      ctx.setTransform(Mg[0], Mg[1], Mg[2], Mg[3], Mg[4], Mg[5]);
      for (const poly of k.clip) {
        ctx.beginPath();
        for (let i = 0; i < poly.length; i += 2) (i ? ctx.lineTo(poly[i] - g[0], poly[i + 1] - g[1]) : ctx.moveTo(poly[i] - g[0], poly[i + 1] - g[1]));
        ctx.closePath();
        ctx.clip();
      }
      this.veNoiDung(ctx, k, M, vis, dpr);
      ctx.restore();
    }
  }

  veNoiDung(ctx, sp, M, vis, dpr) {
    const s = Math.hypot(M[0], M[1]);
    const L = this.layers;
    const px = 1 / s;                       // 1 điểm ảnh theo đơn vị bản vẽ
    const hair = Math.max(1, dpr * 0.8) * px;
    const goc = gocKhong(sp), Mg = dichMaTran(M, goc);   // không đặt tên g: trùng biến nhóm nét trong vòng lặp dưới
    ctx.save();
    ctx.setTransform(Mg[0], Mg[1], Mg[2], Mg[3], Mg[4], Mg[5]);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';

    // 1. hatch mẫu
    for (const h of sp.hatches) {
      if (!L[h.layer]?.on || !giao(h, vis)) continue;
      const sz = Math.max(h.x1 - h.x0, h.y1 - h.y0) * s;
      if (sz < 2) continue;
      const col = mauHienThi(h.rgb, this.nenSang);
      if (!h.p) h.p = pathRingsOne(h.rings, goc);
      ctx.save();
      ctx.clip(h.p, 'evenodd');
      ctx.strokeStyle = col; ctx.lineWidth = hair;
      const bb = [Math.max(h.x0, vis[0]), Math.max(h.y0, vis[1]), Math.min(h.x1, vis[2]), Math.min(h.y1, vis[3])];
      let tong = 0;
      for (const f of h.fam) {
        const nx = -f.dy, ny = f.dx;
        const per = f.ox * nx + f.oy * ny;              // khoảng cách giữa hai đường
        if (!(Math.abs(per) > 0)) continue;
        if (Math.abs(per) * s < 2.5 * dpr) {            // quá dày: tô mờ thay cho kẻ đường
          ctx.globalAlpha = 0.35; ctx.fillStyle = col; ctx.fill(h.p, 'evenodd'); ctx.globalAlpha = 1; break;
        }
        const cs = [[bb[0], bb[1]], [bb[2], bb[1]], [bb[0], bb[3]], [bb[2], bb[3]]];
        const pn = cs.map(c => (c[0] - f.bx) * nx + (c[1] - f.by) * ny);
        let k0 = Math.floor(Math.min(...pn) / per), k1 = Math.ceil(Math.max(...pn) / per);
        if (k0 > k1) { const t = k0; k0 = k1; k1 = t; }
        if (k1 - k0 > 3000) continue;
        const dash = f.dash && f.dash.length ? dashAcad(f.dash, 1, px) : null;
        const per2 = dash ? dash.reduce((a, b) => a + b, 0) : 0;
        // chu kỳ nét đứt quá nhỏ để vẽ đứt: vẽ liền nhưng mờ theo tỉ lệ phần mực (mẫu chấm/cát không thành sọc đậm)
        let mo = 1;
        if (dash && per2 * s > 3) ctx.setLineDash(dash);
        else {
          ctx.setLineDash([]);
          if (dash && per2 > 0) { let muc = 0; for (let i = 0; i < dash.length; i += 2) muc += dash[i]; mo = Math.min(1, Math.max(0.12, muc / per2)); }
        }
        ctx.globalAlpha = mo;
        const p = new Path2D();
        for (let k = k0; k <= k1; k++) {
          const ox = f.bx + k * f.ox, oy = f.by + k * f.oy;
          const pt = cs.map(c => (c[0] - ox) * f.dx + (c[1] - oy) * f.dy);
          let t0 = Math.min(...pt), t1 = Math.max(...pt);
          if (per2 > 0) t0 = Math.floor(t0 / per2) * per2;
          p.moveTo(ox + f.dx * t0 - goc[0], oy + f.dy * t0 - goc[1]); p.lineTo(ox + f.dx * t1 - goc[0], oy + f.dy * t1 - goc[1]);
          tong++;
        }
        ctx.stroke(p);
        if (tong > 20000) break;
      }
      ctx.setLineDash([]);
      ctx.restore();
    }

    // 2. vùng tô đặc
    for (const g of sp.groups) {
      if (g.kind !== 'F' || !L[g.layer]?.on) continue;
      ctx.fillStyle = mauHienThi(g.rgb, this.nenSang);
      for (const c of g.chunks) {
        if (!giao(c, vis)) continue;
        if (!c.p) c.p = pathRings(c.d, goc);
        ctx.fill(c.p, 'evenodd');
      }
    }

    // 3. đường nét
    for (const g of sp.groups) {
      if (g.kind !== 'L' || !L[g.layer]?.on) continue;
      ctx.strokeStyle = mauHienThi(g.rgb, this.nenSang);
      ctx.lineWidth = Math.max(hair, g.w || 0);
      let dash = null;
      if (g.lt && this.ltypes[g.lt]) {
        const d = dashAcad(this.ltypes[g.lt], g.lts, px);
        const tot = d.reduce((a, b) => a + b, 0);
        // nét đứt vẫn vẽ đứt khi nhỏ (như AutoCAD, DWG FastView); chỉ vẽ liền khi cả chu kỳ dưới ~2,5 điểm ảnh
        if (tot * s >= 2.5 * dpr) dash = d;
      }
      ctx.setLineDash(dash || []);
      for (const c of g.chunks) {
        if (!giao(c, vis)) continue;
        if ((c.x1 - c.x0) * s < 1 && (c.y1 - c.y0) * s < 1) continue;   // cả khối nhỏ hơn 1 điểm ảnh
        ctx.stroke(pathLod(c, px, goc));
      }
    }
    ctx.setLineDash([]);
    ctx.restore();

    // 4. chữ (vẽ theo điểm ảnh màn hình)
    if (this.textOn) this.veChu(ctx, sp, M, vis, s, dpr);
  }

  veChu(ctx, sp, M, vis, s, dpr) {
    const L = this.layers;
    ctx.save();
    for (const t of sp.texts) {
      if (!L[t.layer]?.on) continue;
      const cap = t.h * s;
      if (cap < 1.6 * dpr) continue;
      // bán kính vùng chữ quanh điểm neo (để bỏ qua chữ nằm ngoài màn hình); MTEXT tính theo khung và bề rộng thật
      const r = t.ml
        ? Math.max(t.w || 0, t.ew || 0, t.h * Math.min(t.s.length, 200) * 0.6) + t.h * 2 * ((t.lines ? t.lines.length : t.s.split('\n').length) + 1)
        : t.h * (2 + t.s.length * 0.8 * t.wf);
      if (t.x + r < vis[0] || t.x - r > vis[2] || t.y + r < vis[1] || t.y - r > vis[3]) continue;
      if (cap > 4000) continue;
      const X = M[0] * t.x + M[2] * t.y + M[4], Y = M[1] * t.x + M[3] * t.y + M[5];
      const ang = Math.atan2(M[1] * Math.cos(t.r) + M[3] * Math.sin(t.r), M[0] * Math.cos(t.r) + M[2] * Math.sin(t.r));
      const fpx = cap / 0.72;
      ctx.font = fpx.toFixed(1) + 'px ' + (t.font || 'sans-serif');
      ctx.fillStyle = mauHienThi(t.rgb, this.nenSang);
      ctx.textAlign = t.ha; ctx.textBaseline = 'alphabetic';
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.translate(X, Y); ctx.rotate(ang);
      if (t.flip) ctx.scale(-1, 1);            // chữ bị mirror trong block
      if (t.ml && !t.lines) this.chuanBiMtext(ctx, t, fpx, s);
      ctx.scale(t.ml ? t.kx : (t.wf || 1), 1);
      if (t.ml) {
        const step = cap * (t.ls || 1.667), n = t.lines.length, tot = cap + (n - 1) * step;
        let y0 = t.va === 'top' ? cap : t.va === 'middle' ? cap - tot / 2 : -(n - 1) * step;
        for (let i = 0; i < n; i++) ctx.fillText(t.lines[i], 0, y0 + i * step);
      } else {
        const dy = t.va === 'top' ? cap : t.va === 'middle' ? cap / 2 : t.va === 'bottom' ? -0.3 * cap : 0;
        ctx.fillText(t.s, 0, dy);
      }
    }
    ctx.restore();
  }

  // MTEXT: ngắt dòng theo khung, rồi co giãn ngang cho bằng bề rộng thật AutoCAD đã vẽ (extentsWidth).
  // Font điện thoại thường rộng hơn font SHX/font hẹp của AutoCAD, không co lại thì chữ tràn khung.
  chuanBiMtext(ctx, t, fpx, s) {
    let k = t.wf || 1;
    t.lines = this.ngatDong(ctx, t, fpx, k);
    if (t.ew > 0) {
      // bề rộng theo phần mực (extentsWidth của AutoCAD là khung mực chữ, không gồm khoảng chừa hai bên ký tự).
      // Đo theo bề rộng bước chữ thì chữ bị co ~20%, chữ cắt rời từng mảnh lộ khe hở ("CH ỈNG" thay vì "CHỈ NG").
      const rong = lines => Math.max(...lines.map(l => {
        const m = ctx.measureText(l);
        const r = m.actualBoundingBoxRight, lf = m.actualBoundingBoxLeft;
        const muc = Number.isFinite(r) ? r + Math.max(0, lf || 0) : 0;
        return muc > 0 ? muc : m.width;
      }));
      const dich = t.ew * s;                        // bề rộng đích theo điểm ảnh
      let nat = rong(t.lines), k2 = nat > 0 ? dich / nat : 0;
      if (k2 > 0.3 && k2 < 2) {
        if (t.w > 0 && k2 < k * 0.97) {             // chữ sẽ co lại: ngắt dòng lại theo cỡ đã co cho giống AutoCAD
          const l2 = this.ngatDong(ctx, t, fpx, k2), n2 = rong(l2), k3 = n2 > 0 ? dich / n2 : 0;
          if (k3 > 0.3 && k3 < 2) { t.lines = l2; k2 = k3; }
        }
        k = Math.min(k2, 1.6);
      }
    }
    t.kx = k;
  }

  ngatDong(ctx, t, fpx, k = t.wf || 1) {
    const raw = t.s.split('\n');
    if (!(t.w > 0)) return raw;
    const lim = t.w / t.h * 0.72 * fpx / k * 1.02;  // bề rộng khung theo điểm ảnh của cỡ chữ hiện tại
    const out = [];
    for (const line of raw) {
      // dòng vừa khung thì giữ nguyên (kể cả dấu cách đầu dòng: chữ cắt mảnh như " NG" cần khoảng trống đó)
      if (ctx.measureText(line).width <= lim) { out.push(line); continue; }
      const words = line.split(' ');
      let cur = '';
      for (const w of words) {
        const tryS = cur ? cur + ' ' + w : w;
        if (cur && ctx.measureText(tryS).width > lim) { out.push(cur); cur = w; } else cur = tryS;
      }
      out.push(cur);
    }
    return out;
  }

  // vẽ một layout: giấy + các viewport (nội dung Model) + đối tượng của layout
  veLayout(ctx, lay, model, M, vis, dpr, W, H) {
    const sp = lay.space;
    for (const v of sp.vps) {
      const x0 = v.cx - v.w / 2, y0 = v.cy - v.h / 2, x1 = x0 + v.w, y1 = y0 + v.h;
      if (x1 < vis[0] || x0 > vis[2] || y1 < vis[1] || y0 > vis[3]) continue;
      // model -> giấy: p = c + (X - v) * k (bỏ qua xoay twist)
      const Mv = [M[0] * v.k, M[1] * v.k, M[2] * v.k, M[3] * v.k,
        M[0] * (v.cx - v.vx * v.k) + M[2] * (v.cy - v.vy * v.k) + M[4],
        M[1] * (v.cx - v.vx * v.k) + M[3] * (v.cy - v.vy * v.k) + M[5]];
      const cx0 = Math.max(x0, vis[0]), cy0 = Math.max(y0, vis[1]), cx1 = Math.min(x1, vis[2]), cy1 = Math.min(y1, vis[3]);
      const visM = [v.vx + (cx0 - v.cx) / v.k, v.vy + (cy0 - v.cy) / v.k, v.vx + (cx1 - v.cx) / v.k, v.vy + (cy1 - v.cy) / v.k];
      ctx.save();
      const g = gocKhong(sp), Mg = dichMaTran(M, g);
      ctx.setTransform(Mg[0], Mg[1], Mg[2], Mg[3], Mg[4], Mg[5]);
      ctx.beginPath(); ctx.rect(x0 - g[0], y0 - g[1], v.w, v.h); ctx.clip();
      this.veKhong(ctx, model, Mv, visM, dpr);
      ctx.restore();
    }
    this.veKhong(ctx, sp, M, vis, dpr);
  }
}
