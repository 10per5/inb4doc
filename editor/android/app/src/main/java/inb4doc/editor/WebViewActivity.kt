package inb4doc.editor

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.util.Base64
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.MimeTypeMap
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileNotFoundException
import java.io.FileOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicReference

class WebViewActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    // Bundled editor: the thin shell ships inside the APK at assets/editor/.
    // The fetch updater downloads the live editor into the writable data dir
    // (app-specific external storage: /sdcard/Android/data/<pkg>/files/JsStaticFs,
    // visible to the user like the desktop ~/.local/share/inb4doc/JsStaticFs).
    // Once the data dir holds an index.html, this activity boots THAT copy
    // directly — a populated data dir wins over the bundled shell (Part C.1 W3),
    // matching the desktop data layout (gui/src/platform.cpp) — and the bundled
    // shell is only a first-run bootstrap until the updater's transfer + reload.
    // The URL path stays /editor/ (the APK asset mount); only the physical data
    // dir is JsStaticFs.
    private val assetEditorBase = "file:///android_asset/editor/"

    private fun dataEditorDir(): File =
        getExternalFilesDir(null)?.let { File(it, "JsStaticFs") }
            ?: File(filesDir, "JsStaticFs")

    // Default content root (mobile equivalent of the desktop default
    // content_root): the app-specific external docs dir, Android/data/<pkg>/docs
    // — sibling of files/ (which holds the updater's JsStaticFs). Backed by
    // DocsProvider, so the editor can save before any "Open Project" pick.
    private fun defaultContentDir(): File =
        File(getExternalFilesDir(null)?.parentFile ?: filesDir, "docs")

    private fun systemDarkTheme(): Boolean =
        (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES

    // Paint the reserved camera/status-bar strip with the web app's
    // --color-bg-secondary (light #f8f9fa / dark #3b4252 — the same value the
    // toolbar and mobile dock use), and flip the status/nav bar icon contrast so
    // it stays legible on that background. Called from onCreate (system night
    // mode, before JS boots) and from NativeBridge.setTheme (the app's real
    // dark/light preference).
    private fun applyTheme(dark: Boolean) {
        val strip = if (dark) 0xFF3B4252.toInt() else 0xFFF8F9FA.toInt()
        window.setBackgroundDrawable(ColorDrawable(strip))
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.isAppearanceLightStatusBars = !dark
        controller.isAppearanceLightNavigationBars = !dark
    }

    // The writable data-dir mount: editorMountUrl() returns the data dir's plain
    // file:// base (RFC 8089 "file:/storage/..." local form), so Farm's lazy
    // chunks resolve straight onto the updater-downloaded copies and WebView
    // serves them from the app's own external files dir natively (allowFileAccess).
    // shouldInterceptRequest backs that up for any file:// request WebView defers,
    // and serves the bundled android_asset fallback when the data dir has no copy.

    // File-chooser plumbing for WebChromeClient.onShowFileChooser (Load-from-Zip
    // and any <input type="file">): WebView shows no picker without it, and the
    // delivered content:// Uri is what WebView wires into the input's files list
    // (readable from JS via file.arrayBuffer()).
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val callback = fileChooserCallback ?: return@registerForActivityResult
        fileChooserCallback = null
        val data = result.data
        callback.onReceiveValue(
            if (result.resultCode == Activity.RESULT_OK && data?.data != null) {
                arrayOf(data.data!!)
            } else {
                null
            }
        )
    }

    // ── Project directory (SAF) ─────────────────────────────────────────
    // The active content root is a persistable content:// tree Uri (the user's
    // pick of "Open Project"). pickDirectory launches OpenDocumentTree on the
    // main thread and latches the result for the JS caller, which runs on the
    // JavaBridge thread. The tree Uri survives relaunch via SharedPreferences;
    // the JS recent list doubles as the picker history.
    private val projectPrefs by lazy {
        getSharedPreferences("inb4doc_project_tree", Context.MODE_PRIVATE)
    }
    private var treeUri: Uri? = null
    private var pendingPick: ((Uri?) -> Unit)? = null

    // Mirrors the JS ProviderType ints (src/providers/index.ts). The native
    // side routes every FS op to a root by the currently selected provider:
    // Saf ("On This Device") → built-in docs tree; Fs (Local Files) → the
    // user-picked tree (full path). JS passes relative paths only — it never
    // knows where a provider is rooted.
    private enum class ProviderEnum(val bridge: Int) {
        Remote(0), Filesystem(1), LocalStorage(2), Mount(3), Saf(4);

        companion object {
            fun from(bridge: Int): ProviderEnum =
                entries.firstOrNull { it.bridge == bridge } ?: Saf
        }
    }
    private var currentProvider: ProviderEnum = ProviderEnum.Saf

    private val safFs by lazy { SafFs(contentResolver, defaultContentDir()) }

    private val treePickerLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val uri = result.data?.data
        if (uri != null) {
            val flags = result.data?.flags ?: 0
            val read = flags and Intent.FLAG_GRANT_READ_URI_PERMISSION
            val write = flags and Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            try {
                contentResolver.takePersistableUriPermission(uri, read or write)
            } catch (e: Exception) {
                Log.w("inb4doc", "takePersistableUriPermission failed", e)
            }
        }
        pendingPick?.invoke(uri)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS)

        // Reserve the camera/status-bar strip instead of drawing under it: the
        // top part of the screen (status bar + display cutout) stays an empty,
        // theme-colored band and the WebView sits below it. Android 15 enforces
        // edge-to-edge for targetSdk 35, so the strip is inset by hand here
        // (below) rather than via fitSystemWindows. The band paints the web
        // app's --color-bg-secondary (toolbar/dock bg) and its bar icons follow
        // the dark/light theme; applyTheme() swaps both when setTheme arrives
        // from JS (or uses the system night mode before JS boots).
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT
        applyTheme(systemDarkTheme())

        // Restore the last Open-Project pick so a relaunch reopens the same
        // content root (mirrors desktop inb4.config.toml content_root).
        val savedTree = projectPrefs.getString("tree_uri", null)
        if (savedTree != null) {
            val uri = Uri.parse(savedTree)
            val stillHeld = contentResolver.persistedUriPermissions.any { it.uri == uri }
            treeUri = if (stillHeld) uri else null
        }
        currentProvider = ProviderEnum.from(
            projectPrefs.getInt("provider", ProviderEnum.Saf.bridge)
        )

        // Ensure the default content dir exists so the docs tree is writable
        // from the very first launch.
        defaultContentDir().mkdirs()

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
                    val uri = request?.url ?: return null
                    val url = uri.toString()

                    // Updater-downloaded editor files (lazy chunks, css, the
                    // downloaded index/app): served explicitly from the writable
                    // data dir by their plain file:// path too. Match on the
                    // decoded path (NOT a string prefix): Android's File.toURI()
                    // emits the RFC 8089 local form "file:/storage/..." (no
                    // "//"), so "file:///..." prefixes never match.
                    val path = uri.path ?: return null
                    val dataRoot = dataEditorDir().absolutePath
                    if (path.startsWith("$dataRoot/")) {
                        val rel = path.removePrefix("$dataRoot/")
                        if (rel.isEmpty()) return null
                        val dataFile = resolveWithin(dataEditorDir(), rel)
                        Log.i("inb4doc", "SIR data-dir $rel exists=${dataFile?.isFile}")
                        if (dataFile?.isFile == true) {
                            return try {
                                serveFile(rel, dataFile)
                            } catch (e: Exception) {
                                Log.w("inb4doc", "intercept failed for $rel", e)
                                null
                            }
                        }
                        return null
                    }

                    if (!url.startsWith(assetEditorBase)) return null
                    val rel = url.removePrefix(assetEditorBase).substringBefore('?').substringBefore('#')
                    if (rel.isEmpty()) return null

                    val mime = guessMime(rel)

                    // Writable data dir first: a populated data dir wins over the
                    // bundled shell (Part C.1 W3).
                    val dataFile = resolveWithin(dataEditorDir(), rel)
                    if (dataFile?.isFile == true) {
                        try {
                            return serveFile(rel, dataFile)
                        } catch (e: Exception) {
                            Log.w("inb4doc", "intercept failed for $rel", e)
                        }
                    }

                    // Fall back to the bundled asset. Served explicitly rather than
                    // through WebView's built-in file:///android_asset loader, whose
                    // asset lookup is unreliable for URLs carrying a query string or
                    // fragment (the build emits assets/app.js?ver=0.0.5).
                    try {
                        return WebResourceResponse(mime, null, assets.open("editor/$rel"))
                    } catch (e: Exception) {
                        return null
                    }
                }
            }

            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    webView: WebView?,
                    filePathCallback: ValueCallback<Array<Uri>>?,
                    fileChooserParams: FileChooserParams?
                ): Boolean {
                    filePathCallback ?: return false
                    val intent = fileChooserParams?.createIntent() ?: return false
                    fileChooserCallback = filePathCallback
                    return try {
                        fileChooserLauncher.launch(intent)
                        true
                    } catch (e: Exception) {
                        fileChooserCallback = null
                        Log.w("inb4doc", "file chooser launch failed", e)
                        false
                    }
                }

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

        // The WebView is pushed below the reserved camera/status-bar strip at
        // the top only — the bottom stays edge-to-edge (content may draw behind
        // the gesture/nav bar). Padding the container — not the WebView — keeps
        // the page viewport a plain rectangle that never scrolls under the bar.
        val content = FrameLayout(this)
        ViewCompat.setOnApplyWindowInsetsListener(content) { v, insets ->
            val top = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or
                    WindowInsetsCompat.Type.displayCutout()
            ).top
            v.setPadding(0, top, 0, 0)
            insets
        }
        content.addView(
            webView,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
        setContentView(content)

        // Boot the updater-downloaded copy of index.html once the data dir has
        // one; the bundled thin shell is only the first-run bootstrap. Booting
        // the bundled shell forever would loop: its build-time index hash never
        // matches the remote manifest, so the updater keeps reloading.
        val dataIndex = File(dataEditorDir(), "index.html")
        webView.loadUrl(
            if (dataIndex.isFile) dataIndex.toURI().toString()
            else assetEditorBase + "index.html"
        )
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
        val canon = try {
            target.canonicalFile
        } catch (e: Exception) {
            return null
        }
        return if (canon.path.startsWith(base.path)) canon else null
    }

    // Serve a data-dir file with the guessed MIME plus permissive CORS. WebView
    // can load plain file:// from the app's own data dir natively
    // (allowFileAccess); this is the backup for any request WebView defers here.
    // allowUniversalAccessFromFileURLs already relaxes cross-origin access, and
    // the explicit header covers dynamic import() in updater hot-swaps and any
    // webview where the flag is reset.
    private fun serveFile(rel: String, file: File): WebResourceResponse {
        val headers = mapOf("Access-Control-Allow-Origin" to "*")
        return WebResourceResponse(
            guessMime(rel), null, 200, "OK", headers, FileInputStream(file)
        )
    }

    // Persist a generated file into the user-visible Downloads collection. On
    // API 29+ (scoped storage) that's a MediaStore.Downloads insert — no
    // permission needed. Older releases write to the app's external Download
    // dir (also permission-free; visible under Android/data/<pkg>/files).
    private fun writeDownload(fileName: String, bytes: ByteArray): String {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, fileName)
                put(MediaStore.Downloads.MIME_TYPE, "application/zip")
            }
            val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: throw IllegalStateException("MediaStore insert failed")
            try {
                contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                    ?: throw IllegalStateException("openOutputStream failed")
            } catch (e: Exception) {
                contentResolver.delete(uri, null, null)
                throw e
            }
            return uri.toString()
        }
        val dir = File(getExternalFilesDir(null), "Download").apply { mkdirs() }
        val out = File(dir, fileName)
        FileOutputStream(out).use { it.write(bytes) }
        return out.absolutePath
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

    // The content root an FS op hits, decided by the currently selected
    // provider (JS never passes a tree URI — it works in relative paths only):
    //   Saf ("On This Device") → the built-in docs tree (Android/data/<pkg>/docs)
    //   Fs (Local Files)       → the user-picked tree (full path), docs fallback
    // Everything else (Remote/LocalStorage/Mount) doesn't use the SAF FS ops.
    private fun activeTree(): Uri? = when (currentProvider) {
        ProviderEnum.Saf -> Uri.parse(DocsProvider.ROOT_TREE_URI)
        ProviderEnum.Filesystem -> treeUri ?: Uri.parse(DocsProvider.ROOT_TREE_URI)
        else -> treeUri ?: Uri.parse(DocsProvider.ROOT_TREE_URI)
    }

    private fun persistTree(uri: Uri) {
        treeUri = uri
        projectPrefs.edit().putString("tree_uri", uri.toString()).apply()
    }

    private fun projectRootObject(uri: Uri): JSONObject = JSONObject().apply {
        put("path", uri.toString())
        val docId = DocumentsContract.getTreeDocumentId(uri)
        put("name", docId.substringAfterLast('/'))
    }

    private fun nullDataJson(): String = "{\"ok\":true,\"data\":null}"

    private fun treeJson(
        paths: List<String>,
        folderWeights: Map<String, Int>,
        fileWeights: Map<String, Int>,
    ): JSONObject = JSONObject().apply {
        put("paths", JSONArray(paths))
        put("folderWeights", JSONObject().apply { folderWeights.forEach { put(it.key, it.value) } })
        put("fileWeights", JSONObject().apply { fileWeights.forEach { put(it.key, it.value) } })
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

        // The web app reports its dark/light theme so the reserved system-bar
        // strip (and its icon contrast) follows the app instead of the system.
        // Runs on the JavaBridge thread — hop to the UI thread for window work.
        @JavascriptInterface
        fun setTheme(theme: String?) {
            val dark = theme == "dark"
            runOnUiThread { applyTheme(dark) }
        }

        // The writable data-dir mount URL (trailing slash, plain file:// base).
        // Farm's lazy chunk loader resolves chunks against this base so they hit
        // the updater's downloaded copies. WebView serves file:// from the app's
        // own data dir natively, so the chunks load without needing
        // shouldInterceptRequest to be consulted.
        @JavascriptInterface
        fun editorMountUrl(): String = dataEditorDir().toURI().toString()

        // ── Part C.1 W3 updater storage bridge ──
        // Mirrors the desktop saucer.exposed envelope ({ok, status?, error?,
        // data?}); the fetch updater downloads the live editor into the writable
        // data dir (app-specific external storage JsStaticFs) keyed by the
        // app-relative path the webview serves (e.g. "assets/node_imports-abc.js").

        @JavascriptInterface
        fun updaterPut(path: String, dataB64: String): String {
            if (path.isEmpty() || path.contains("..")) return jsonError(400, "Invalid path")
            val target = resolveWithin(dataEditorDir(), path) ?: return jsonError(403, "Forbidden")
            return try {
                target.parentFile?.mkdirs()
                val bytes = Base64.decode(dataB64, Base64.DEFAULT)
                FileOutputStream(target).use { it.write(bytes) }
                Log.i("inb4doc", "updaterPut $path -> ${target.absolutePath} ($bytes bytes)")
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

        // Save-as-Zip (mobile): the desktop/browser path uses an <a download>
        // on a blob: URL, which Android WebView silently drops (no download
        // manager). Write the archive through here into the user's Downloads
        // instead; returns the standard {ok} envelope.
        @JavascriptInterface
        fun saveZip(dataB64: String, fileName: String): String {
            if (fileName.isEmpty() || fileName.contains("..") || fileName.contains("/")) {
                return jsonError(400, "Invalid file name")
            }
            return try {
                val bytes = Base64.decode(dataB64, Base64.DEFAULT)
                val saved = writeDownload(fileName, bytes)
                Log.i("inb4doc", "saveZip -> $saved ($bytes bytes)")
                jsonOk()
            } catch (e: Exception) {
                Log.w("inb4doc", "saveZip failed for $fileName", e)
                jsonError(500, "Write failed")
            }
        }

        @JavascriptInterface
        fun reload(): String {
            runOnUiThread {
                // After the updater's transfer, boot the downloaded index.html:
                // its boot hash then matches the remote manifest, ending the
                // reload loop. Falls back to the bundled shell on a virgin data
                // dir.
                val dataIndex = File(dataEditorDir(), "index.html")
                if (dataIndex.isFile) webView.loadUrl(dataIndex.toURI().toString())
                else webView.reload()
            }
            return jsonOk()
        }

        // ── Runtime directory reselection (File → Open Project…) + SAF FS ──
        // Mirrors the desktop saucer.exposed envelope ({ok, status?, error?,
        // data?}); every method is forwarded from src/bridge/mobile/index.ts.

        // SAF project picker. Must hop to the main thread and block until the
        // ActivityResult lands, since @JavascriptInterface runs off the UI
        // thread. Returns {data:{path,name}} or {data:null} on cancel.
        @JavascriptInterface
        fun pickDirectory(): String {
            val latch = CountDownLatch(1)
            val result = AtomicReference<Uri?>()
            runOnUiThread {
                pendingPick = { uri ->
                    result.set(uri)
                    if (uri != null) persistTree(uri)
                    latch.countDown()
                }
                try {
                    treePickerLauncher.launch(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE))
                } catch (e: Exception) {
                    pendingPick = null
                    result.set(null)
                    latch.countDown()
                    Log.w("inb4doc", "OpenDocumentTree launch failed", e)
                }
            }
            try {
                latch.await()
            } catch (e: InterruptedException) {
                return jsonError(500, "Interrupted")
            }
            val uri = result.get() ?: return nullDataJson()
            return jsonData(projectRootObject(uri))
        }

        // Current content root — used by the editor to restore the last project.
        @JavascriptInterface
        fun getContentRoot(): String {
            val uri = activeTree() ?: return nullDataJson()
            return jsonData(projectRootObject(uri))
        }

        // The JS layer reports which provider is active so the native FS ops
        // (which receive relative paths only) know which tree to root at.
        @JavascriptInterface
        fun setProvider(type: Int): String {
            currentProvider = ProviderEnum.from(type)
            projectPrefs.edit().putInt("provider", currentProvider.bridge).apply()
            return jsonOk()
        }

        // Point the SAF layer at a new tree Uri. Validates + persists + sets it
        // active, so a relaunch reopens the same project.
        @JavascriptInterface
        fun setContentRoot(path: String): String {
            if (path.isEmpty()) return jsonError(400, "Invalid path")
            val uri = try {
                Uri.parse(path)
            } catch (e: Exception) {
                return jsonError(400, "Invalid path")
            }
            if (!DocumentsContract.isTreeUri(uri)) return jsonError(400, "Not a directory")
            // The built-in docs tree needs no SAF grant (our own provider);
            // anything else must still be held so a relaunch can re-open it.
            if (uri.authority != DocsProvider.AUTHORITY) {
                val held = contentResolver.persistedUriPermissions.any { it.uri == uri }
                if (!held) {
                    try {
                        contentResolver.takePersistableUriPermission(
                            uri,
                            Intent.FLAG_GRANT_READ_URI_PERMISSION or
                                Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
                        )
                    } catch (e: Exception) {
                        return jsonError(403, "No access to directory")
                    }
                }
            }
            persistTree(uri)
            return jsonOk()
        }

        @JavascriptInterface
        fun getTree(): String {
            val treeUri = activeTree() ?: return jsonData(treeJson(emptyList(), emptyMap(), emptyMap()))
            return try {
                val t = safFs.buildTree(treeUri)
                jsonData(treeJson(t.paths, t.folderWeights, t.fileWeights))
            } catch (e: Exception) {
                Log.w("inb4doc", "getTree failed", e)
                jsonError(500, "getTree failed")
            }
        }

        @JavascriptInterface
        fun readFile(path: String): String {
            val treeUri = activeTree() ?: return nullDataJson()
            return try {
                val doc = safFs.resolve(treeUri, path) ?: return nullDataJson()
                val content = safFs.readText(treeUri, doc.id)
                if (content == null) nullDataJson() else jsonData(content)
            } catch (e: Exception) {
                Log.w("inb4doc", "readFile failed for $path", e)
                jsonError(500, "Read failed")
            }
        }

        @JavascriptInterface
        fun writeFile(path: String, content: String): String {
            val treeUri = activeTree() ?: return jsonError(400, "No project directory")
            if (path.isEmpty() || path.contains("..")) return jsonError(403, "Forbidden")
            return try {
                safFs.writeText(treeUri, path, content)
                jsonOk()
            } catch (e: Exception) {
                Log.w("inb4doc", "writeFile failed for $path", e)
                jsonError(500, "Write failed")
            }
        }

        @JavascriptInterface
        fun deleteFiles(paths: Array<String>): String {
            val treeUri = activeTree() ?: return jsonError(400, "No project directory")
            return try {
                val parents = safFs.deleteRelPaths(treeUri, paths.toList())
                safFs.pruneEmptyDirs(treeUri, parents)
                jsonOk()
            } catch (e: Exception) {
                Log.w("inb4doc", "deleteFiles failed", e)
                jsonError(500, "Delete failed")
            }
        }

        @JavascriptInterface
        fun moveFile(from: String, to: String): String {
            val treeUri = activeTree() ?: return jsonError(400, "No project directory")
            return try {
                safFs.move(treeUri, from, to)
                jsonOk()
            } catch (e: FileNotFoundException) {
                jsonError(404, "Source not found")
            } catch (e: IllegalStateException) {
                jsonError(409, "Destination exists")
            } catch (e: Exception) {
                Log.w("inb4doc", "moveFile failed $from -> $to", e)
                jsonError(500, "Move failed")
            }
        }

        @JavascriptInterface
        fun getServerTime(path: String): String {
            val treeUri = activeTree() ?: return nullDataJson()
            return try {
                val doc = safFs.resolve(treeUri, path)
                if (doc == null || doc.lastModified <= 0L) {
                    nullDataJson()
                } else {
                    jsonData(doc.lastModified)
                }
            } catch (e: Exception) {
                Log.w("inb4doc", "getServerTime failed for $path", e)
                jsonError(500, "getServerTime failed")
            }
        }

        @JavascriptInterface
        fun search(query: String): String {
            val treeUri = activeTree() ?: return jsonData(JSONObject().put("results", JSONArray()))
            return try {
                val hits = safFs.search(treeUri, query)
                val arr = JSONArray()
                for (h in hits) {
                    arr.put(JSONObject().apply {
                        put("path", h.path)
                        put("snippets", JSONArray(h.snippets))
                    })
                }
                jsonData(JSONObject().apply { put("results", arr) })
            } catch (e: Exception) {
                Log.w("inb4doc", "search failed", e)
                jsonError(500, "Search failed")
            }
        }

        @JavascriptInterface
        fun uploadImage(name: String, dir: String, dataB64: String): String {
            val treeUri = activeTree() ?: return jsonError(400, "No project directory")
            return try {
                val url = safFs.uploadImage(treeUri, name, dir, dataB64)
                jsonData(JSONObject().apply { put("url", url) })
            } catch (e: Exception) {
                Log.w("inb4doc", "uploadImage failed $name", e)
                jsonError(500, "Upload failed")
            }
        }

        @JavascriptInterface
        fun listImages(dir: String, refs: Boolean): String {
            val treeUri = activeTree() ?: return jsonData(JSONObject().put("images", JSONArray()))
            return try {
                val images = safFs.listImages(treeUri, dir, refs)
                val arr = JSONArray()
                for (img in images) {
                    arr.put(JSONObject().apply {
                        put("name", img.name)
                        put("url", img.url)
                        put("storageUrl", img.storageUrl)
                        put("usedIn", JSONArray(img.usedIn))
                    })
                }
                jsonData(JSONObject().apply { put("images", arr) })
            } catch (e: Exception) {
                Log.w("inb4doc", "listImages failed for $dir", e)
                jsonError(500, "listImages failed")
            }
        }

        @JavascriptInterface
        fun renameImage(name: String, dir: String, newName: String): String {
            val treeUri = activeTree() ?: return jsonError(400, "No project directory")
            return try {
                val url = safFs.renameImage(treeUri, name, dir, newName)
                jsonData(JSONObject().apply { put("url", url) })
            } catch (e: Exception) {
                Log.w("inb4doc", "renameImage failed $name -> $newName", e)
                jsonError(500, "Rename failed")
            }
        }

        @JavascriptInterface
        fun deleteImage(name: String, dir: String): String {
            val treeUri = activeTree() ?: return jsonError(400, "No project directory")
            return try {
                val rel = if (dir.isEmpty()) "image/$name" else "$dir/image/$name"
                val id = safFs.resolve(treeUri, rel)?.id ?: return jsonError(404, "Not found")
                if (!safFs.delete(treeUri, id)) return jsonError(500, "Delete failed")
                jsonOk()
            } catch (e: Exception) {
                Log.w("inb4doc", "deleteImage failed $name", e)
                jsonError(500, "Delete failed")
            }
        }

        // Map a markdown image URL to a loadable content:// URI, or null.
        @JavascriptInterface
        fun resolveImage(url: String): String {
            val treeUri = activeTree() ?: return nullDataJson()
            return try {
                val uri = safFs.resolveImage(treeUri, url)
                if (uri == null) nullDataJson() else jsonData(uri)
            } catch (e: Exception) {
                Log.w("inb4doc", "resolveImage failed for $url", e)
                nullDataJson()
            }
        }
    }
}
