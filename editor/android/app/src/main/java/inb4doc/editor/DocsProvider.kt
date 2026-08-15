package inb4doc.editor

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.Bundle
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract
import java.io.File
import java.io.FileNotFoundException

/**
 * Plain ContentProvider over the app's default content dir.
 *
 * The root is the app-specific external `docs/` folder
 * (Android/data/<pkg>/docs — sibling of `files/`, which holds the updater's
 * JsStaticFs, and the mobile equivalent of the desktop default content_root).
 * Exposing it under the DocumentsContract URI protocol lets NativeBridge
 * operate on it with the exact same SafFs layer used for user-picked projects:
 * every path resolves through DocumentsContract queries against this provider,
 * so writeFile/getTree/&c. work before any "Open Project" pick. Access is
 * gated behind a signature-level permission, so only this app can read the
 * tree.
 *
 * This is deliberately NOT a DocumentsProvider: a third-party app cannot host
 * one (DocumentsProvider.attachInfo requires the system-only
 * MANAGE_DOCUMENTS permission and throws SecurityException otherwise, which
 * crashed the app the first time ContentResolver touched this authority). A
 * plain ContentProvider speaks the same URI protocol — tree/document/child
 * URIs answered in query(), create/delete/rename/isChild answered in call() —
 * with no privileged permission involved.
 *
 * URI shapes (as built by DocumentsContract.buildDocumentUriUsingTree /
 * buildChildDocumentsUriUsingTree, used by SafFs):
 *   content://inb4doc.editor.docs/tree/docs                    → root document
 *   content://inb4doc.editor.docs/tree/docs/document/<docId>   → one document
 *   content://inb4doc.editor.docs/tree/docs/document/<docId>/children → children
 *
 * Document IDs are `<rel path from the docs root>` (root ID "docs"); all File
 * resolution is confined to rootDir(). The framework's DocumentsContract
 * helpers pass their payload through ContentResolver.call(authority, ...) with
 * the document URI carried in an extras bundle (modern) or as the call URI /
 * arg (API 24-25); both forms are handled below.
 */
class DocsProvider : ContentProvider() {

    override fun onCreate(): Boolean = true

    /** App-specific external docs dir: Android/data/<pkg>/docs. */
    private fun rootDir(): File {
        val base = context?.getExternalFilesDir(null)?.parentFile ?: context?.filesDir
            ?: return File(".")
        return File(base, "docs")
    }

    /** Map a document ID to a File, refusing anything outside rootDir(). */
    private fun fileForId(documentId: String): File {
        val root = rootDir()
        val rel = documentId.removePrefix("$ROOT_ID/").removePrefix(ROOT_ID)
        if (rel.isEmpty()) return root
        val file = File(root, rel).canonicalFile
        return if (file.path.startsWith(root.canonicalFile.path)) file else root
    }

    private fun docIdOf(parentId: String, name: String): String =
        if (parentId.isEmpty() || parentId == ROOT_ID) name else "$parentId/$name"

    /** Parse a URI in our shape into (documentId, isChildRequest). Null when not ours. */
    private fun parse(uri: Uri): Pair<String, Boolean>? {
        val segments = uri.pathSegments ?: return null
        if (segments.size < 2 || segments[0] != "tree") return null
        var idx = 2
        if (idx >= segments.size) return "" to false // tree root
        if (segments[idx] != "document") return null
        idx++
        val end = if (segments.last() == "children") segments.size - 1 else segments.size
        return segments.subList(idx, end).joinToString("/") to (segments.last() == "children")
    }

    override fun getType(uri: Uri): String? {
        val (docId, _) = parse(uri) ?: return null
        val file = fileForId(docId)
        if (!file.exists()) return null
        return if (file.isDirectory) DocumentsContract.Document.MIME_TYPE_DIR
        else SafFs.mimeFor(file.name)
    }

    override fun query(
        uri: Uri,
        projection: Array<out String>?,
        selection: String?,
        selectionArgs: Array<out String>?,
        sortOrder: String?
    ): Cursor? {
        val (docId, isChildren) = parse(uri) ?: return null
        val cursor = MatrixCursor(projection ?: DOCUMENT_PROJECTION)
        if (isChildren) {
            fileForId(docId)
                .listFiles()
                ?.filter { !it.name.startsWith(".") }
                ?.sortedBy { it.name.lowercase() }
                ?.forEach { addDocRow(cursor, docIdOf(docId, it.name), it) }
            val resolver = context?.contentResolver
            if (resolver != null) cursor.setNotificationUri(resolver, uri)
        } else {
            val file = fileForId(docId)
            if (file.exists()) addDocRow(cursor, if (docId.isEmpty() || docId == ROOT_ID) ROOT_ID else docId, file)
        }
        return cursor
    }

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null

    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

    override fun update(
        uri: Uri,
        values: ContentValues?,
        selection: String?,
        selectionArgs: Array<out String>?
    ): Int = 0

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        val (docId, _) = parse(uri) ?: throw FileNotFoundException("Unknown document")
        val file = fileForId(docId)
        if (!file.exists() && !mode.contains("w")) throw FileNotFoundException("No such file")
        file.parentFile?.mkdirs()
        return if (mode.contains("w")) {
            ParcelFileDescriptor.open(
                file,
                ParcelFileDescriptor.MODE_WRITE_ONLY or
                    ParcelFileDescriptor.MODE_CREATE or
                    ParcelFileDescriptor.MODE_TRUNCATE,
            )
        } else {
            ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
        }
    }

    // ── DocumentsContract call protocol ────────────────────────────────
    // The framework's DocumentsContract.createDocument/deleteDocument/&c. are
    // thin wrappers over ContentResolver.call(); the METHOD_* / EXTRA_* keys
    // are @hide framework constants, so they are spelled out here (stable
    // since API 19). Modern versions call with the bare authority URI and
    // carry the document URI in the extras bundle; API 24-25 call with the
    // document/tree URI itself (and sometimes pass the payload as `arg`).

    override fun call(method: String, arg: String?, extras: Bundle?): Bundle? {
        return when (method) {
            METHOD_CREATE_DOCUMENT -> onCreateDocument(uriOf(arg, extras), extras)
            METHOD_DELETE_DOCUMENT -> onDeleteDocument(uriOf(arg, extras))
            METHOD_RENAME_DOCUMENT -> onRenameDocument(uriOf(arg, extras), arg, extras)
            METHOD_IS_CHILD_DOCUMENT -> onIsChildDocument(extras)
            else -> super.call(method, arg, extras)
        }
    }

    private fun uriOf(arg: String?, extras: Bundle?): Uri? =
        extras?.getParcelable<Uri>(KEY_EXTRA_URI) ?: arg?.let { Uri.parse(it) }

    private fun onCreateDocument(parent: Uri?, extras: Bundle?): Bundle {
        val parentId = (parent?.let(::parse))?.first ?: ""
        val name = extras?.getString(KEY_DISPLAY_NAME) ?: return Bundle()
        val parentFile = fileForId(parentId).apply { mkdirs() }
        val mime = extras?.getString(KEY_MIME_TYPE)
        val file = File(parentFile, name)
        if (mime == DocumentsContract.Document.MIME_TYPE_DIR) {
            if (!file.exists()) file.mkdirs()
        } else {
            if (!file.exists()) file.createNewFile()
        }
        val docId = docIdOf(parentId, name)
        return resultBundle(docId)
    }

    private fun onDeleteDocument(target: Uri?): Bundle {
        val (docId, _) = (target?.let(::parse) ?: return Bundle())
        val ok = deleteRecursive(fileForId(docId))
        return Bundle().apply { putBoolean(KEY_RESULT, ok) }
    }

    private fun onRenameDocument(target: Uri?, arg: String?, extras: Bundle?): Bundle {
        val (docId, _) = (target?.let(::parse) ?: return Bundle())
        val newName = extras?.getString(KEY_DISPLAY_NAME) ?: arg ?: return Bundle()
        val file = fileForId(docId)
        val parentId = docId.substringBeforeLast('/', "")
        val renamed = File(file.parentFile ?: rootDir(), newName)
        if (!file.renameTo(renamed)) return Bundle()
        return resultBundle(docIdOf(parentId, newName))
    }

    private fun onIsChildDocument(extras: Bundle?): Bundle {
        val parent = extras?.getParcelable<Uri>(KEY_EXTRA_URI) ?: return Bundle()
        val child = extras?.getParcelable<Uri>(KEY_EXTRA_TARGET_URI) ?: return Bundle()
        val parentId = parse(parent)?.first ?: return Bundle()
        val childId = parse(child)?.first ?: return Bundle()
        val parentRoot = parentId.isEmpty() || parentId == ROOT_ID
        val isChild = parentRoot || (childId.startsWith("$parentId/") && parentId != childId)
        return Bundle().apply { putBoolean(KEY_RESULT, isChild) }
    }

    private fun resultBundle(docId: String): Bundle = Bundle().apply {
        putString(KEY_RESULT, docId)
        putParcelable(KEY_EXTRA_URI, documentUri(docId))
    }

    private fun documentUri(docId: String): Uri =
        Uri.parse("content://$AUTHORITY/tree/$ROOT_ID/document/$docId")

    private fun deleteRecursive(file: File): Boolean {
        if (file.isDirectory) file.listFiles()?.forEach { deleteRecursive(it) }
        return file.delete()
    }

    private fun addDocRow(cursor: MatrixCursor, documentId: String, file: File) {
        val row = cursor.newRow()
        for (name in cursor.columnNames) {
            row.add(
                name,
                when (name) {
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID -> documentId
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME -> file.name
                    DocumentsContract.Document.COLUMN_MIME_TYPE ->
                        if (file.isDirectory) DocumentsContract.Document.MIME_TYPE_DIR
                        else SafFs.mimeFor(file.name)
                    DocumentsContract.Document.COLUMN_LAST_MODIFIED -> file.lastModified()
                    DocumentsContract.Document.COLUMN_SIZE -> file.length()
                    else -> null
                },
            )
        }
    }

    companion object {
        const val AUTHORITY = "inb4doc.editor.docs"
        const val ROOT_ID = "docs"
        const val ROOT_TREE_URI = "content://$AUTHORITY/tree/$ROOT_ID"

        // @hide DocumentsContract constants (stable string values since API 19).
        private const val METHOD_CREATE_DOCUMENT = "android:createDocument"
        private const val METHOD_DELETE_DOCUMENT = "android:deleteDocument"
        private const val METHOD_RENAME_DOCUMENT = "android:renameDocument"
        private const val METHOD_IS_CHILD_DOCUMENT = "android:isChildDocument"
        private const val KEY_EXTRA_URI = "uri"
        private const val KEY_EXTRA_TARGET_URI = "android.content.extra.TARGET_URI"
        private const val KEY_RESULT = "result"
        private const val KEY_MIME_TYPE = "mime_type"
        private const val KEY_DISPLAY_NAME = "display_name"

        private val DOCUMENT_PROJECTION = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_LAST_MODIFIED,
            DocumentsContract.Document.COLUMN_SIZE,
        )
    }
}
