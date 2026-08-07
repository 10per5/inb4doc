package inb4doc.editor

import android.annotation.SuppressLint
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Bundle
import android.util.Base64
import android.util.Log
import android.view.View
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.MimeTypeMap
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream

class WebViewActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    // Bundled editor: the thin shell ships inside the APK at assets/editor/.
    // The fetch updater downloads the live editor into filesDir/JsStaticFs (the
    // writable data dir); shouldInterceptRequest serves that copy first, so a
    // populated data dir wins over the bundled shell (Part C.1 W3). The URL
    // path stays /editor/ (the APK asset mount); only the physical data dir is
    // JsStaticFs, matching the desktop data layout (gui/src/platform.cpp).
    private val assetEditorBase = "file:///android_asset/editor/"

    private fun dataEditorDir(): File = File(filesDir, "JsStaticFs")

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

                override fun shouldInterceptRequest(
                    view: WebView?,
                    request: WebResourceRequest?
                ): WebResourceResponse? {
                    val url = request?.url?.toString() ?: return null
                    if (!url.startsWith(assetEditorBase)) return null
                    val rel = url.removePrefix(assetEditorBase).substringBefore('?').substringBefore('#')
                    if (rel.isEmpty()) return null

                    val dataFile = resolveWithin(dataEditorDir(), rel) ?: return null
                    if (!dataFile.isFile) return null

                    val mime = guessMime(rel)
                    try {
                        return WebResourceResponse(mime, null, FileInputStream(dataFile))
                    } catch (e: Exception) {
                        Log.w("inb4doc", "intercept failed for $rel", e)
                        return null
                    }
                }
            }

            webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(cm: ConsoleMessage?): Boolean {
                    cm ?: return true
                    val tag = "inb4doc-js"
                    val msg = "${cm.message()} [${cm.sourceId()}:${cm.lineNumber()}]"
                    when (cm.messageLevel()) {
                        ConsoleMessage.MessageLevel.ERROR -> Log.e(tag, msg)
                        ConsoleMessage.MessageLevel.WARNING -> Log.w(tag, msg)
                        ConsoleMessage.MessageLevel.DEBUG -> Log.d(tag, msg)
                        else -> Log.i(tag, msg)
                    }
                    return true
                }
            }

            addJavascriptInterface(NativeBridge(), "NativeBridge")
        }

        setContentView(webView)

        webView.loadUrl(assetEditorBase + "index.html")
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

    // Resolve `rel` inside `root`, refusing path traversal. Returns null when
    // rel escapes root or cannot be resolved.
    private fun resolveWithin(root: File, rel: String): File? {
        val target = File(root, rel)
        val base = root.canonicalFile
        val canon = target.canonicalFile
        return if (canon.path.startsWith(base.path)) canon else null
    }

    // Chromium enforces a JS MIME type for <script type="module">, so the asset
    // map must be explicit rather than relying on MimeTypeMap (which returns
    // null for .js on several API levels).
    private fun guessMime(path: String): String {
        val ext = path.substringAfterLast('.', "").lowercase()
        return when (ext) {
            "js", "mjs" -> "application/javascript"
            "css" -> "text/css"
            "html", "htm" -> "text/html"
            "json", "map" -> "application/json"
            "md" -> "text/markdown"
            "svg" -> "image/svg+xml"
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "gif" -> "image/gif"
            "webp" -> "image/webp"
            "ico" -> "image/x-icon"
            "woff2" -> "font/woff2"
            "woff" -> "font/woff"
            "ttf" -> "font/ttf"
            else -> MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext)
                ?: "application/octet-stream"
        }
    }

    private fun jsonOk(): String = JSONObject().apply { put("ok", true) }.toString()

    private fun jsonError(status: Int, msg: String): String =
        JSONObject().apply {
            put("ok", false)
            put("status", status)
            put("error", msg)
        }.toString()

    private fun jsonData(data: Any): String =
        JSONObject().apply {
            put("ok", true)
            put("data", data)
        }.toString()

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

        // ── Part C.1 W3 updater storage bridge ──
        // Mirrors the desktop saucer.exposed envelope ({ok, status?, error?,
        // data?}); the fetch updater downloads the live editor into the writable
        // data dir (filesDir/JsStaticFs) keyed by the app-relative path the
        // webview serves (e.g. "assets/node_imports-abc.js").

        @JavascriptInterface
        fun updaterPut(path: String, dataB64: String): String {
            if (path.isEmpty() || path.contains("..")) return jsonError(400, "Invalid path")
            val target = resolveWithin(dataEditorDir(), path) ?: return jsonError(403, "Forbidden")
            return try {
                target.parentFile?.mkdirs()
                val bytes = Base64.decode(dataB64, Base64.DEFAULT)
                FileOutputStream(target).use { it.write(bytes) }
                jsonOk()
            } catch (e: Exception) {
                Log.w("inb4doc", "updaterPut failed for $path", e)
                jsonError(500, "Write failed")
            }
        }

        @JavascriptInterface
        fun updaterHas(path: String): String {
            if (path.isEmpty() || path.contains("..")) return jsonData(false)
            val target = resolveWithin(dataEditorDir(), path) ?: return jsonData(false)
            return jsonData(target.isFile)
        }

        @JavascriptInterface
        fun updaterSizeOf(path: String): String {
            if (path.isEmpty() || path.contains("..")) return jsonData(0)
            val target = resolveWithin(dataEditorDir(), path) ?: return jsonData(0)
            return jsonData(target.takeIf { it.isFile }?.length() ?: 0L)
        }

        @JavascriptInterface
        fun reload(): String {
            runOnUiThread { webView.reload() }
            return jsonOk()
        }
    }
}
