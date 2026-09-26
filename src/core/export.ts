import { type Composite } from './composite'
import { encodePNG } from './png'
import type { Box, ComposeOutcome, GlyphDoc } from './types'

/** 位置 JSON 的导出结构，与 PNG 来自同一次排版快照。 */
export interface LayoutExport {
  height: number
  text: string
  positions: Array<{ index: number; source: number; ch: string; x: number; y: number }>
  /** 黑像素最小包围盒；全空（含空串）时为字符串 "EMPTY"。 */
  bbox: Box | 'EMPTY'
  /** 放置覆盖范围（含空白字形占用宽度）；空串时 0×H。 */
  extent: { width: number; height: number }
  sources: Array<{ source: number; ch: string; width: number }>
}

export function buildLayoutExport(doc: GlyphDoc, text: string, out: ComposeOutcome): LayoutExport {
  return {
    height: doc.height,
    text,
    positions: out.positions.map((p) => ({ ...p, y: p.y as number })),
    bbox: out.bbox ?? 'EMPTY',
    extent: out.extent,
    sources: doc.glyphs.map((g, source) => ({
      source,
      ch: Array.from(g.ch)[0] ?? '',
      width: g.width,
    })),
  }
}

export interface RenderOptions {
  /** 每个像素方块放大倍数（1..32）。 */
  scale?: number
  /** 画布外留白像素（放大后的像素数）。 */
  padding?: number
  /** 背景色；默认不透明白底。传 null 使用透明背景。 */
  background?: { r: number; g: number; b: number } | null
}

/** 将合成栅格渲染为 RGBA 字节（含放大与留白）。 */
export function renderRGBA(comp: Composite, opts: RenderOptions = {}): {
  width: number
  height: number
  data: Uint8Array
} {
  const scale = Math.min(32, Math.max(1, opts.scale ?? 8))
  const padding = Math.max(0, opts.padding ?? 1)
  const bg = opts.background === undefined ? { r: 255, g: 255, b: 255 } : opts.background

  const width = comp.width * scale + padding * 2
  const height = comp.height * scale + padding * 2
  const data = new Uint8Array(width * height * 4)

  const put = (x: number, y: number, r: number, g: number, b: number, a: number) => {
    const o = (y * width + x) * 4
    data[o] = r
    data[o + 1] = g
    data[o + 2] = b
    data[o + 3] = a
  }

  if (bg) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) put(x, y, bg.r, bg.g, bg.b, 255)
    }
  }

  for (let cy = 0; cy < comp.height; cy++) {
    for (let cx = 0; cx < comp.width; cx++) {
      const src = comp.cells[cy * comp.width + cx]
      if (src === null) continue
      const c = comp.colorOf(src)
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          put(padding + cx * scale + sx, padding + cy * scale + sy, c.r, c.g, c.b, 255)
        }
      }
    }
  }

  return { width, height, data }
}

/**
 * 一次排版快照的导出物：PNG 字节与位置 JSON 保证同源。
 * 调用方应先 compose 一次，再把同一个 outcome 同时传入两个导出函数；
 * 此函数把这一步固化，避免 UI 重复计算造成漂移。
 */
export function exportSnapshot(
  doc: GlyphDoc,
  text: string,
  out: ComposeOutcome,
  comp: Composite,
  opts: RenderOptions = {},
): { png: Uint8Array; json: LayoutExport; pngWidth: number; pngHeight: number } {
  const { width, height, data } = renderRGBA(comp, opts)
  return { png: encodePNG(width, height, data), json: buildLayoutExport(doc, text, out), pngWidth: width, pngHeight: height }
}
