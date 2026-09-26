import { describe, expect, it } from 'vitest'
import { inflateSync } from 'node:zlib'
import { compose } from './layout'
import { referenceCompose } from './reference'
import { rasterize } from './composite'
import { exportSnapshot, renderRGBA } from './export'
import { validateDocument } from './layout'
import { PALETTE } from './palette'
import type { Glyph, GlyphDoc } from './types'

function glyph(ch: string, width: number, rows: number[]): Glyph {
  return { ch, width, pixels: rows }
}

function doc(height: number, glyphs: Glyph[]): GlyphDoc {
  return { height, glyphs }
}

/** 只与相邻前一字比较的朴素排印（用于复现“第三字撞上第一字”）。 */
function pairwiseOnly(d: GlyphDoc, text: string): number[] {
  const map = new Map<string, Glyph & { source: number }>()
  d.glyphs.forEach((g, source) => map.set(Array.from(g.ch)[0], { ...g, source }))
  const xs: number[] = []
  let prevInk = new Set<string>()
  Array.from(text).forEach((ch, i) => {
    const g = map.get(ch)!
    const own: Array<[number, number]> = []
    for (let r = 0; r < d.height; r++)
      for (let c = 0; c < g.width; c++) if ((g.pixels[r] >> c) & 1) own.push([r, c])
    const lower = i === 0 ? 0 : xs[i - 1] + 1
    let x = lower
    for (;;) {
      if (!own.some(([r, c]) => prevInk.has(`${r},${x + c}`))) break
      x++
    }
    xs.push(x)
    prevInk = new Set(own.map(([r, c]) => `${r},${x + c}`))
  })
  return xs
}

describe('长伸出笔画：必须与全部已放字形比较', () => {
  // H=1：A 宽 5 但只在最右列有黑像素（向右伸出的长笔画）；
  // B 宽 3，三列全黑；C 宽 1 有黑像素。
  const d = doc(1, [
    glyph('A', 5, [0b10000]),
    glyph('B', 3, [0b111]),
    glyph('C', 1, [1]),
  ])

  it('生产实现把 C 推过 A 的伸出笔画', () => {
    const out = compose(d, 'ABC')
    expect(out.ok).toBe(true)
    expect(out.positions.map((p) => p.x)).toEqual([0, 1, 5])
    // A 的黑像素在第 4 列、B 覆盖 1..3、C 在 5；C 在 x=4 会撞 A
    expect(out.bbox).toEqual({ x: 1, y: 0, width: 5, height: 1 })
  })

  it('只看相邻字的算法确实会把 C 放到 4 并与 A 重合（反例存在性）', () => {
    expect(pairwiseOnly(d, 'ABC')).toEqual([0, 1, 4])
  })

  it('最终合成图每个黑像素格只有一个来源', () => {
    const out = compose(d, 'ABC')
    const comp = rasterize(d, out)
    const nonEmpty = comp.cells.filter((c) => c !== null)
    expect(nonEmpty).toHaveLength(5) // A 1 + B 3 + C 1
  })
})

describe('全空字形', () => {
  const d = doc(2, [glyph('A', 3, [0, 0]), glyph('B', 1, [0, 0])])

  it('空白像素允许覆盖：每个字仍严格右移 1，bbox 为 EMPTY', () => {
    const out = compose(d, 'ABA')
    expect(out.ok).toBe(true)
    expect(out.positions.map((p) => p.x)).toEqual([0, 1, 2])
    expect(out.bbox).toBeNull()
    // 外框宽度仍计入：A(3)@0, B(1)@1, A(3)@2 -> 右边界 5
    expect(out.extent).toEqual({ width: 5, height: 2 })

    const snap = exportSnapshot(d, 'ABA', out, rasterize(d, out), { scale: 1, padding: 0 })
    expect(snap.json.bbox).toBe('EMPTY')
  })

  it('空串得到 0×H 覆盖范围与 EMPTY', () => {
    const out = compose(d, '')
    expect(out.positions).toEqual([])
    expect(out.bbox).toBeNull()
    expect(out.extent).toEqual({ width: 0, height: 2 })
  })

  it('字串只含全空字形时 PNG 全透明', () => {
    const out = compose(d, 'BB')
    const { width, height, data } = renderRGBA(rasterize(d, out), {
      scale: 1,
      padding: 0,
      background: null,
    })
    expect([width, height]).toEqual([2, 2]) // B 宽 1，x=0、1
    expect(data.every((v, i) => i % 4 === 3 || v === 0)).toBe(true)
    expect(data.filter((_, i) => i % 4 === 3).every((a) => a === 0)).toBe(true)
  })
})

describe('重复字符共享来源与颜色', () => {
  const d = doc(2, [glyph('A', 1, [1, 0]), glyph('B', 2, [0b10, 0b01])])

  it('positions.source 指向同一字形', () => {
    const out = compose(d, 'ABAB')
    expect(out.positions.map((p) => p.source)).toEqual([0, 1, 0, 1])
    // A@0 黑像素在 col0；B@1 黑像素在局部 col1→全局 col2；
    // 第二个 A 不能放 2（撞 B），落 3；第二个 B 落 4，黑像素在 col5
    expect(out.positions.map((p) => p.x)).toEqual([0, 1, 3, 4])
    const comp = rasterize(d, out)
    expect(comp.cells[0 * comp.width + 0]).toBe(0)
    expect(comp.cells[0 * comp.width + 3]).toBe(0)
    expect(comp.cells[0 * comp.width + 2]).toBe(1)
    expect(comp.cells[0 * comp.width + 5]).toBe(1)
  })
})

describe('逐偏移最小性与全局不相交（穷举断言）', () => {
  function assertSoundLayout(d: GlyphDoc, text: string) {
    const out = compose(d, text)
    expect(out.ok).toBe(true)
    // 数字键 r*W+c，避免大量字符串分配
    const W = Math.max(1, out.extent.width)
    const allInk = new Set<number>()
    let prev = -1
    for (const p of out.positions) {
      // 左边缘严格递增；首字为 0
      expect(p.x).toBeGreaterThan(prev)
      if (p.index === 0) expect(p.x).toBe(0)
      const g = d.glyphs[p.source]
      const own: Array<[number, number]> = []
      for (let r = 0; r < d.height; r++)
        for (let c = 0; c < g.width; c++) if ((g.pixels[r] >> c) & 1) own.push([r, c])
      // 最小性：下界到实际 x 之间的每个候选偏移都必然与某个已放黑像素碰撞
      const lower = p.index === 0 ? 0 : out.positions[p.index - 1].x + 1
      for (let cand = lower; cand < p.x; cand++) {
        const hits = own.some(([r, c]) => allInk.has(r * W + cand + c))
        expect(hits, `第 ${p.index} 字本可放在 x=${cand}`).toBe(true)
      }
      // 全局不相交
      for (const [r, c] of own) {
        const k = r * W + p.x + c
        expect(allInk.has(k), `黑像素重合于 r=${r},c=${p.x + c}`).toBe(false)
        allInk.add(k)
      }
      prev = p.x
    }
    // bbox 与黑像素集合一致
    if (allInk.size === 0) {
      expect(out.bbox).toBeNull()
    } else {
      let minC = Infinity
      let maxC = -Infinity
      let minR = Infinity
      let maxR = -Infinity
      for (const k of allInk) {
        const r = Math.floor(k / W)
        const c = k % W
        if (c < minC) minC = c
        if (c > maxC) maxC = c
        if (r < minR) minR = r
        if (r > maxR) maxR = r
      }
      expect(out.bbox).toEqual({ x: minC, y: minR, width: maxC - minC + 1, height: maxR - minR + 1 })
    }
  }

  it('长伸出笔画场景逐偏移成立', () => {
    const d = doc(1, [glyph('A', 5, [0b10000]), glyph('B', 3, [0b111]), glyph('C', 1, [1])])
    assertSoundLayout(d, 'ABC')
  })

  it('随机字形对拍朴素 Set 实现（逐像素逐偏移）', () => {
    let seed = 0x1234abcd
    const rand = () => {
      seed |= 0
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const ri = (n: number) => Math.floor(rand() * n)
    const alphabet = 'ABCDEFGH'

    for (let trial = 0; trial < 150; trial++) {
      const H = 1 + ri(6)
      const n = 2 + ri(5)
      const gs: Glyph[] = []
      for (let i = 0; i < n; i++) {
        const w = 1 + ri(8)
        const rows = Array.from({ length: H }, () => ri(2 ** w))
        // 刻意制造空白字形与“伸出笔画”（稀疏位图）
        if (rand() < 0.25) rows.fill(0)
        gs.push(glyph(alphabet[i], w, rows))
      }
      const d = doc(H, gs)
      const len = 1 + ri(20)
      let text = ''
      for (let i = 0; i < len; i++) text += alphabet[ri(n)]

      const out = compose(d, text)
      const ref = referenceCompose(d, text)
      expect(out.ok).toBe(true)
      expect(out.positions.map((p) => p.x)).toEqual(ref.positions.map((p) => p.x))
      expect(out.positions.map((p) => p.source)).toEqual(ref.positions.map((p) => p.source))
      expect(out.bbox).toEqual(ref.bbox)
      expect(out.extent).toEqual(ref.extent)
      assertSoundLayout(d, text)
    }
  }, 20000)

  it('字符集较大的 80 长度上限用例', () => {
    const d = doc(
      3,
      Array.from('ABCDEFGHIJKL', (ch, i) =>
        glyph(ch, 4, [i & 1 ? 0b1001 : 0b0110, ri2(i), 0b1111]),
      ),
    )
    function ri2(i: number) {
      return i % 3 === 0 ? 0 : i % 3 === 1 ? 0b1010 : 0b0101
    }
    const text = 'ABCDEFGHIJKL'.repeat(7).slice(0, 80)
    const out = compose(d, text)
    expect(out.ok).toBe(true)
    expect(out.positions).toHaveLength(80)
    assertSoundLayout(d, text)
  })
})

describe('非法输入：保留编辑内容、撤销旧排版（返回失败结果）', () => {
  const good = doc(2, [glyph('A', 2, [0b10, 0b01]), glyph('B', 1, [1, 0])])

  it('缺失字符', () => {
    const out = compose(good, 'AX')
    expect(out.ok).toBe(false)
    expect(out.issues[0].code).toBe('MISSING_CHAR')
    expect(out.positions).toEqual([])
    expect(out.bbox).toBeNull()
  })

  it('位图行越界 / 非整数 / 行数不对', () => {
    expect(validateDocument(doc(1, [glyph('A', 1, [2]), glyph('B', 1, [1])]))[0].code).toBe(
      'ROW_OUT_OF_RANGE',
    )
    expect(
      validateDocument(doc(1, [{ ch: 'A', width: 1, pixels: [NaN] }, glyph('B', 1, [1])]))[0]
        .code,
    ).toBe('ROW_INTEGER')
    expect(validateDocument(doc(2, [glyph('A', 1, [1]), glyph('B', 1, [1])]))[0].code).toBe(
      'ROWS',
    )
    expect(compose(doc(1, [glyph('A', 1, [2]), glyph('B', 1, [1])]), 'A').ok).toBe(false)
  })

  it('宽高越界、数量越界、重复字符、字串过长', () => {
    expect(validateDocument(doc(0, [glyph('A', 1, [0]), glyph('B', 1, [0])]))[0].code).toBe(
      'HEIGHT',
    )
    expect(validateDocument(doc(33, [glyph('A', 1, new Array(33).fill(0)), glyph('B', 1, new Array(33).fill(0))]))[0].code).toBe(
      'HEIGHT',
    )
    expect(validateDocument(doc(1, [glyph('A', 0, [0]), glyph('B', 1, [0])]))[0].code).toBe('WIDTH')
    expect(validateDocument(doc(1, [glyph('A', 33, [0]), glyph('B', 1, [0])]))[0].code).toBe(
      'WIDTH',
    )
    expect(validateDocument(doc(1, [glyph('A', 1, [1]), glyph('A', 1, [1])]))[0].code).toBe(
      'DUP_CHAR',
    )
    expect(validateDocument(doc(1, [glyph('A', 1, [1])]))[0].code).toBe('GLYPH_COUNT')
    const many = Array.from({ length: 41 }, (_, i) =>
      glyph(String.fromCharCode(0x4e00 + i), 1, [0]),
    )
    expect(validateDocument(doc(1, many))[0].code).toBe('GLYPH_COUNT')
    const out = compose(good, 'A'.repeat(81))
    expect(out.ok).toBe(false)
    expect(out.issues[0].code).toBe('TEXT_TOO_LONG')
  })

  it('代理对字符按码位计数（emoji 只算 1 个字符）', () => {
    const d = doc(1, [glyph('😀', 1, [1]), glyph('x', 1, [1])])
    // '😀x' 重复 40 次 = 80 个码位，恰好合法
    expect(compose(d, '😀x'.repeat(40)).ok).toBe(true)
    const over = '😀' + 'x'.repeat(80)
    expect(Array.from(over)).toHaveLength(81)
    expect(compose(d, over).issues[0].code).toBe('TEXT_TOO_LONG')
  })
})

describe('PNG 导出与位置 JSON 同源', () => {
  /** 极简 PNG 解析：校验签名/IHDR，拼接 IDAT 后用 zlib 解压，去 filter 字节。 */
  function decodePNG(bytes: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
    expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    let p = 8
    let width = 0
    let height = 0
    const idat: Uint8Array[] = []
    while (p < bytes.length) {
      const len = new DataView(bytes.buffer, bytes.byteOffset).getUint32(p)
      const type = String.fromCharCode(...bytes.slice(p + 4, p + 8))
      const data = bytes.slice(p + 8, p + 8 + len)
      if (type === 'IHDR') {
        width = new DataView(data.buffer, data.byteOffset).getUint32(0)
        height = new DataView(data.buffer, data.byteOffset).getUint32(4)
        expect(data[8]).toBe(8)
        expect(data[9]).toBe(6)
      }
      if (type === 'IDAT') idat.push(data)
      p += 12 + len
    }
    const raw = inflateSync(concatBuf(idat))
    const stride = width * 4
    const rgba = new Uint8Array(height * stride)
    for (let y = 0; y < height; y++) {
      expect(raw[y * (stride + 1)]).toBe(0)
      rgba.set(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), y * stride)
    }
    return { width, height, rgba }
  }
  function concatBuf(parts: Uint8Array[]): Uint8Array {
    const total = parts.reduce((a, b) => a + b.length, 0)
    const out = new Uint8Array(total)
    let o = 0
    for (const p of parts) {
      out.set(p, o)
      o += p.length
    }
    return out
  }

  it('PNG 每像素颜色等于 JSON 位置指示的来源色，空白处透明', () => {
    const d = doc(2, [glyph('A', 5, [0b10000, 0]), glyph('B', 3, [0b111, 1]), glyph('C', 1, [1, 1])])
    const text = 'ABC'
    const out = compose(d, text)
    const comp = rasterize(d, out)
    const snap = exportSnapshot(d, text, out, comp, { scale: 1, padding: 0, background: null })

    // JSON 与 PNG 取自同一快照
    expect(snap.json.positions.map((p) => p.x)).toEqual(out.positions.map((p) => p.x))
    expect(snap.json.bbox).toEqual(out.bbox)

    const { width, height, rgba } = decodePNG(snap.png)
    expect([width, height]).toEqual([comp.width, comp.height])
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cell = comp.cells[y * width + x]
        const o = (y * width + x) * 4
        if (cell === null) {
          expect(rgba[o + 3]).toBe(0)
        } else {
          const col = PALETTE[cell]
          expect([rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3]]).toEqual([
            col.r,
            col.g,
            col.b,
            255,
          ])
        }
      }
    }
  })

  it('放大与留白生效，白底不透明', () => {
    const d = doc(1, [glyph('A', 1, [1]), glyph('B', 1, [0])])
    const out = compose(d, 'AB')
    const snap = exportSnapshot(d, 'AB', out, rasterize(d, out), {
      scale: 4,
      padding: 2,
      background: { r: 255, g: 255, b: 255 },
    })
    const { width, height, rgba } = decodePNG(snap.png)
    expect([width, height]).toEqual([12, 8]) // 合成宽 2*4+留白 4 = 12, 1*4+4 = 8
    // 角像素白底
    expect([rgba[0], rgba[1], rgba[2], rgba[3]]).toEqual([255, 255, 255, 255])
    // A 的黑块中心 (padding 2..5, y 2..5)
    const o = (3 * width + 3) * 4
    const col = PALETTE[0]
    expect([rgba[o], rgba[o + 1], rgba[o + 2]]).toEqual([col.r, col.g, col.b])
  })
})
