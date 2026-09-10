package app.aiebook.reader

import android.app.Activity
import android.webkit.WebView
import android.view.View
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import android.content.Intent
import android.provider.OpenableColumns
import android.provider.DocumentsContract
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.annotation.InvokeArg
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.io.FileNotFoundException
import java.util.Locale
import java.util.UUID
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@InvokeArg
class StatusBarArgs {
    var hidden: Boolean = false
}

@InvokeArg
class CredentialArgs {
    var account: String = ""
    var secret: String? = null
}

@TauriPlugin
class BookPickerPlugin(private val activity: Activity) : Plugin(activity) {
    private val runtimeLock = Any()
    private val credentialLock = Any()

    private fun applyStatusBar(hidden: Boolean) {
        val controller = WindowCompat.getInsetsController(activity.window, activity.window.decorView)
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        if (hidden) controller.hide(WindowInsetsCompat.Type.statusBars())
        else controller.show(WindowInsetsCompat.Type.statusBars())
    }

    override fun load(webView: WebView) {
        activity.runOnUiThread {
            WindowCompat.setDecorFitsSystemWindows(activity.window, false)
            val content = activity.findViewById<View>(android.R.id.content)
            ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
                val safe = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime())
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom)
                WindowInsetsCompat.CONSUMED
            }
            applyStatusBar(activity.getPreferences(0).getBoolean("hide-status-bar", false))
            ViewCompat.requestApplyInsets(content)
        }
    }

    @Command
    fun backgroundApp(invoke: Invoke) {
        activity.runOnUiThread {
            activity.moveTaskToBack(true)
            invoke.resolve(JSObject())
        }
    }

    @Command
    fun statusBar(invoke: Invoke) {
        val args = invoke.parseArgs(StatusBarArgs::class.java)
        activity.runOnUiThread {
            applyStatusBar(args.hidden)
            activity.getPreferences(0).edit().putBoolean("hide-status-bar", args.hidden).apply()
            invoke.resolve(JSObject())
        }
    }

    private fun background(invoke: Invoke, error: String, work: () -> JSObject) {
        Thread {
            try { invoke.resolve(work()) }
            catch (failure: Exception) { invoke.reject(error) }
        }.start()
    }

    @Command
    fun runtimePaths(invoke: Invoke) = background(invoke, "无法准备应用内置 Node 运行时，请重新安装完整安装包") {
        synchronized(runtimeLock) {
            val version = activity.assets.open("node-runtime/version.txt").bufferedReader().use { it.readText().trim() }
            require(version.matches(Regex("v[0-9]+\\.[0-9]+\\.[0-9]+")))
            val root = File(activity.filesDir, "node-runtime/$version")
            val marker = File(root, ".complete")
            val markerVersion = "$version:2"
            if (!marker.isFile || marker.readText() != markerVersion) {
                root.deleteRecursively()
                fun copyAssets(source: String, target: File) {
                    val children = activity.assets.list(source) ?: emptyArray()
                    if (children.isNotEmpty()) {
                        check(target.mkdirs() || target.isDirectory)
                        children.forEach { copyAssets("$source/$it", File(target, it)) }
                    } else {
                        activity.assets.open(source).use { input -> target.outputStream().use { input.copyTo(it) } }
                    }
                }
                copyAssets("node-runtime", root)
                marker.writeText(markerVersion)
            }
            val node = File(activity.applicationInfo.nativeLibraryDir, "libnode_runtime.so")
            check(node.isFile && node.canExecute())
            JSObject().put("node", node.absolutePath).put("npm", File(root, "npm/bin/npm-cli.js").absolutePath)
        }
    }

    private fun credentialKey(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val alias = "ai-ebook-provider"
        if (store.containsAlias(alias)) return store.getKey(alias, null) as SecretKey
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }

    @Command
    fun credential(invoke: Invoke) {
        val args = invoke.parseArgs(CredentialArgs::class.java)
        background(invoke, "无法访问系统安全存储，请重新保存 API Key") {
            synchronized(credentialLock) {
                require(args.account.isNotBlank() && args.account.length <= 8192)
                val folder = File(activity.noBackupFilesDir, "credentials")
                check(folder.mkdirs() || folder.isDirectory)
                val name = MessageDigest.getInstance("SHA-256").digest(args.account.toByteArray()).joinToString("") { "%02x".format(it) }
                val file = AtomicFile(File(folder, name))
                val secret = args.secret
                if (secret != null) {
                    require(secret.isNotBlank() && secret.length <= 16384)
                    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                    cipher.init(Cipher.ENCRYPT_MODE, credentialKey())
                    cipher.updateAAD(args.account.toByteArray())
                    val encrypted = cipher.iv + cipher.doFinal(secret.toByteArray())
                    val output = file.startWrite()
                    try { output.write(encrypted); file.finishWrite(output) }
                    catch (failure: Exception) { file.failWrite(output); throw failure }
                    JSObject()
                } else {
                    val encrypted = try { file.readFully() }
                    catch (missing: FileNotFoundException) { return@synchronized JSObject().put("secret", "") }
                    require(encrypted.size in 29..65536)
                    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                    cipher.init(Cipher.DECRYPT_MODE, credentialKey(), GCMParameterSpec(128, encrypted.copyOfRange(0, 12)))
                    cipher.updateAAD(args.account.toByteArray())
                    JSObject().put("secret", String(cipher.doFinal(encrypted.copyOfRange(12, encrypted.size)), Charsets.UTF_8))
                }
            }
        }
    }

    @Command
    fun pickPlugin(invoke: Invoke) {
        startActivityForResult(invoke, Intent(Intent.ACTION_OPEN_DOCUMENT_TREE), "pluginPicked")
    }

    @ActivityCallback
    fun pluginPicked(invoke: Invoke, result: ActivityResult) {
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            invoke.resolve(JSObject())
            return
        }
        background(invoke, "插件目录必须包含 package.json、index.mjs 和 cordis.patch.yml，每个文件最大 2 MB") {
            val folder = File(activity.cacheDir, "plugins/${UUID.randomUUID()}")
            try {
                check(folder.mkdirs())
                val wanted = mutableSetOf("package.json", "index.mjs", "cordis.patch.yml")
                val children = DocumentsContract.buildChildDocumentsUriUsingTree(uri, DocumentsContract.getTreeDocumentId(uri))
                activity.contentResolver.query(children, arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)?.use { cursor ->
                    while (cursor.moveToNext()) {
                        val name = cursor.getString(1)
                        if (!wanted.remove(name)) continue
                        val document = DocumentsContract.buildDocumentUriUsingTree(uri, cursor.getString(0))
                        activity.contentResolver.openInputStream(document)?.use { input ->
                            File(folder, name).outputStream().use { output ->
                                val buffer = ByteArray(65536)
                                var total = 0
                                while (true) {
                                    val count = input.read(buffer)
                                    if (count < 0) break
                                    total += count
                                    require(total <= 2_000_000)
                                    output.write(buffer, 0, count)
                                }
                            }
                        } ?: throw IllegalArgumentException()
                    }
                }
                require(wanted.isEmpty())
                JSObject().put("path", folder.absolutePath)
            } catch (failure: Exception) {
                folder.deleteRecursively()
                throw failure
            }
        }
    }

    @Command
    fun pickBook(invoke: Invoke) {
        val intent = Intent(Intent.ACTION_GET_CONTENT)
        intent.addCategory(Intent.CATEGORY_OPENABLE)
        intent.type = "*/*"
        intent.putExtra(
            Intent.EXTRA_MIME_TYPES,
            arrayOf("application/pdf", "text/plain", "text/markdown", "text/x-markdown", "application/epub+zip"),
        )
        startActivityForResult(invoke, intent, "bookPicked")
    }

    @ActivityCallback
    fun bookPicked(invoke: Invoke, result: ActivityResult) {
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            invoke.resolve(JSObject())
            return
        }
        Thread {
            var target: File? = null
            try {
                val resolver = activity.contentResolver
                val name = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                    if (cursor.moveToFirst()) cursor.getString(0) else null
                } ?: throw IllegalArgumentException()
                val extension = name.substringAfterLast('.', "").lowercase(Locale.ROOT)
                require(extension in setOf("pdf", "txt", "md", "markdown", "epub"))
                require(name.length <= 512)
                val folder = File(activity.cacheDir, "imports")
                folder.mkdirs()
                val destination = File(folder, "${UUID.randomUUID()}.$extension")
                target = destination
                resolver.openInputStream(uri)?.use { input ->
                    destination.outputStream().use { output ->
                        val buffer = ByteArray(65536)
                        var total = 0L
                        while (true) {
                            val count = input.read(buffer)
                            if (count < 0) break
                            total += count
                            require(total <= 512L * 1024 * 1024)
                            output.write(buffer, 0, count)
                        }
                    }
                } ?: throw IllegalArgumentException()
                val book = JSObject()
                book.put("path", destination.absolutePath)
                book.put("name", name)
                val response = JSObject()
                response.put("book", book)
                invoke.resolve(response)
            } catch (error: Exception) {
                target?.delete()
                invoke.reject("仅支持不超过 512 MB 的 PDF、TXT、Markdown 和 EPUB 文件")
            }
        }.start()
    }
}
