package app.aiebook.reader

import android.app.Activity
import android.content.Intent
import android.provider.OpenableColumns
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.util.Locale
import java.util.UUID

@TauriPlugin
class BookPickerPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun pickBook(invoke: Invoke) {
        val intent = Intent(Intent.ACTION_GET_CONTENT)
        intent.addCategory(Intent.CATEGORY_OPENABLE)
        intent.type = "*/*"
        intent.putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/pdf", "text/plain", "text/markdown", "text/x-markdown"))
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
                require(extension in setOf("pdf", "txt", "md", "markdown"))
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
                invoke.reject("仅支持不超过 512 MB 的 PDF、TXT 和 Markdown 文件")
            }
        }.start()
    }
}
