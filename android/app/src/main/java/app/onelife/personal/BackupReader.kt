package app.onelife.daybook

import java.io.File
import java.io.FilterInputStream
import java.io.InputStream
import java.nio.channels.Channels
import java.nio.channels.FileChannel
import java.nio.file.Files
import java.nio.file.StandardOpenOption
import java.util.Base64

private val archiveHeader = "[\"One Life Daybook archive v1\",\n".toByteArray(Charsets.UTF_8)
private const val LEGACY_MAX_BYTES = 120_000_000L
private const val ORDINARY_EXPORT_BYTES = 32L * 1024 * 1024

internal class BackupByteLimit(private val ordinaryLimit: Long) {
    private var total = 0L
    private var matchesHeader = true

    fun accept(bytes: ByteArray, offset: Int, size: Int) {
        var i = 0
        while (matchesHeader && i < size && total + i < archiveHeader.size) {
            matchesHeader = bytes[offset + i] == archiveHeader[(total + i).toInt()]
            i++
        }
        total += size
        require(matchesHeader || total <= ordinaryLimit) { "This backup is too large." }
    }
}

// Ordinary JSON keeps its historical ceiling. Archive records are validated as
// they arrive in the WebView. Both native directions use the same discriminator.
internal fun backupStream(input: InputStream): InputStream = object : FilterInputStream(input) {
    private val limit = BackupByteLimit(LEGACY_MAX_BYTES)
    override fun read() = super.read().also { if (it >= 0) limit.accept(byteArrayOf(it.toByte()), 0, 1) }
    override fun read(b: ByteArray, off: Int, len: Int) = super.read(b, off, len).also {
        if (it > 0) limit.accept(b, off, it)
    }
}

// The private cache file has no directory entry while it holds user data.
// Closing the descriptors, including on process death, releases the space.
internal class BackupUpload(directory: File) : AutoCloseable {
    private val limit = BackupByteLimit(ORDINARY_EXPORT_BYTES)
    private val output = run {
        val path = Files.createTempFile(directory.toPath(), "daybook-backup-", null)
        try {
            FileChannel.open(path, StandardOpenOption.READ, StandardOpenOption.WRITE, StandardOpenOption.DELETE_ON_CLOSE)
        } catch (error: Exception) {
            Files.deleteIfExists(path)
            throw error
        }
    }
    private val sink = Channels.newOutputStream(output)
    fun append(encoded: String) {
        require(encoded.length in 1..65536)
        val bytes = Base64.getDecoder().decode(encoded)
        limit.accept(bytes, 0, bytes.size)
        sink.write(bytes)
    }
    fun finish(): InputStream {
        output.position(0)
        return Channels.newInputStream(output)
    }
    override fun close() {
        output.close()
    }
}

internal class BackupReader {
    private var source: InputStream? = null
    private val buffer = ByteArray(48 * 1024)

    @Synchronized fun open(input: InputStream) {
        close()
        source = backupStream(input)
    }

    @Synchronized fun next(): String {
        val count = checkNotNull(source).read(buffer)
        if (count < 0) return ""
        return Base64.getEncoder().encodeToString(if (count == buffer.size) buffer else buffer.copyOf(count))
    }

    @Synchronized fun close() {
        source?.close()
        source = null
    }
}
