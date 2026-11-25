package app.onelife.daybook

import java.io.File
import java.io.InputStream
import java.nio.file.Files
import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class BackupTransferTest {
    private val bytes = ByteArray(48 * 1024) { 'x'.code.toByte() }
    private val encoded = Base64.getEncoder().encodeToString(bytes)

    private fun append(upload: BackupUpload, size: Int) {
        repeat(size / bytes.size) { upload.append(encoded) }
        if (size % bytes.size > 0) upload.append(Base64.getEncoder().encodeToString(bytes.copyOf(size % bytes.size)))
    }

    private fun withCache(test: (File) -> Unit) {
        val directory = Files.createTempDirectory("daybook-test").toFile()
        try { test(directory) } finally {
            assertEquals(0, directory.listFiles()!!.size)
            Files.delete(directory.toPath())
        }
    }

    @Test fun ordinaryWriterStopsAt32MiBAndReleasesItsCache() = withCache { dir ->
        BackupUpload(dir).use { upload ->
            append(upload, 32 * 1024 * 1024)
            assertThrows(IllegalArgumentException::class.java) { append(upload, 1) }
            assertThrows(IllegalArgumentException::class.java) { upload.append("a".repeat(65537)) }
        }
    }

    @Test fun ordinaryReaderStopsAt120MillionBytes() {
        val reader = BackupReader()
        var remaining = 120_000_000
        val stream = object : InputStream() {
            override fun read(): Int = error("Expected a bulk read")
            override fun read(destination: ByteArray, off: Int, len: Int): Int {
                val n = if (remaining > 0) minOf(remaining, len) else 1
                bytes.copyInto(destination, off, 0, n)
                remaining -= n
                return n
            }
        }
        reader.open(stream)
        try {
            while (remaining > 0) reader.next()
            assertThrows(IllegalArgumentException::class.java) { reader.next() }
        } finally { reader.close() }
    }

    @Test fun archiveHeaderAcrossMessagesPassesBothNativeLimits() = withCache { dir ->
        val header = "[\"One Life Daybook archive v1\",\n".toByteArray()
        BackupUpload(dir).use { upload ->
            header.forEach { upload.append(Base64.getEncoder().encodeToString(byteArrayOf(it))) }
            append(upload, 120_000_001)
            val reader = BackupReader()
            reader.open(upload.finish())
            try {
                var received = 0L
                while (true) {
                    val chunk = reader.next()
                    if (chunk.isEmpty()) break
                    val decoded = Base64.getDecoder().decode(chunk)
                    if (received == 0L) assertEquals(String(header), String(decoded, 0, header.size))
                    received += decoded.size
                }
                assertEquals(120_000_001L + header.size, received)
            } finally { reader.close() }
        }
    }
}
