// Luồng nền: đọc DWG bằng LibreDWG (WebAssembly) hoặc DXF bằng bộ đọc riêng, rồi chuyển thành dữ liệu vẽ.
import { LibreDwg, Dwg_File_Type } from './lib/libredwg-web.js';
import { chuyenDoi } from './chuyen-doi.js';
import { docDxf, laDxf } from './dxf.js';

let ld = null;
const bao = msg => postMessage({ tienDo: msg });

onmessage = async ev => {
  let { buf } = ev.data;
  try {
    const head = new TextDecoder('latin1').decode(new Uint8Array(buf, 0, Math.min(6, buf.byteLength)));
    const t0 = Date.now();
    let db, version, r;
    if (/^AC10\d\d/.test(head)) {
      if (!ld) { bao('Đang nạp bộ đọc DWG...'); ld = await LibreDwg.create(new URL('./wasm', import.meta.url).href); }
      const mb = (buf.byteLength / 1048576).toFixed(1);
      bao('Đang đọc file DWG (' + mb + ' MB)...');
      let dwg = ld.dwg_read_data(buf, Dwg_File_Type.DWG);
      buf = null; ev = null;                      // bản gốc đã nằm trong WASM, bỏ bản JS cho nhẹ bộ nhớ
      if (!dwg) throw new Error('LibreDWG không đọc được file này.');
      // giải mã hỏng hoàn toàn (không ra đối tượng nào): báo rõ thay vì mở ra màn hình trống
      if (!ld.dwg_get_num_objects(dwg)) {
        try { ld.dwg_free(dwg); } catch (e) {}
        throw new Error('Bộ đọc không giải mã được file DWG này (' + head + ', ' + mb + ' MB). Anh thử lưu lại file trong AutoCAD (SAVEAS bản 2013 hoặc 2018) rồi mở lại.');
      }
      try {
        bao('Đang giải mã bảng, block...');
        // chế độ rút gọn: chỉ lấy trường cần vẽ, Model đọc dần từng đối tượng trong lúc dựng hình
        db = ld.convert(dwg, true);
        r = chuyenDoi(db, bao);
      } finally { db = null; try { ld.dwg_free(dwg); } catch (e) {} dwg = null; }
      version = head;
    } else {
      const k = laDxf(buf);
      if (k === 'nhiphan') throw new Error('Đây là DXF dạng nhị phân, app chưa đọc được. Anh lưu lại DXF dạng văn bản (ASCII) trong AutoCAD.');
      if (!k) throw new Error('File không phải DWG hay DXF (mã đầu file: ' + head.replace(/[^\x20-\x7e]/g, '?') + ').');
      bao('Đang đọc file DXF (' + (buf.byteLength / 1048576).toFixed(1) + ' MB)...');
      db = docDxf(buf);
      buf = null; ev = null;
      version = 'DXF ' + (db.version || 'R12');
      r = chuyenDoi(db, bao);
      db = null;
    }
    r.version = version;
    r.ms = Date.now() - t0;
    const bufs = r.buffers; delete r.buffers;
    postMessage({ xong: r }, bufs);
  } catch (e) {
    ld = null; // nạp lại module ở lần sau (phòng hết bộ nhớ WASM)
    postMessage({ loi: String(e && e.message || e) });
  }
};
