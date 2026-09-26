import {
  MAX_DIM,
  MAX_GLYPHS,
  MAX_TEXT,
  MIN_DIM,
  MIN_GLYPHS,
  type Box,
  type ComposeOutcome,
  type Glyph,
  type GlyphDoc,
  type Position,
  type ValidationIssue,
} from './types'

/** 按 Unicode 码位切分（避免代理对被拆成两半）。 */
export function codePoints(s: string): string[] {
  return Array.from(s)
}

function firstCodePoint(ch: string): string {
  return Array.from(ch)[0] ?? ''
}

/** 校验文档级结构：字形数量、统一高度、各字形宽度、位图合法性、字符重复。 */
export function validateDocument(doc: GlyphDoc): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  if (!Number.isInteger(doc.height) || doc.height < MIN_DIM || doc.height > MAX_DIM) {
    issues.push({
      code: 'HEIGHT',
      message: `统一高度必须是 ${MIN_DIM}..${MAX_DIM} 的整数，当前为 ${String(doc.height)}`,
    })
  }

  if (doc.glyphs.length < MIN_GLYPHS || doc.glyphs.length > MAX_GLYPHS) {
    issues.push({
      code: 'GLYPH_COUNT',
      message: `字形数量必须为 ${MIN_GLYPHS}..${MAX_GLYPHS}，当前为 ${doc.glyphs.length}`,
    })
  }

  const seen = new Map<string, number>()
  doc.glyphs.forEach((g, i) => {
    if (!Number.isInteger(g.width) || g.width < MIN_DIM || g.width > MAX_DIM) {
      issues.push({
        code: 'WIDTH',
        message: `第 ${i + 1} 个字宽必须是 ${MIN_DIM}..${MAX_DIM} 的整数，当前为 ${String(g.width)}`,
      })
    }

    if (!Array.isArray(g.pixels) || g.pixels.length !== doc.height) {
      issues.push({
        code: 'ROWS',
        message: `第 ${i + 1} 个字的位图行数必须等于统一高度 ${doc.height}，当前为 ${g.pixels?.length ?? '?'}`,
      })
    } else {
      const maxRow = Number.isInteger(g.width) && g.width >= MIN_DIM && g.width <= MAX_DIM
        ? 2 ** g.width - 1
        : 2 ** MAX_DIM - 1
      g.pixels.forEach((row, r) => {
        if (!Number.isInteger(row)) {
          issues.push({
            code: 'ROW_INTEGER',
            message: `第 ${i + 1} 个字第 ${r + 1} 行不是整数位掩码：${String(row)}`,
          })
        } else if (row < 0 || row > maxRow) {
          issues.push({
            code: 'ROW_OUT_OF_RANGE',
            message: `第 ${i + 1} 个字第 ${r + 1} 行位图越界（应在 0..0b${maxRow.toString(2)}）：${row}`,
          })
        }
      })
    }

    const key = firstCodePoint(g.ch)
    if (!key) {
      issues.push({ code: 'EMPTY_CHAR', message: `第 ${i + 1} 个字缺少对应字符` })
    } else if (seen.has(key)) {
      issues.push({
        code: 'DUP_CHAR',
        message: `字符 "${key}" 被第 ${seen.get(key)! + 1}、${i + 1} 个字重复绑定`,
      })
    } else {
      seen.set(key, i)
    }
  })

  return issues
}

/** 把一个字形的每行位图转成 BigInt 列掩码（列 c 对应第 c 位）。 */
function glyphMasks(g: Glyph, height: number): bigint[] {
  const masks = new Array<bigint>(height).fill(0n)
  for (let r = 0; r < height; r++) {
    masks[r] = BigInt(g.pixels[r] ?? 0)
  }
  return masks
}

/**
 * 执行排版。
 *
 * 规则：
 * - 首字左边缘 x = 0，y 恒为 0（所有字形同高、顶对齐）。
 * - 此后每字左边缘严格大于前一字左边缘，取「不与任何已放字形的黑像素重合」
 *   的最小整数 x；空白像素允许互相覆盖，因此字形外框可以交叠。
 * - 碰撞检测对全部已放字形逐行进行（而不是只看上一个字），
 *   避免第三字的笔画撞上第一字的伸出笔画。
 */
export function compose(doc: GlyphDoc, text: string): ComposeOutcome {
  const docIssues = validateDocument(doc)
  const fail = (issues: ValidationIssue[]): ComposeOutcome => ({
    ok: false,
    issues,
    positions: [],
    bbox: null,
    extent: { width: 0, height: Number.isInteger(doc.height) ? doc.height : 0 },
  })
  if (docIssues.length > 0) return fail(docIssues)

  const chars = codePoints(text)
  if (chars.length > MAX_TEXT) {
    return fail([
      { code: 'TEXT_TOO_LONG', message: `字串长度不能超过 ${MAX_TEXT}，当前为 ${chars.length}` },
    ])
  }

  const indexByChar = new Map<string, number>()
  doc.glyphs.forEach((g, i) => indexByChar.set(firstCodePoint(g.ch), i))

  const missing: string[] = []
  for (const ch of chars) {
    if (!indexByChar.has(ch) && !missing.includes(ch)) missing.push(ch)
  }
  if (missing.length > 0) {
    return fail([
      {
        code: 'MISSING_CHAR',
        message: `缺少字符对应字形：${missing.map((c) => `"${c}"`).join('、')}`,
      },
    ])
  }

  const H = doc.height
  const allMasks = doc.glyphs.map((g) => glyphMasks(g, H))

  // occupied[r]：第 r 行上，所有已放置黑像素所在列的 BigInt 位掩码。
  const occupied = new Array<bigint>(H).fill(0n)
  const positions: Position[] = []
  let prevX = -1
  let rightEdge = 0 // 已放置字形外框的最大右边界（列，独占）

  let minC = Infinity
  let maxC = -Infinity
  let minR = Infinity
  let maxR = -Infinity
  let ink = 0

  chars.forEach((ch, index) => {
    const source = indexByChar.get(ch)!
    const g = doc.glyphs[source]
    const masks = allMasks[source]
    const lower = index === 0 ? 0 : prevX + 1

    // x == rightEdge 时新字外框完全位于所有已放外框右侧，必然不碰撞，
    // 因此搜索区间 [lower, rightEdge] 一定有解。
    let x = rightEdge
    for (let candidate = lower; candidate <= rightEdge; candidate++) {
      const shift = BigInt(candidate)
      let collides = false
      for (let r = 0; r < H; r++) {
        if (masks[r] !== 0n && (occupied[r] & (masks[r] << shift)) !== 0n) {
          collides = true
          break
        }
      }
      if (!collides) {
        x = candidate
        break
      }
    }

    const shift = BigInt(x)
    for (let r = 0; r < H; r++) {
      const placed = masks[r] << shift
      occupied[r] |= placed
      if (masks[r] !== 0n) {
        // 局部黑像素列范围
        let lo = 0
        while (((g.pixels[r] >> lo) & 1) === 0) lo++
        let hi = g.width - 1
        while (((g.pixels[r] >> hi) & 1) === 0) hi--
        if (x + lo < minC) minC = x + lo
        if (x + hi > maxC) maxC = x + hi
        if (r < minR) minR = r
        if (r > maxR) maxR = r
        for (let c = lo; c <= hi; c++) ink += (g.pixels[r] >> c) & 1
      }
    }

    positions.push({ index, source, ch, x, y: 0 })
    prevX = x
    if (x + g.width > rightEdge) rightEdge = x + g.width
  })

  let bbox: Box | null = null
  if (ink > 0 && Number.isFinite(minC)) {
    bbox = { x: minC, y: minR, width: maxC - minC + 1, height: maxR - minR + 1 }
  }

  return {
    ok: true,
    issues: [],
    positions,
    bbox,
    extent: { width: rightEdge, height: H },
  }
}
