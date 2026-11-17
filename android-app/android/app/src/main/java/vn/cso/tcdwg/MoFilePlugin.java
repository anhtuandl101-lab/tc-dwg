package vn.cso.tcdwg;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Nhận file DWG do app khác gửi sang ("Mở bằng", "Chia sẻ"):
 * chép nội dung vào cache/mo/ rồi báo cho phần web qua sự kiện "fileMo".
 */
@CapacitorPlugin(name = "MoFile")
public class MoFilePlugin extends Plugin {
    private static JSObject cho = null;
    private static MoFilePlugin inst = null;

    @Override
    public void load() {
        inst = this;
    }

    static void nhanIntent(final Activity a, Intent it) {
        if (it == null) return;
        String act = it.getAction();
        Uri u = null;
        if (Intent.ACTION_VIEW.equals(act)) u = it.getData();
        else if (Intent.ACTION_SEND.equals(act)) u = it.getParcelableExtra(Intent.EXTRA_STREAM);
        if (u == null) return;
        it.setAction(Intent.ACTION_MAIN); // tránh mở lại khi xoay màn hình
        final Uri uri = u;
        new Thread(() -> {
            try {
                String name = tenFile(a, uri);
                File dir = new File(a.getCacheDir(), "mo");
                if (!dir.exists()) dir.mkdirs();
                File[] old = dir.listFiles();
                if (old != null) for (File f : old) f.delete();   // chỉ giữ file vừa nhận trong cache
                File f = new File(dir, name.replaceAll("[\\\\/:*?\"<>|]", "_"));
                try (InputStream in = a.getContentResolver().openInputStream(uri);
                     OutputStream out = new FileOutputStream(f)) {
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                }
                JSObject o = new JSObject();
                o.put("path", f.getAbsolutePath());
                o.put("name", name);
                synchronized (MoFilePlugin.class) {
                    if (inst != null) inst.notifyListeners("fileMo", o, true);
                    else cho = o;
                }
            } catch (Exception e) {
                JSObject o = new JSObject();
                o.put("error", String.valueOf(e.getMessage()));
                if (inst != null) inst.notifyListeners("fileLoi", o, true);
            }
        }).start();
    }

    private static String tenFile(Activity a, Uri u) {
        String name = null;
        if ("content".equals(u.getScheme())) {
            try (Cursor c = a.getContentResolver().query(u, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                if (c != null && c.moveToFirst()) name = c.getString(0);
            } catch (Exception ignored) { }
        }
        if (name == null) name = u.getLastPathSegment();
        if (name == null || name.isEmpty()) name = "banve.dwg";
        int slash = name.lastIndexOf('/');
        if (slash >= 0) name = name.substring(slash + 1);
        return name;
    }

    /** Chép file (đường dẫn tuyệt đối src) vào thư mục dữ liệu app (dst tương đối, vd banve/x.dwg) cho "Mở gần đây". */
    @PluginMethod
    public void luuBanSao(PluginCall call) {
        final String src = call.getString("src"), dst = call.getString("dst");
        if (src == null || dst == null || dst.contains("..")) { call.reject("Thiếu đường dẫn"); return; }
        new Thread(() -> {
            try {
                File out = new File(getContext().getFilesDir(), dst);
                File dir = out.getParentFile();
                if (dir != null && !dir.exists()) dir.mkdirs();
                try (InputStream in = new java.io.FileInputStream(src);
                     OutputStream os = new FileOutputStream(out)) {
                    byte[] buf = new byte[262144];
                    int n;
                    while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
                }
                JSObject r = new JSObject();
                r.put("path", dst);
                call.resolve(r);
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            }
        }).start();
    }

    @PluginMethod
    public void layFileCho(PluginCall call) {
        JSObject r;
        synchronized (MoFilePlugin.class) {
            r = cho != null ? cho : new JSObject();
            cho = null;
        }
        call.resolve(r);
    }
}
