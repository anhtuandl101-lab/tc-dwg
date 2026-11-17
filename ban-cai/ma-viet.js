// Đổi chữ tiếng Việt mã cũ (TCVN3/ABC và VNI) sang Unicode.
// Bản vẽ cũ gõ bằng font .VnTime, .VnArial... (TCVN3) hoặc VNI-Times, VNI-Helve... (VNI)
// lưu chữ dưới dạng ký tự Latin-1, chỉ hiện đúng dấu khi máy có đúng font đó.

// ---- TCVN3 (ABC): mỗi byte là một chữ ----
const TCVN3 = {
  0xA1: 'Ă', 0xA2: 'Â', 0xA3: 'Ê', 0xA4: 'Ô', 0xA5: 'Ơ', 0xA6: 'Ư', 0xA7: 'Đ',
  0xA8: 'ă', 0xA9: 'â', 0xAA: 'ê', 0xAB: 'ô', 0xAC: 'ơ', 0xAD: 'ư', 0xAE: 'đ',
  0xB5: 'à', 0xB6: 'ả', 0xB7: 'ã', 0xB8: 'á', 0xB9: 'ạ',
  0xBB: 'ằ', 0xBC: 'ẳ', 0xBD: 'ẵ', 0xBE: 'ắ', 0xC6: 'ặ',
  0xC7: 'ầ', 0xC8: 'ẩ', 0xC9: 'ẫ', 0xCA: 'ấ', 0xCB: 'ậ',
  0xCC: 'è', 0xCE: 'ẻ', 0xCF: 'ẽ', 0xD0: 'é', 0xD1: 'ẹ',
  0xD2: 'ề', 0xD3: 'ể', 0xD4: 'ễ', 0xD5: 'ế', 0xD6: 'ệ',
  0xD7: 'ì', 0xD8: 'ỉ', 0xDC: 'ĩ', 0xDD: 'í', 0xDE: 'ị',
  0xDF: 'ò', 0xE1: 'ỏ', 0xE2: 'õ', 0xE3: 'ó', 0xE4: 'ọ',
  0xE5: 'ồ', 0xE6: 'ổ', 0xE7: 'ỗ', 0xE8: 'ố', 0xE9: 'ộ',
  0xEA: 'ờ', 0xEB: 'ở', 0xEC: 'ỡ', 0xED: 'ớ', 0xEE: 'ợ',
  0xEF: 'ù', 0xF1: 'ủ', 0xF2: 'ũ', 0xF3: 'ú', 0xF4: 'ụ',
  0xF5: 'ừ', 0xF6: 'ử', 0xF7: 'ữ', 0xF8: 'ứ', 0xF9: 'ự',
  0xFA: 'ỳ', 0xFB: 'ỷ', 0xFC: 'ỹ', 0xFD: 'ý', 0xFE: 'ỵ',
};

// ---- VNI: chữ gốc + ký tự dấu đứng sau ----
const VNI_DON = { // ký tự đứng một mình
  'ô': 'ơ', 'Ô': 'Ơ', 'ö': 'ư', 'Ö': 'Ư', 'ñ': 'đ', 'Ñ': 'Đ',
  'æ': 'ỉ', 'Æ': 'Ỉ', 'ó': 'ĩ', 'Ó': 'Ĩ', 'ò': 'ị', 'Ò': 'Ị', 'î': 'ỵ', 'Î': 'Ỵ',
};
const DAU_THANH = { 'ù': '́', 'ø': '̀', 'û': '̉', 'õ': '̃', 'ï': '̣' };
const DAU_MU = { 'â': '̂', 'á': '̂́', 'à': '̂̀', 'å': '̂̉', 'ã': '̂̃', 'ä': '̣̂' };
const DAU_TRANG = { 'ê': '̆', 'é': '̆́', 'è': '̆̀', 'ú': '̆̉', 'ü': '̆̃', 'ë': '̣̆' };

function vni(s) {
  let o = '';
  for (let i = 0; i < s.length; i++) {
    let c = s[i];
    const base = VNI_DON[c] || c;
    const b = base.toLowerCase();
    const n = s[i + 1], nl = n ? n.toLowerCase() : '';
    let dau = null;
    if (n !== undefined) {
      if ('aeo'.includes(b) && DAU_MU[nl]) dau = DAU_MU[nl];
      else if (b === 'a' && DAU_TRANG[nl]) dau = DAU_TRANG[nl];
      else if ('aeouyiơư'.includes(b) && DAU_THANH[nl]) dau = DAU_THANH[nl];
    }
    if (dau) { o += (base + dau).normalize('NFC'); i++; }
    else o += base;
  }
  return o;
}

// Chữ có thể đã bị đọc theo bảng mã Windows-1252/1258: trả về đúng byte gốc trước khi tra bảng.
const VE_BYTE = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89,
  'Š': 0x8A, '‹': 0x8B, 'Œ': 0x8C, 'Ž': 0x8E, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95,
  '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9A, '›': 0x9B, 'œ': 0x9C, 'ž': 0x9E, 'Ÿ': 0x9F,
  // riêng của 1258
  'Ă': 0xC3, '̀': 0xCC, 'Đ': 0xD0, '̉': 0xD2, 'Ơ': 0xD5, 'Ư': 0xDD, '̃': 0xDE,
  'ă': 0xE3, '́': 0xEC, 'đ': 0xF0, '̣': 0xF2, 'ơ': 0xF5, 'ư': 0xFD, '₫': 0xFE,
};
const veByte = s => s.replace(/[^\x00-\xff]/g, c => (c in VE_BYTE ? String.fromCharCode(VE_BYTE[c]) : c));

// Nhận biết bảng mã từ tên font: trả về null | 'tcvn3' | 'tcvn3H' (font chữ hoa) | 'vni'
export function kieuMa(font) {
  let f = String(font || '').trim().toLowerCase();
  f = f.split(/[\\/]/).pop().replace(/\.(ttf|shx|otf|fon)$/, '');
  if (/^vni[-_ ]?/.test(f)) return 'vni';
  if (/^\.?vn/.test(f)) return /h$/.test(f) ? 'tcvn3H' : 'tcvn3';
  return null;
}

// Đoán bảng mã theo nội dung khi tên font không cho biết (font Việt có rất nhiều tên khác nhau).
// Chỉ dựa vào dấu hiệu không bao giờ có trong chữ Unicode tiếng Việt, để không đổi nhầm "HOÀN THÀNH", "hoá", "Ø16"...
const TCVN3_RIENG = /[¡¢£¤¥¦§¨ª¬­µ¶¸¹ÇÐÞßç÷þ]/;    // chữ TCVN3 không có trong VNI hay Unicode tiếng Việt (à á ạ ả ă ê ơ ư đ Đ ầ é ị ò ỗ ữ ỵ ...)
const TCVN3_PHU = /[©®«·»¼½¾]/g;                        // cũng là chữ TCVN3 nhưng hay gặp như ký hiệu: cần từ 2 cái
const VNI_RIENG = new RegExp([
  '[ñÑ]',                                                // đ, Đ
  '[aAeE][âÂáÁàÀãÃäÄåÅ]', '[oO][âÂãÃäÄåÅ]',              // dấu mũ (+thanh) đứng sau chữ gốc
  '[aA][êÊéÉèÈúÚüÜëË]',                                  // dấu trăng (+thanh)
  '[aAeEiIoOuUyYôÔöÖ][øØûÛïÏ]',                          // dấu huyền, hỏi, nặng đứng sau nguyên âm
  '[öÖ]',                                                // ư
].join('|'));
const UNICODE_VIET = /[ĂăĐđƠơƯưẠ-ỹ]/;

export function doanMa(s) {
  if (!s || !/[¡-ÿ]/.test(s) || UNICODE_VIET.test(s)) return null;
  if (TCVN3_RIENG.test(s) || (s.match(TCVN3_PHU) || []).length >= 2) return 'tcvn3';
  if (VNI_RIENG.test(s)) return 'vni';
  return null;
}

// Đổi một chuỗi theo bảng mã ('tcvn3' | 'tcvn3H' | 'vni' | 'auto' = đoán theo nội dung).
// Chuỗi đã là Unicode (có chữ tiếng Việt dựng sẵn) thì giữ nguyên.
export function giaiMa(s, kieu) {
  if (!s) return s;
  if (kieu === 'auto' || !kieu) kieu = doanMa(s);
  if (!kieu) return s;
  if (/[Ạ-ỹ]/.test(s)) return s;
  const raw = veByte(s);
  if (kieu === 'vni') return vni(raw);
  let o = '';
  for (const ch of raw) { const k = ch.charCodeAt(0); o += TCVN3[k] || ch; }
  return kieu === 'tcvn3H' ? o.toLocaleUpperCase('vi') : o;
}
