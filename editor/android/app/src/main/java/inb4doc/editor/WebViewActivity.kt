package inb4doc.editor

import android.annotation.SuppressLint
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity

class WebViewActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS)

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.allowFileAccess = true
            settings.allowContentAccess = true
            settings.allowFileAccessFromFileURLs = true
            settings.allowUniversalAccessFromFileURLs = true
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.userAgentString = settings.userAgentString + " inb4doc-android"

            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(
                    view: WebView?,
                    request: WebResourceRequest?
                ): Boolean {
                    val url = request?.url?.toString() ?: return false
                    if (url.startsWith("file:///android_asset/")) return false
                    view?.loadUrl(url)
                    return true
                }
            }

            webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(cm: android.webkit.ConsoleMessage?): Boolean {
                    cm ?: return true
                    val tag = "inb4doc-js"
                    val msg = "${cm.message()} [${cm.sourceId()}:${cm.lineNumber()}]"
                    when (cm.messageLevel()) {
                        android.webkit.ConsoleMessage.MessageLevel.ERROR -> Log.e(tag, msg)
                        android.webkit.ConsoleMessage.MessageLevel.WARNING -> Log.w(tag, msg)
                        android.webkit.ConsoleMessage.MessageLevel.DEBUG -> Log.d(tag, msg)
                        else -> Log.i(tag, msg)
                    }
                    return true
                }
            }

            addJavascriptInterface(NativeBridge(), "NativeBridge")
        }

        setContentView(webView)

        webView.loadUrl("file:///android_asset/editor/index.html")
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    inner class NativeBridge {
        @JavascriptInterface
        fun copyToClipboard(text: String) {
            val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val clip = ClipData.newPlainText("inb4doc", text)
            clipboard.setPrimaryClip(clip)
        }

        @JavascriptInterface
        fun log(message: String) {
            Log.i("inb4doc", message)
        }
    }
}
