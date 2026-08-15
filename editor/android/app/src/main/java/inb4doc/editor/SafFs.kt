package inb4doc.editor

import android.content.ContentResolver
import android.net.Uri
import android.provider.DocumentsContract
import android.util.Base64
import java.io.File
import java.io.FileNotFoundException

/**
 * SAF (Storage Access Framework) file layer over a persistable tree Uri.
 *
 * All paths here are project-relative (`docs/guide.md`, `image/logo.png`).
 * `contentResolver` walks `buildChildDocumentsUriUsingTree` from the tree root,
 * creating directories/files via `createDocument` and never touching anything
 * outside the tree. Envelopes (ok/status/error/data) are built by the caller
 * (NativeBridge); this class throws on failure so the caller can map the error.
 *
 * When `ownedRoot` is set and the tree belongs to our own DocsProvider, the
 * doc IS a local File we own (Android/data/<pkg>/docs), so every operation
 * routes straight to the filesystem instead of the SAF protocol. That bypass
 * is the fix for saves failing on the built-in docs tree: the protocol's
 * createDocument round-trip returned null (DocsProvider.call() empty-Bundle
 * branch), and a direct File write to our own app dir is unambiguous. Only
 * user-picked external trees go through the SAF protocol below.
 */
class SafFs(
    private val resolver: ContentResolver,
    private val ownedRoot: File? = null,
) {

    data class Doc(val id: String, val name: String, val mime: String?, val lastModified: Long)

    data class TreeEntry(
        val paths: MutableList<String>,
        val folderWeights: MutableMap<String, Int>,
        val fileWeights: MutableMap<String, Int>,
    )

    data class SearchHit(val path: String, val snippets: List<String>)

    data class ImageEntry(
        val name: String,
        val url: String,
        val storageUrl: String,
        val usedIn: List<String>,
    )

    companion object {
        private val DIR_MIME = DocumentsContract.Document.MIME_TYPE_DIR
        private val IMAGE_EXTS = setOf("png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico")
        private val COLUMNS = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_LAST_MODIFIED,
        )

        fun mimeFor(name: String): String {
            val ext = name.substringAfterLast('.', "").lowercase()
            return when (ext) {
                "md", "markdown", "txt" -> "text/markdown"
                "html", "htm" -> "text/html"
                "css" -> "text/css"
                "js", "mjs" -> "application/javascript"
                "json" -> "application/json"
                "png" -> "image/png"
                "jpg", "jpeg" -> "image/jpeg"
                "gif" -> "image/gif"
                "svg" -> "image/svg+xml"
                "webp" -> "image/webp"
                "ico" -> "image/x-icon"
                else -> "application/octet-stream"
            }
        }

        fun isImageName(name: String): Boolean =
            IMAGE_EXTS.contains(name.substringAfterLast('.', "").lowercase())

        /** Last-resort name guard; the JS side already sanitizes (utils/sanitize.ts). */
        fun sanitizeImageName(raw: String): String {
            val dot = raw.lastIndexOf('.')
            val rawExt = if (dot >= 0) raw.substring(dot).lowercase() else ""
            val extBody = rawExt.removePrefix(".")
            val safeExt = if (extBody in IMAGE_EXTS) rawExt else ".png"
            val baseRaw = if (dot >= 0) raw.substring(0, dot) else raw
            val base = baseRaw.lowercase()
                .replace(Regex("[^a-z0-9]+"), "-")
                .trim('-')
                .take(40)
            val suffix = java.util.UUID.randomUUID().toString().substring(0, 6)
            return "${if (base.isEmpty()) "image" else base}-$suffix$safeExt"
        }
    }

    fun rootDocId(tree: Uri): String = DocumentsContract.getTreeDocumentId(tree)

    // ── Owned-tree (DocsProvider) direct-File path ──────────────────────
    // The built-in docs tree backs our own Android/data/<pkg>/docs dir, so
    // doc ids below are rel paths from ownedRoot (mirroring DocsProvider's
    // fileForId). The canonical-path guard confines every id/relPath to the
    // root, mirroring the provider's confinement.

    private fun isOwned(tree: Uri): Boolean =
        ownedRoot != null && tree.authority == DocsProvider.AUTHORITY

    private fun fileForId(tree: Uri, id: String): File? {
        if (!isOwned(tree)) return null
        if (id.isEmpty() || id == DocsProvider.ROOT_ID) return ownedRoot
        val root = ownedRoot ?: return null
        return File(root, id).canonicalFile.takeIf { it.path.startsWith(root.canonicalFile.path) }
    }

    private fun fileForRel(tree: Uri, relPath: String): File? {
        if (!isOwned(tree)) return null
        val root = ownedRoot ?: return null
        val parts = relPath.split('/').filter { it.isNotEmpty() && it != "." && it != ".." }
        var f = root
        for (p in parts) f = File(f, p)
        return f.canonicalFile.takeIf { it.path.startsWith(root.canonicalFile.path) }
    }

    private fun deleteRecursive(file: File): Boolean {
        if (file.isDirectory) file.listFiles()?.forEach { deleteRecursive(it) }
        return file.delete()
    }

    private fun ownedDocId(parentId: String, name: String): String =
        if (parentId.isEmpty() || parentId == DocsProvider.ROOT_ID) name else "$parentId/$name"

    /** Immediate children of `parentId`, hidden entries (leading `.`) skipped. */
    fun children(tree: Uri, parentId: String): List<Doc> {
        val ownedDir = fileForId(tree, parentId)
        if (ownedDir != null) {
            return ownedDir.listFiles()
                ?.filter { !it.name.startsWith(".") }
                ?.sortedBy { it.name.lowercase() }
                ?.map { f ->
                    val mime = if (f.isDirectory) DIR_MIME else mimeFor(f.name)
                    Doc(ownedDocId(parentId, f.name), f.name, mime, f.lastModified())
                } ?: emptyList()
        }
        val uri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId)
        val out = ArrayList<Doc>()
        resolver.query(uri, COLUMNS, null, null, null)?.use { c ->
            while (c.moveToNext()) {
                val id = c.getString(0) ?: continue
                val name = c.getString(1) ?: continue
                if (name.startsWith(".")) continue
                val mime = c.getString(2)
                val lm = if (c.isNull(3)) 0L else c.getLong(3)
                out.add(Doc(id, name, mime, lm))
            }
        }
        return out
    }

    private fun childrenMap(tree: Uri, parentId: String): Map<String, Doc> =
        children(tree, parentId).associateBy { it.name }

    /** Metadata for a single document id. */
    fun doc(tree: Uri, id: String): Doc? {
        val ownedFile = fileForId(tree, id)
        if (ownedFile != null) {
            if (!ownedFile.exists()) return null
            val mime = if (ownedFile.isDirectory) DIR_MIME else mimeFor(ownedFile.name)
            return Doc(id, ownedFile.name, mime, ownedFile.lastModified())
        }
        val uri = DocumentsContract.buildDocumentUriUsingTree(tree, id)
        resolver.query(uri, COLUMNS, null, null, null)?.use { c ->
            if (c.moveToFirst()) {
                val name = c.getString(1) ?: return null
                val mime = c.getString(2)
                val lm = if (c.isNull(3)) 0L else c.getLong(3)
                return Doc(id, name, mime, lm)
            }
        }
        return null
    }

    /** Resolve a `/`-separated rel path to a document, or null when missing. */
    fun resolve(tree: Uri, relPath: String): Doc? {
        val parts = relPath.split('/').filter { it.isNotEmpty() && it != "." && it != ".." }
        var parentId = rootDocId(tree)
        for (part in parts) {
            val child = childrenMap(tree, parentId)[part] ?: return null
            parentId = child.id
        }
        return doc(tree, parentId)
    }

    fun readText(tree: Uri, id: String): String? {
        val ownedFile = fileForId(tree, id)
        if (ownedFile != null) return if (ownedFile.isFile) ownedFile.readText() else null
        val uri = DocumentsContract.buildDocumentUriUsingTree(tree, id)
        return try {
            resolver.openInputStream(uri)?.use { String(it.readBytes(), Charsets.UTF_8) }
        } catch (e: FileNotFoundException) {
            null
        } catch (e: SecurityException) {
            null
        }
    }

    /** Create (or truncate) `relPath` and write UTF-8 content. */
    fun writeText(tree: Uri, relPath: String, content: String) {
        val ownedFile = fileForRel(tree, relPath)
        if (ownedFile != null) {
            ownedFile.parentFile?.mkdirs()
            ownedFile.writeText(content)
            return
        }
        val parts = relPath.split('/').filter { it.isNotEmpty() && it != "." && it != ".." }
        val name = parts.lastOrNull() ?: throw IllegalArgumentException("empty path")
        var parentId = rootDocId(tree)
        for (dirName in parts.dropLast(1)) parentId = ensureDir(tree, parentId, dirName)
        val docUri = if (childrenMap(tree, parentId)[name] != null) {
            DocumentsContract.buildDocumentUriUsingTree(tree, childrenMap(tree, parentId)[name]!!.id)
        } else {
            DocumentsContract.createDocument(
                resolver,
                DocumentsContract.buildDocumentUriUsingTree(tree, parentId),
                mimeFor(name),
                name,
            ) ?: throw IllegalStateException("createDocument failed for $name")
        }
        val bytes = content.toByteArray(Charsets.UTF_8)
        try {
            resolver.openOutputStream(docUri, "wt")?.use { it.write(bytes) }
                ?: throw IllegalStateException("openOutputStream failed")
        } catch (e: IllegalArgumentException) {
            // Provider without truncate-mode support.
            resolver.openOutputStream(docUri)?.use { it.write(bytes) }
                ?: throw IllegalStateException("openOutputStream failed")
        }
    }

    fun delete(tree: Uri, id: String): Boolean {
        val ownedFile = fileForId(tree, id)
        if (ownedFile != null) return if (ownedFile.exists()) deleteRecursive(ownedFile) else false
        return try {
            DocumentsContract.deleteDocument(
                resolver, DocumentsContract.buildDocumentUriUsingTree(tree, id)
            )
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Delete the given rel paths; returns the parent dir rel paths that may
     * now be empty so the caller can prune. Missing paths are skipped.
     */
    fun deleteRelPaths(tree: Uri, relPaths: List<String>): List<String> {
        val parents = LinkedHashSet<String>()
        for (rel in relPaths) {
            val id = resolve(tree, rel)?.id ?: continue
            delete(tree, id)
            val slash = rel.lastIndexOf('/')
            if (slash > 0) parents.add(rel.substring(0, slash))
        }
        return parents.toList()
    }

    /** Best-effort prune of empty dirs (deepest first), stopping at the root. */
    fun pruneEmptyDirs(tree: Uri, parentRelPaths: List<String>) {
        val rootId = rootDocId(tree)
        for (rel in parentRelPaths.sortedByDescending { it.length }) {
            var cur = rel
            while (cur.isNotEmpty()) {
                val d = resolve(tree, cur) ?: break
                if (d.id == rootId) break
                if (children(tree, d.id).isNotEmpty()) break
                delete(tree, d.id)
                val slash = cur.lastIndexOf('/')
                cur = if (slash > 0) cur.substring(0, slash) else ""
            }
        }
    }

    fun move(tree: Uri, fromRel: String, toRel: String) {
        val srcId = resolve(tree, fromRel)?.id ?: throw FileNotFoundException("Source not found")
        if (resolve(tree, toRel) != null) throw IllegalStateException("Destination exists")
        val content = readText(tree, srcId) ?: throw IllegalStateException("Read failed")
        writeText(tree, toRel, content)
        if (!delete(tree, srcId)) throw IllegalStateException("Delete failed")
    }

    /**
     * Breadth-first walk of the tree. `visitor` receives the rel path, whether
     * it is a directory, and — for `.md` files — its content (null otherwise).
     * Scanning is capped so huge trees degrade instead of hanging.
     */
    fun walkTree(tree: Uri, visitor: (relPath: String, isDir: Boolean, content: String?) -> Unit) {
        val rootId = rootDocId(tree)
        val queue = ArrayDeque<Pair<String, String>>()
        queue.addLast("" to rootId)
        var scanned = 0
        while (queue.isNotEmpty()) {
            if (scanned > 20000) break
            val (rel, parentId) = queue.removeFirst()
            for (child in children(tree, parentId)) {
                if (scanned++ > 20000) break
                val childRel = if (rel.isEmpty()) child.name else "$rel/${child.name}"
                val isDir = child.mime == DIR_MIME
                val content = if (!isDir && child.name.endsWith(".md")) readText(tree, child.id) else null
                visitor(childRel, isDir, content)
                if (isDir) queue.addLast(childRel to child.id)
            }
        }
    }

    fun buildTree(tree: Uri): TreeEntry {
        val result = TreeEntry(mutableListOf(), mutableMapOf(), mutableMapOf())
        walkTree(tree) { rel, isDir, content ->
            if (isDir) {
                val index = resolve(tree, "$rel/_index.md")
                if (index != null) {
                    val w = readText(tree, index.id)?.let { extractWeight(it) }
                    if (w != null) result.folderWeights[rel] = w
                }
            } else if (rel.endsWith(".md")) {
                val display = rel.dropLast(3)
                result.paths.add(display)
                val w = content?.let { extractWeight(it) }
                if (w != null) result.fileWeights[display] = w
            }
        }
        return result
    }

    /** Case-insensitive substring search with snippet extraction (mirrors utils/content-search.ts). */
    fun search(tree: Uri, query: String): List<SearchHit> {
        val q = query.lowercase().trim()
        if (q.isEmpty()) return emptyList()
        val hits = ArrayList<SearchHit>()
        walkTree(tree) { rel, isDir, content ->
            if (isDir || !rel.endsWith(".md") || content == null) return@walkTree
            if (!content.lowercase().contains(q)) return@walkTree
            val snippets = extractSnippets(content, q)
            if (snippets.isNotEmpty()) hits.add(SearchHit(rel.dropLast(3), snippets))
        }
        return hits
    }

    fun listImages(tree: Uri, dir: String, refs: Boolean): List<ImageEntry> {
        val dirDoc = if (dir.isEmpty()) rootDocId(tree) else resolve(tree, dir)?.id
            ?: return emptyList()
        val imageDoc = childrenMap(tree, dirDoc)["image"] ?: return emptyList()
        if (imageDoc.mime != DIR_MIME) return emptyList()
        val names = children(tree, imageDoc.id)
            .filter { it.mime != DIR_MIME && isImageName(it.name) }
            .sortedBy { it.name }
        val usedBy = if (refs) collectImageRefs(tree, dir, names.map { it.name }) else emptyMap()
        return names.map { n ->
            val uri = DocumentsContract.buildDocumentUriUsingTree(tree, n.id).toString()
            val storage = if (dir.isEmpty()) "image/${n.name}" else "$dir/image/${n.name}"
            ImageEntry(n.name, uri, storage, usedBy[n.name] ?: emptyList())
        }
    }

    fun uploadImage(tree: Uri, rawName: String, dir: String, dataB64: String): String {
        val name = sanitizeImageName(rawName)
        val bytes = Base64.decode(dataB64, Base64.DEFAULT)
        val ownedBase = fileForRel(tree, dir)
        if (ownedBase != null) {
            val imageDir = File(ownedBase, "image")
            imageDir.mkdirs()
            File(imageDir, name).writeBytes(bytes)
            return if (dir.isEmpty()) "image/$name" else "$dir/image/$name"
        }
        var parentId = rootDocId(tree)
        for (d in dir.split('/').filter { it.isNotEmpty() && it != "." && it != ".." }) {
            parentId = ensureDir(tree, parentId, d)
        }
        parentId = ensureDir(tree, parentId, "image")
        val existing = childrenMap(tree, parentId)[name]
        val docUri = if (existing != null) {
            DocumentsContract.buildDocumentUriUsingTree(tree, existing.id)
        } else {
            DocumentsContract.createDocument(
                resolver,
                DocumentsContract.buildDocumentUriUsingTree(tree, parentId),
                mimeFor(name),
                name,
            ) ?: throw IllegalStateException("createDocument failed for $name")
        }
        try {
            resolver.openOutputStream(docUri, "wt")?.use { it.write(bytes) }
                ?: throw IllegalStateException("openOutputStream failed")
        } catch (e: IllegalArgumentException) {
            resolver.openOutputStream(docUri)?.use { it.write(bytes) }
                ?: throw IllegalStateException("openOutputStream failed")
        }
        return if (dir.isEmpty()) "image/$name" else "$dir/image/$name"
    }

    /** Rename a committed image file. Copies bytes to a new document, deletes
     *  the old one, and rewrites every `.md` reference to the old name. */
    fun renameImage(tree: Uri, name: String, dir: String, newRawName: String): String {
        val newName = sanitizeImageName(newRawName)
        val relDir = if (dir.isEmpty()) "image" else "$dir/image"
        if (name == newName) {
            return if (dir.isEmpty()) "image/$newName" else "$dir/image/$newName"
        }
        val src = resolve(tree, "$relDir/$name")
            ?: throw FileNotFoundException("Image not found")
        if (resolve(tree, "$relDir/$newName") != null) {
            throw IllegalStateException("Target already exists")
        }
        val ownedBase = fileForRel(tree, relDir)
        if (ownedBase != null) {
            val oldFile = File(ownedBase, name)
            val newFile = File(ownedBase, newName)
            if (!oldFile.isFile) throw FileNotFoundException("Image not found")
            if (newFile.exists()) throw IllegalStateException("Target already exists")
            if (!oldFile.renameTo(newFile)) throw IllegalStateException("Rename failed")
            val oldUrl = if (dir.isEmpty()) "/image/$name" else "/$dir/image/$name"
            val newUrl = if (dir.isEmpty()) "/image/$newName" else "/$dir/image/$newName"
            walkTree(tree) { rel, isDir, content ->
                if (isDir || !rel.endsWith(".md") || content == null) return@walkTree
                val replaced = content.replace(oldUrl, "\u0001")
                    .replace(name, newName)
                    .replace("\u0001", newUrl)
                if (replaced != content) writeText(tree, rel, replaced)
            }
            return newUrl.trimStart('/')
        }
        val bytes = resolver.openInputStream(
            DocumentsContract.buildDocumentUriUsingTree(tree, src.id)
        )?.use { it.readBytes() } ?: throw IllegalStateException("Read failed")

        var parentId = rootDocId(tree)
        for (d in dir.split('/').filter { it.isNotEmpty() && it != "." && it != ".." }) {
            parentId = ensureDir(tree, parentId, d)
        }
        parentId = ensureDir(tree, parentId, "image")
        val targetUri = DocumentsContract.createDocument(
            resolver,
            DocumentsContract.buildDocumentUriUsingTree(tree, parentId),
            mimeFor(newName),
            newName,
        ) ?: throw IllegalStateException("createDocument failed for $newName")
        try {
            resolver.openOutputStream(targetUri, "wt")?.use { it.write(bytes) }
                ?: throw IllegalStateException("openOutputStream failed")
        } catch (e: IllegalArgumentException) {
            resolver.openOutputStream(targetUri)?.use { it.write(bytes) }
                ?: throw IllegalStateException("openOutputStream failed")
        }
        if (!delete(tree, src.id)) throw IllegalStateException("Delete failed")

        val oldUrl = if (dir.isEmpty()) "/image/$name" else "/$dir/image/$name"
        val newUrl = if (dir.isEmpty()) "/image/$newName" else "/$dir/image/$newName"
        walkTree(tree) { rel, isDir, content ->
            if (isDir || !rel.endsWith(".md") || content == null) return@walkTree
            val replaced = content.replace(oldUrl, "\u0001")
                .replace(name, newName)
                .replace("\u0001", newUrl)
            if (replaced != content) writeText(tree, rel, replaced)
        }
        return newUrl.trimStart('/')
    }

    /**
     * Map a markdown image URL back to a loadable content:// URI. Accepts the
     * stable forms the uploader emits (`dir/image/name` or `image/name`, with
     * or without a leading `/`); also passes through content:// URIs that
     * belong to this tree unchanged. Returns null when unresolvable.
     */
    fun resolveImage(tree: Uri, url: String): String? {
        var norm = url.trimStart('/')
        if (norm.startsWith("content://")) {
            val prefix = documentBase(tree)
            return if (norm.startsWith(prefix)) norm else null
        }
        val doc = resolve(tree, norm) ?: return null
        return DocumentsContract.buildDocumentUriUsingTree(tree, doc.id).toString()
    }

    /** `content://<auth>/tree/<treeId>/document/` — every doc under the tree shares it. */
    private fun documentBase(tree: Uri): String {
        val root = DocumentsContract.buildDocumentUriUsingTree(tree, rootDocId(tree))
        val s = root.toString()
        val idx = s.lastIndexOf("/document/")
        return if (idx >= 0) s.substring(0, idx + "/document/".length) else s
    }

    private fun ensureDir(tree: Uri, parentId: String, name: String): String {
        val ownedParent = fileForId(tree, parentId)
        if (ownedParent != null) {
            val dir = File(ownedParent, name)
            if (!dir.exists() && !dir.mkdirs()) throw IllegalStateException("mkdir failed for $name")
            return ownedDocId(parentId, name)
        }
        val existing = childrenMap(tree, parentId)[name]
        if (existing != null) {
            if (existing.mime == DIR_MIME) return existing.id
            throw IllegalStateException("$name exists but is not a directory")
        }
        val created = DocumentsContract.createDocument(
            resolver,
            DocumentsContract.buildDocumentUriUsingTree(tree, parentId),
            DIR_MIME,
            name,
        ) ?: throw IllegalStateException("createDocument failed for $name")
        return DocumentsContract.getDocumentId(created)
    }

    private fun extractWeight(content: String): Int? {
        val fm = Regex("^---\\n([\\s\\S]*?)\\n---").find(content) ?: return null
        val w = Regex("^weight:\\s*(\\d+)", RegexOption.MULTILINE)
            .find(fm.groupValues[1]) ?: return null
        return w.groupValues[1].toIntOrNull()
    }

    private fun extractSnippets(content: String, query: String, max: Int = 3): List<String> {
        val q = query.lowercase()
        val paragraphs = content.split(Regex("\\n\\s*\\n"))
        val out = ArrayList<String>()
        for (p in paragraphs) {
            if (!p.lowercase().contains(q)) continue
            if (p.trim().startsWith("|")) {
                val rows = p.split("\n")
                    .filter { it.trim().startsWith("|") && !it.contains("---") }
                for (row in rows) {
                    val cells = row.split("|").drop(1).dropLast(1).map { it.trim() }
                    for (cell in cells) {
                        if (cell.lowercase().contains(q)) out.add(cell)
                    }
                }
            } else {
                out.add(p.trim())
            }
            if (out.size >= max) break
        }
        return out.take(max)
    }

    private fun collectImageRefs(
        tree: Uri,
        dir: String,
        names: List<String>,
    ): Map<String, List<String>> {
        val out = HashMap<String, MutableList<String>>()
        for (n in names) out[n] = ArrayList()
        val dirDoc = if (dir.isEmpty()) rootDocId(tree) else resolve(tree, dir)?.id
            ?: return out
        for (child in children(tree, dirDoc)) {
            if (child.mime == DIR_MIME || !child.name.endsWith(".md")) continue
            val content = readText(tree, child.id) ?: continue
            val display = child.name.removeSuffix(".md")
            for (n in names) {
                if (content.contains(n, ignoreCase = true)) out[n]?.add(display)
            }
        }
        return out
    }
}
