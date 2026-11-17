# Tạo icon app TC DWG cho Android và bản web: chữ "CAD" nổi lên trên, mặt bằng căn phòng chìm phía sau.
# Chạy: python -I tao-icon.py            -> ghi vào android/app/src/main/res và ../ban-cai
#       python -I tao-icon.py --xem DIR  -> chỉ xuất ảnh xem trước vào DIR
import sys, os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

NEN = (11, 122, 117)        # xanh ngọc
TRANG = (88, 166, 161)      # tường: chìm vào nền (khoảng 30% trắng)
NHAT = (58, 148, 143)       # nét phụ: cung cửa, kích thước (chìm hơn)
CHU = (255, 255, 255)       # chữ CAD
BONG = (0, 52, 49)          # bóng đổ của chữ
FONT_CHU = ['C:/Windows/Fonts/seguibl.ttf', 'C:/Windows/Fonts/ariblk.ttf', 'C:/Windows/Fonts/arialbd.ttf']
SS = 4                      # vẽ to gấp 4 rồi thu nhỏ cho mịn


def ve_chu(im, rong, k):
    """Chữ CAD đậm, to, ở giữa icon (rong = bề rộng chữ theo điểm ảnh), có bóng đổ mềm cho nổi lên."""
    S = im.size[0]
    font_path = next(p for p in FONT_CHU if os.path.exists(p))
    f = ImageFont.truetype(font_path, 100)
    l, t, r, b = ImageDraw.Draw(im).textbbox((0, 0), 'CAD', font=f)
    f = ImageFont.truetype(font_path, max(8, round(100 * rong / (r - l))))
    l, t, r, b = ImageDraw.Draw(im).textbbox((0, 0), 'CAD', font=f)
    x = S / 2 - (r + l) / 2
    y = S * 0.53 - (b + t) / 2                      # hơi thấp hơn tâm, cân với đường kích thước phía trên
    bong = Image.new('RGBA', im.size, (0, 0, 0, 0))
    ImageDraw.Draw(bong).text((x + 1.2 * k, y + 2.4 * k), 'CAD', font=f, fill=BONG + (200,))
    bong = bong.filter(ImageFilter.GaussianBlur(2.2 * k))
    im.alpha_composite(bong)
    ImageDraw.Draw(im).text((x, y), 'CAD', font=f, fill=CHU + (255,))


def ve_hinh(d, ox, oy, k):
    """Vẽ hình trong ô 100x100 đơn vị, góc trên trái (ox, oy), k = điểm ảnh/đơn vị."""
    P = lambda x, y: (ox + x * k, oy + y * k)
    def net(pts, w, mau):
        d.line([P(*p) for p in pts], fill=mau, width=max(1, round(w * k)), joint='curve')
        for p in (pts[0], pts[-1]):                    # đầu nét tròn
            r = w * k / 2
            x, y = P(*p)
            d.ellipse([x - r, y - r, x + r, y + r], fill=mau)

    # đường kích thước phía trên
    net([(18, 13), (82, 13)], 2.6, NHAT)
    for x in (18, 82):
        net([(x, 8), (x, 20)], 2.6, NHAT)                 # đường gióng
        net([(x - 3.5, 16.5), (x + 3.5, 9.5)], 3.2, NHAT)  # vạch xiên

    # tường bao (chừa ô cửa ở tường dưới từ x=58 đến x=76)
    W = 7.5
    net([(58, 86), (18, 86), (18, 27), (82, 27), (82, 86), (76, 86)], W, TRANG)
    # tường ngăn
    net([(50, 27), (50, 54)], 5.5, TRANG)
    net([(18, 58), (36, 58)], 5.5, TRANG)

    # cửa đi: cánh + cung mở
    net([(58, 86), (58, 68)], 3.6, TRANG)
    cx, cy, r = 58, 86, 18
    x0, y0 = P(cx - r, cy - r); x1, y1 = P(cx + r, cy + r)
    d.arc([x0, y0, x1, y1], start=270, end=360, fill=NHAT, width=max(1, round(2.6 * k)))


def icon(size, kieu):
    """kieu: 'vuong' (bo góc), 'tron', 'fg' (lớp trước của adaptive icon, nền trong suốt), 'full' (vuông kín)."""
    S = size * SS
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if kieu == 'vuong':
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=S * 0.18, fill=NEN)
        pad = 0.14
    elif kieu == 'tron':
        d.ellipse([0, 0, S - 1, S - 1], fill=NEN)
        pad = 0.2
    elif kieu == 'full':
        d.rectangle([0, 0, S, S], fill=NEN)
        pad = 0.2
    else:  # fg: vùng an toàn của adaptive icon là vòng tròn đường kính 66/108 ở giữa
        pad = 0.235
    k = S * (1 - 2 * pad) / 100
    ve_hinh(d, S * pad, S * pad, k)
    # bề rộng chữ theo icon: vuông 86%, tròn 80%; adaptive 56% để nằm trong vòng an toàn 66/108
    ve_chu(im, S * {'vuong': 0.86, 'tron': 0.80, 'full': 0.62, 'fg': 0.56}[kieu], k)
    return im.resize((size, size), Image.LANCZOS)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    if len(sys.argv) > 2 and sys.argv[1] == '--xem':
        out = sys.argv[2]; os.makedirs(out, exist_ok=True)
        icon(512, 'vuong').save(os.path.join(out, 'xem-vuong.png'))
        icon(512, 'tron').save(os.path.join(out, 'xem-tron.png'))
        fg = icon(432, 'fg'); bg = Image.new('RGBA', fg.size, NEN + (255,)); bg.alpha_composite(fg)
        bg.save(os.path.join(out, 'xem-adaptive.png'))
        # các cỡ nhỏ cạnh nhau để xem độ rõ
        sheet = Image.new('RGBA', (48 + 72 + 96 + 144 + 50, 150), (240, 240, 240, 255))
        x = 10
        for s in (48, 72, 96, 144):
            sheet.alpha_composite(icon(s, 'vuong'), (x, 150 - s - 3)); x += s + 10
        sheet.save(os.path.join(out, 'xem-co-nho.png'))
        print('Da xuat anh xem truoc vao', out)
        return

    res = os.path.join(here, 'android', 'app', 'src', 'main', 'res')
    co = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
    for dpi, s in co.items():
        dd = os.path.join(res, 'mipmap-' + dpi)
        os.makedirs(dd, exist_ok=True)
        icon(s, 'vuong').save(os.path.join(dd, 'ic_launcher.png'))
        icon(s, 'tron').save(os.path.join(dd, 'ic_launcher_round.png'))
        icon(round(s * 108 / 48), 'fg').save(os.path.join(dd, 'ic_launcher_foreground.png'))
    with open(os.path.join(res, 'values', 'ic_launcher_background.xml'), 'w', encoding='utf-8') as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#%02X%02X%02X</color>\n</resources>\n' % NEN)
    # màn hình chờ: nền tối như giao diện app, icon ở giữa (giữ nguyên kích thước ảnh cũ)
    for root, _, files in os.walk(res):
        if 'splash.png' in files:
            p = os.path.join(root, 'splash.png')
            w, h = Image.open(p).size
            sp = Image.new('RGBA', (w, h), (22, 25, 29, 255))
            s = round(min(w, h) * 0.3)
            sp.alpha_composite(icon(s, 'vuong'), ((w - s) // 2, (h - s) // 2))
            sp.convert('RGB').save(p)
    web = os.path.join(here, '..', 'ban-cai')
    icon(192, 'vuong').save(os.path.join(web, 'icon-192.png'))
    icon(512, 'vuong').save(os.path.join(web, 'icon-512.png'))
    print('Da ghi icon vao', res, 'va', os.path.abspath(web))


if __name__ == '__main__':
    main()
