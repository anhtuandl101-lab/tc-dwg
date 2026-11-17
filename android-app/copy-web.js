// Chép bản web ../ban-cai sang www/ (cả thư mục con lib/, wasm/).
const fs = require('fs'), path = require('path');
const src = path.join(__dirname, '..', 'ban-cai'), dst = path.join(__dirname, 'www');
function copyDir(a, b) {
  fs.mkdirSync(b, { recursive: true });
  for (const f of fs.readdirSync(a, { withFileTypes: true })) {
    const pa = path.join(a, f.name), pb = path.join(b, f.name);
    if (f.isDirectory()) copyDir(pa, pb); else fs.copyFileSync(pa, pb);
  }
}
copyDir(src, dst);
console.log('Da chep web vao www/');
