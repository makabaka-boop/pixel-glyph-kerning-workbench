import { sourceColor, type RGB } from './palette'
import type { ComposeOutcome, GlyphDoc } from './types'

/** 合成画布像素：每个格子记录落在该处的黑像素来源下标；白/无像素为 null。 */
export type Cell = number | null

export interface Composite {
  width: number
  height: number
  cells: Cell[]
  /** 按来源下标取色。 */
  colorOf: (source: number) => RGB
}

/**
 * 由一次排版结果生成合成栅格。
 * 布局保证黑像素之间永不重合，因此每个格子至多有一个来源；
 * 空白像素不写入（允许互相覆盖，覆盖处仍为 null）。
 */
export function rasterize(doc: GlyphDoc, out: ComposeOutcome): Composite {
  const w = Math.max(out.extent.width, 0)
  const h = doc.height
  const cells: Cell[] = new Array<Cell>(w * h).fill(null)

  for (const p of out.positions) {
    const g = doc.glyphs[p.source]
    for (let r = 0; r < h; r++) {
      const row = g.pixels[r]
      if (row === 0) continue
      for (let c = 0; c < g.width; c++) {
        if ((row >> c) & 1) {
          const col = p.x + c
          if (col >= 0 && col < w) cells[r * w + col] = p.source
        }
      }
    }
  }

  return { width: w, height: h, cells, colorOf: sourceColor }
}
