package com.mahatx.mahattv;

import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private LocalStreamProxy localStreamProxy;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        localStreamProxy = new LocalStreamProxy();
        localStreamProxy.start();

        super.onCreate(savedInstanceState);

        // Aceleração de hardware e mantém tela ativa ao assistir vídeos
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED
        );

        if (this.bridge != null && this.bridge.getWebView() != null) {
            WebView webView = this.bridge.getWebView();
            WebSettings settings = webView.getSettings();
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setCacheMode(WebSettings.LOAD_DEFAULT);

            // Expõe a porta do proxy HTTP local de streams para o JS de forma síncrona
            webView.addJavascriptInterface(new Object() {
                @JavascriptInterface
                public int getProxyPort() {
                    return localStreamProxy != null ? localStreamProxy.getPort() : 0;
                }
            }, "MahatNative");
        }
    }

    @Override
    public void onDestroy() {
        if (localStreamProxy != null) {
            localStreamProxy.stop();
        }
        super.onDestroy();
    }
}
