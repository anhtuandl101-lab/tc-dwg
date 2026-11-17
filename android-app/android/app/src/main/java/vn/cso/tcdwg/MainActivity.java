package vn.cso.tcdwg;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MoFilePlugin.class);
        super.onCreate(savedInstanceState);
        MoFilePlugin.nhanIntent(this, getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        MoFilePlugin.nhanIntent(this, intent);
    }
}
