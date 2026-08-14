package inb4doc.editor

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import android.view.View
import android.view.WindowManager
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
    // visible to the user like the desktop ~/.local/share/inb4doc/JsStaticFs);
    // shouldInterceptRequest serves that copy first, so a populated data dir wins
    // over the bundled shell (Part C.1 W3). The URL path stays /editor/ (the APK
    // asset mount); only the physical data dir is JsStaticFs, matching the desktop
    // data layout (gui/src/platform.cpp).
    private val assetEditorBase = "file:///android_asset/editor/"

    private fun dataEditorDir(): File =
        getExternalFilesDir(null)?.let { File(it, "JsStaticFs") }
            ?: File(filesDir, "JsStaticFs")

    // Custom scheme for the writable data-dir mount. Unlike plain file:// URLs
    // — which WebView can serve via its native file loader without consulting
    // shouldInterceptRequest, or block outright — a custom scheme has NO native
    // handler, so every request is routed through shouldInterceptRequest
    // deterministically. The page's own eager assets still load from the
    // bundled file:///android_asset/editor/ shell; only the updater's data-dir
    // chunks go through this scheme.
    private val editorMountScheme = "app://editor/"

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

    private val safFs by lazy { SafFs(contentResolver) }

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

        // Restore the last Open-Project pick so a relaunch reopens the same
        // content root (mirrors desktop inb4.config.toml content_root).
        val savedTree = projectPrefs.getString("tree_uri", null)
        if (savedTree != null) {
            val uri = Uri.parse(savedTree)
            val stillHeld = contentResolver.persistedUriPermissions.any { it.uri == uri }
            treeUri = if (stillHeld) uri else null
        }

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

                    // Custom-scheme mount (app://editor/): no native WebView
                    // handler, so every request lands here deterministically —
                    // unlike plain file:// URLs, which WebView may serve itself
                    // or block outright. The part below the mount is the
                    // data-dir-relative path the updater stored chunks under
                    // (e.g. "assets/node_imports-<hash>.js").
                    if (url.startsWith(editorMountScheme)) {
                        val rel = url
                            .removePrefix(editorMountScheme)
                            .substringBefore('?')
                            .substringBefore('#')
                        if (rel.isEmpty()) return null
                        val dataFile = resolveWithin(dataEditorDir(), rel)
                        Log.i("inb4doc", "SIR scheme $rel exists=${dataFile?.isFile}")
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

    // Serve a data-dir file with the guessed MIME plus permissive CORS. The
    // page boots from a file:// document but loads updater chunks from the
    // custom app:// scheme; WebView's allowUniversalAccessFromFileURLs already
    // relaxes cross-origin access, and the explicit header covers dynamic
    // import() in updater hot-swaps and any webview where the flag is reset.
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

    private fun activeTree(): Uri? = treeUri

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

        // The writable data-dir mount URL (trailing slash) under the custom
        // app:// scheme. The page loads from the bundled android_asset shell,
        // but Farm's lazy chunk loader must resolve chunks against this base so
        // they reach the updater's downloaded copies. A custom scheme has no
        // native WebView handler, so every request deterministically lands in
        // shouldInterceptRequest, which serves the matching data-dir file.
        @JavascriptInterface
        fun editorMountUrl(): String = editorMountScheme

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
            runOnUiThread { webView.reload() }
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
            persistTree(uri)
            return jsonOk()
        }

        @JavascriptInterface
        fun getTree(): String {
            val tree = activeTree() ?: return jsonData(treeJson(emptyList(), emptyMap(), emptyMap()))
            return try {
                val t = safFs.buildTree(tree)
                jsonData(treeJson(t.paths, t.folderWeights, t.fileWeights))
            } catch (e: Exception) {
                Log.w("inb4doc", "getTree failed", e)
                jsonError(500, "getTree failed")
            }
        }

        @JavascriptInterface
        fun readFile(path: String): String {
            val tree = activeTree() ?: return nullDataJson()
            return try {
                val doc = safFs.resolve(tree, path) ?: return nullDataJson()
                val content = safFs.readText(tree, doc.id)
                if (content == null) nullDataJson() else jsonData(content)
            } catch (e: Exception) {
                Log.w("inb4doc", "readFile failed for $path", e)
                jsonError(500, "Read failed")
            }
        }

        @JavascriptInterface
        fun writeFile(path: String, content: String): String {
            val tree = activeTree() ?: return jsonError(400, "No project directory")
            if (path.isEmpty() || path.contains("..")) return jsonError(403, "Forbidden")
            return try {
                safFs.writeText(tree, path, content)
                jsonOk()
            } catch (e: Exception) {
                Log.w("inb4doc", "writeFile failed for $path", e)
                jsonError(500, "Write failed")
            }
        }

        @JavascriptInterface
        fun deleteFiles(paths: Array<String>): String {
            val tree = activeTree() ?: return jsonError(400, "No project directory")
            return try {
                val parents = safFs.deleteRelPaths(tree, paths.toList())
                safFs.pruneEmptyDirs(tree, parents)
                jsonOk()
            } catch (e: Exception) {
                Log.w("inb4doc", "deleteFiles failed", e)
                jsonError(500, "Delete failed")
            }
        }

        @JavascriptInterface
        fun moveFile(from: String, to: String): String {
            val tree = activeTree() ?: return jsonError(400, "No project directory")
            return try {
                safFs.move(tree, from, to)
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
            val tree = activeTree() ?: return nullDataJson()
            return try {
                val doc = safFs.resolve(tree, path)
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
            val tree = activeTree() ?: return jsonData(JSONObject().put("results", JSONArray()))
            return try {
                val hits = safFs.search(tree, query)
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
            val tree = activeTree() ?: return jsonError(400, "No project directory")
            return try {
                val url = safFs.uploadImage(tree, name, dir, dataB64)
                jsonData(JSONObject().apply { put("url", url) })
            } catch (e: Exception) {
                Log.w("inb4doc", "uploadImage failed $name", e)
                jsonError(500, "Upload failed")
            }
        }

        @JavascriptInterface
        fun listImages(dir: String, refs: Boolean): String {
            val tree = activeTree() ?: return jsonData(JSONObject().put("images", JSONArray()))
            return try {
                val images = safFs.listImages(tree, dir, refs)
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
            val tree = activeTree() ?: return jsonError(400, "No project directory")
            return try {
                val url = safFs.renameImage(tree, name, dir, newName)
                jsonData(JSONObject().apply { put("url", url) })
            } catch (e: Exception) {
                Log.w("inb4doc", "renameImage failed $name -> $newName", e)
                jsonError(500, "Rename failed")
            }
        }

        @JavascriptInterface
        fun deleteImage(name: String, dir: String): String {
            val tree = activeTree() ?: return jsonError(400, "No project directory")
            return try {
                val rel = if (dir.isEmpty()) "image/$name" else "$dir/image/$name"
                val id = safFs.resolve(tree, rel)?.id ?: return jsonError(404, "Not found")
                if (!safFs.delete(tree, id)) return jsonError(500, "Delete failed")
                jsonOk()
            } catch (e: Exception) {
                Log.w("inb4doc", "deleteImage failed $name", e)
                jsonError(500, "Delete failed")
            }
        }

        // Map a markdown image URL to a loadable content:// URI, or null.
        @JavascriptInterface
        fun resolveImage(url: String): String {
            val tree = activeTree() ?: return nullDataJson()
            return try {
                val uri = safFs.resolveImage(tree, url)
                if (uri == null) nullDataJson() else jsonData(uri)
            } catch (e: Exception) {
                Log.w("inb4doc", "resolveImage failed for $url", e)
                nullDataJson()
            }
        }
    }
}
