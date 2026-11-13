package app.clipo.editor;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Back (button or gesture) closes what is open in the app first: a dialog, a panel, then the
        // editor. The web app gives each of those a history entry (src/backStack.ts). With nothing
        // left to close, Clipo goes to the background instead of quitting, so it reopens instantly.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView web = getBridge() != null ? getBridge().getWebView() : null;
                if (web != null && web.canGoBack()) web.goBack();
                else moveTaskToBack(true);
            }
        });
    }
}
