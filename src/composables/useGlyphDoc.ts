import { computed, reactive, ref, watch } from 'vue'
import {
  MAX_DIM,
  MAX_GLYPHS,
  MIN_DIM,
  MIN_GLYPHS,
  type Glyph,
  type GlyphDoc,
} from '../core/types'
import { codePoints } from '../core/layout'

const STORAGE_KEY = 'glyph-compose-doc-v1'

/** 默认样例：制造凹口与伸出笔画，演示“外框宽度排版会留缝、只看邻字会撞笔”。 */
function defaultDoc(): GlyphDoc {
  // H=3，字符集合：A 右侧伸出，B 左侧伸出，C 小块
  const H = 3
  return {
    height: H,
    glyphs: [
      { ch: 'A', width: 5, pixels: [0b00001, 0b00001, 0b11111] },
      { ch: 'B', width: 5, pixels: [0b10000, 0b11111, 0b10000] },
      { ch: 'C', width: 3, pixels: [0b111, 0b101, 0b111] },
    ],
  }
}

function clone(doc: GlyphDoc): GlyphDoc {
  return { height: doc.height, glyphs: doc.glyphs.map((g) => ({ ...g, pixels: [...g.pixels] })) }
}

function load(): GlyphDoc {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as GlyphDoc
      if (
        Number.isInteger(parsed.height) &&
        Array.isArray(parsed.glyphs) &&
        parsed.glyphs.every(
          (g) => typeof g.ch === 'string' && Number.isInteger(g.width) && Array.isArray(g.pixels),
        )
      ) {
        return parsed
      }
    }
  } catch {
    // 损坏的存档直接回退默认
  }
  return defaultDoc()
}

export function useGlyphDoc() {
  const doc = reactive<GlyphDoc>(load())
  const text = ref(localStorage.getItem(STORAGE_KEY + ':text') ?? 'ABCAB')

  watch(
    doc,
    (d) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(d))
      } catch {
        // 隐私模式等情况下静默失败
      }
    },
    { deep: true },
  )
  watch(text, (t) => {
    try {
      localStorage.setItem(STORAGE_KEY + ':text', t)
    } catch {
      // ignore
    }
  })

  const glyphCount = computed(() => doc.glyphs.length)
  const canAdd = computed(() => glyphCount.value < MAX_GLYPHS)
  const canRemove = computed(() => glyphCount.value > MIN_GLYPHS)

  function setHeight(h: number) {
    const nh = Math.min(MAX_DIM, Math.max(MIN_DIM, Math.round(h) || MIN_DIM))
    if (nh === doc.height) return
    doc.glyphs.forEach((g) => {
      const rows = g.pixels
      if (nh > rows.length) {
        rows.push(...new Array<number>(nh - rows.length).fill(0))
      } else {
        rows.length = nh
      }
    })
    doc.height = nh
  }

  function addGlyph() {
    if (!canAdd.value) return
    const used = new Set(doc.glyphs.map((g) => codePoints(g.ch)[0]))
    let ch = ''
    for (let code = 0x4e00; code <= 0x9fff; code++) {
      const c = String.fromCodePoint(code)
      if (!used.has(c)) {
        ch = c
        break
      }
    }
    doc.glyphs.push({ ch, width: Math.min(MAX_DIM, doc.height), pixels: new Array(doc.height).fill(0) })
  }

  function removeGlyph(index: number) {
    if (!canRemove.value) return
    doc.glyphs.splice(index, 1)
  }

  function setWidth(index: number, w: number) {
    const g = doc.glyphs[index]
    const nw = Math.min(MAX_DIM, Math.max(MIN_DIM, Math.round(w) || MIN_DIM))
    if (nw === g.width) return
    if (nw < g.width) {
      const mask = 2 ** nw - 1
      g.pixels = g.pixels.map((r) => r & mask)
    }
    g.width = nw
  }

  function setChar(index: number, ch: string) {
    doc.glyphs[index].ch = ch
  }

  function togglePixel(index: number, r: number, c: number, erase: boolean) {
    const g = doc.glyphs[index]
    const bit = 1 << c
    if (erase) g.pixels[r] &= ~bit
    else g.pixels[r] |= bit
  }

  function clearGlyph(index: number) {
    doc.glyphs[index].pixels = new Array(doc.height).fill(0)
  }

  function resetAll() {
    const fresh = defaultDoc()
    doc.height = fresh.height
    doc.glyphs.splice(0, doc.glyphs.length, ...fresh.glyphs.map(cloneGlyph))
    text.value = 'ABCAB'
  }

  function cloneGlyph(g: Glyph): Glyph {
    return { ...g, pixels: [...g.pixels] }
  }

  return {
    doc,
    text,
    canAdd,
    canRemove,
    setHeight,
    addGlyph,
    removeGlyph,
    setWidth,
    setChar,
    togglePixel,
    clearGlyph,
    resetAll,
  }
}
