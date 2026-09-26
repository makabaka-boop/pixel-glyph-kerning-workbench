/**
 * 像素字形排版核心数据结构。
 * 所有字形共享同一高度 H；每个字形宽 1..32、高 1..32（高度等于文档 H）。
 * 位图用每行一个数字表示：bit c = 1 表示第 c 列为黑像素，MSB/LSB 均可，
 * 由具体算法用 (pixels[r] >> c) & 1 统一读取（即列 c 为低位方向）。
 */

export const MIN_GLYPHS = 2
export const MAX_GLYPHS = 40
export const MIN_DIM = 1
export const MAX_DIM = 32
export const MAX_TEXT = 80

export interface Glyph {
  /** 该字形对应的字符（建议单个 Unicode 码位）。 */
  ch: string
  /** 字形宽度（列数），1..32。 */
  width: number
  /**
   * 长度等于文档统一高度 H 的行数组；每行宽度位至少覆盖 width 列。
   * 1 表示黑（ink），0 表示白（空白）。
   */
  pixels: number[]
}

export interface GlyphDoc {
  /** 所有字形共享的统一高度。 */
  height: number
  glyphs: Glyph[]
}

/** 排版后单个字符实例的位置（y 恒为 0，顶对齐）。 */
export interface Position {
  /** 排版序号，从 0 开始。 */
  index: number
  /** 来源字形（文档中的）下标；重复字符共享同一来源与颜色。 */
  source: number
  ch: string
  x: number
  y: 0
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** 排版画布的覆盖范围（包含空白字形与空白像素占用的宽度）。 */
export interface Extent {
  width: number
  height: number
}

export type IssueCode =
  | 'GLYPH_COUNT'
  | 'HEIGHT'
  | 'WIDTH'
  | 'ROWS'
  | 'ROW_INTEGER'
  | 'ROW_OUT_OF_RANGE'
  | 'DUP_CHAR'
  | 'EMPTY_CHAR'
  | 'TEXT_TOO_LONG'
  | 'MISSING_CHAR'

export interface ValidationIssue {
  code: IssueCode
  message: string
}

export interface ComposeOutcome {
  ok: boolean
  issues: ValidationIssue[]
  /** 文档级结构问题（数量、尺寸、位图非法、字符重复等）。 */
  positions: Position[]
  /** 黑像素最小包围盒；无任何黑像素（含空串）时为 null（导出时记为 "EMPTY"）。 */
  bbox: Box | null
  /** 放置覆盖范围；空串时为 0×H。 */
  extent: Extent
}
