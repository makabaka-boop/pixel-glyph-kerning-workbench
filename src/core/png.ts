/**
 * 零依赖 PNG 编码器：8-bit RGBA，每个扫描线使用 filter type 0，
 * IDAT 用 zlib 固定头 + stored（非压缩）块封装，自行计算 CRC32/Adler32。
 * 画布最大约 2560px 宽，非压缩体积可接受，避免引入原生依赖。
 */

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Uint8Array, start = 0, end = buf.length): number {
  let c = 0xffffffff
  for (let i = start; i < end; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function adler32(data: Uint8Array): number {
  let a = 1
  let b = 0
  // 按大块取模防止 32 位溢出（JS 位运算会截成 int32，用普通数值算）
  const N = 5552
  for (let i = 0; i < data.length; i += N) {
    const stop = Math.min(i + N, data.length)
    for (; i < stop; i++) {
      a += data[i]
      b += a
    }
    a %= 65521
    b %= 65521
  }
  return ((b << 16) | a) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length))
  return out
}

function concat(parts: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

/** data 为自左向右、自上而下的 RGBA 字节，长度须等于 width*height*4。 */
export function encodePNG(width: number, height: number, data: Uint8Array): Uint8Array {
  if (data.length !== width * height * 4) {
    throw new Error(`RGBA 数据长度 ${data.length} 与画布 ${width}×${height} 不符`)
  }

  // 原始扫描线：每行前置 filter 字节 0
  const raw = new Uint8Array(height * (1 + width * 4))
  for (let y = 0; y < height; y++) {
    const src = y * width * 4
    raw[src + y] = 0
    raw.set(data.subarray(src, src + width * 4), src + y + 1)
  }

  // zlib 流：CMF=0x78, FLG=0x01（FCHECK 使头部被 31 整除），stored 块
  const MAX_BLOCK = 0xffff
  const blockCount = Math.max(1, Math.ceil(raw.length / MAX_BLOCK))
  const zlib = new Uint8Array(2 + blockCount * 5 + raw.length + 4)
  zlib[0] = 0x78
  zlib[1] = 0x01
  let p = 2
  for (let off = 0; off < raw.length; off += MAX_BLOCK) {
    const len = Math.min(MAX_BLOCK, raw.length - off)
    zlib[p++] = off + len >= raw.length ? 1 : 0 // BFINAL
    zlib[p++] = len & 0xff
    zlib[p++] = (len >> 8) & 0xff
    zlib[p++] = ~len & 0xff
    zlib[p++] = (~len >> 8) & 0xff
    zlib.set(raw.subarray(off, off + len), p)
    p += len
  }
  const adler = adler32(raw)
  const zdv = new DataView(zlib.buffer)
  zdv.setUint32(p, adler)

  const ihdr = new Uint8Array(13)
  const iv = new DataView(ihdr.buffer)
  iv.setUint32(0, width)
  iv.setUint32(4, height)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const idat = chunk('IDAT', zlib)
  const ihdrChunk = chunk('IHDR', ihdr)
  const iend = chunk('IEND', new Uint8Array(0))
  return concat(
    [signature, ihdrChunk, idat, iend],
    signature.length + ihdrChunk.length + idat.length + iend.length,
  )
}
