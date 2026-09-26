import type { GlyphDoc } from './types'

/**
 * 测试用朴素参考实现：用 Set<"r,c"> 记录全部已放黑像素，
 * 对每个候选 x 从 prevX+1 起逐个整数偏移、逐像素检查碰撞。
 * 刻意写得最简单直白（不用位掩码），用于和生产实现 layout.compose 对拍。
 */
export interface RefPosition {
  index: number
  source: number
  ch: string
  x: number
}

export interface RefResult {
  positions: RefPosition[]
  bbox: { x: number; y: number; width: number; height: number } | null
  extent: { width: number; height: number }
}

const key = (r: number, c: number) => `${r},${c}`

export function referenceCompose(doc: GlyphDoc, text: string): RefResult {
  const H = doc.height
  const ink = new Set<string>()
  const positions: RefPosition[] = []
  const indexByChar = new Map<string, number>()
  doc.glyphs.forEach((g, i) => indexByChar.set(Array.from(g.ch)[0], i))

  const chars = Array.from(text)
  let prevX: number | null = null
  let rightEdge = 0
  let minC = Infinity
  let maxC = -Infinity
  let minR = Infinity
  let maxR = -Infinity

  chars.forEach((ch, index) => {
    const source = indexByChar.get(ch)!
    const g = doc.glyphs[source]

    const glyphInk: Array<[number, number]> = []
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < g.width; c++) {
        if ((g.pixels[r] >> c) & 1) glyphInk.push([r, c])
      }
    }

    const lower = prevX === null ? 0 : prevX + 1
    let x = lower
    for (;;) {
      let collides = false
      for (const [r, c] of glyphInk) {
        if (ink.has(key(r, x + c))) {
          collides = true
          break
        }
      }
      if (!collides) break
      x++
    }

    for (const [r, c] of glyphInk) {
      ink.add(key(r, x + c))
      if (x + c < minC) minC = x + c
      if (x + c > maxC) maxC = x + c
      if (r < minR) minR = r
      if (r > maxR) maxR = r
    }

    positions.push({ index, source, ch, x })
    prevX = x
    if (x + g.width > rightEdge) rightEdge = x + g.width
  })

  const bbox =
    ink.size === 0
      ? null
      : { x: minC, y: minR, width: maxC - minC + 1, height: maxR - minR + 1 }

  return {
    positions,
    bbox,
    extent: { width: chars.length === 0 ? 0 : rightEdge, height: H },
  }
}
