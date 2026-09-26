<script setup lang="ts">
import { computed, ref } from 'vue'
import { useGlyphDoc } from './composables/useGlyphDoc'
import { compose, codePoints } from './core/layout'
import { rasterize } from './core/composite'
import { exportSnapshot, type LayoutExport } from './core/export'
import { sourceColor, toHex } from './core/palette'
import GlyphEditor from './components/GlyphEditor.vue'
import ComposeCanvas from './components/ComposeCanvas.vue'
import PositionsTable from './components/PositionsTable.vue'
import { MAX_TEXT } from './core/types'

const {
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
} = useGlyphDoc()

const activeSource = ref(0)

const charCount = computed(() => codePoints(text.value).length)

/**
 * 全应用只有这一处调用 compose：PNG 与 JSON 导出都从同一个 snapshot 取值，
 * 保证二者必然来自同一次布局，不会因两次计算间的编辑产生漂移。
 */
const snapshot = computed(() => {
  const out = compose(doc, text.value)
  const comp = out.ok ? rasterize(doc, out) : null
  return { out, comp }
})

const issues = computed(() => snapshot.value.out.issues)
const positions = computed(() => snapshot.value.out.positions)
const bboxLabel = computed(() => {
  const b = snapshot.value.out.bbox
  return b ? `x=${b.x}, y=${b.y}, w=${b.width}, h=${b.height}` : 'EMPTY'
})

const scale = ref(10)

function download(filename: string, bytes: Uint8Array, mime: string) {
  const blob = new Blob([new Uint8Array(bytes)], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function downloadText(filename: string, value: string) {
  download(filename, new TextEncoder().encode(value), 'application/json')
}

function exportPNG() {
  const { out, comp } = snapshot.value
  if (!out.ok || !comp) return
  const snap = exportSnapshot(doc, text.value, out, comp, {
    scale: scale.value,
    padding: 1,
    background: { r: 255, g: 255, b: 255 },
  })
  download('glyph-compose.png', snap.png, 'image/png')
}

function exportJSON() {
  const { out, comp } = snapshot.value
  if (!out.ok || !comp) return
  // 与 PNG 走同一函数、同一 out/comp 快照
  const snap = exportSnapshot(doc, text.value, out, comp, {
    scale: scale.value,
    padding: 1,
    background: { r: 255, g: 255, b: 255 },
  })
  const payload: LayoutExport = snap.json
  downloadText('glyph-layout.json', JSON.stringify(payload, null, 2))
}

function selectGlyph(i: number) {
  activeSource.value = i
}
</script>

<template>
  <h1>Glyph · Compose <span class="badge">离线像素字形排版</span></h1>
  <p class="subtitle">
    同高黑白字形 · 每字左边缘取不与任何已放字形黑像素重合的最小整数 x · 空白允许覆盖 ·
    碰撞检测覆盖全部已放字形（而非仅相邻字）
  </p>

  <div v-if="issues.length > 0" class="issues">
    <div class="title">输入非法或缺少字形 —— 编辑内容已保留，旧排版已撤销：</div>
    <ul>
      <li v-for="(it, i) in issues" :key="i">{{ it.message }}</li>
    </ul>
  </div>

  <section class="panel">
    <h2>文档</h2>
    <div class="row">
      <label class="field">
        统一高度
        <input
          type="number"
          min="1"
          max="32"
          :value="doc.height"
          style="width: 64px"
          @change="setHeight(Number(($event.target as HTMLInputElement).value))"
        />
      </label>
      <span class="badge">{{ doc.glyphs.length }} / 40 个字形</span>
      <button :disabled="!canAdd" @click="addGlyph">＋ 添加字形</button>
      <button class="danger" @click="resetAll">重置为样例</button>
    </div>
  </section>

  <section class="panel">
    <h2>字形编辑（左键绘制 / 右键擦除，可拖笔）</h2>
    <div
      class="grid-2"
      style="grid-template-columns: repeat(auto-fill, minmax(300px, 1fr))"
    >
      <GlyphEditor
        v-for="(g, i) in doc.glyphs"
        :key="i"
        :glyph="g"
        :height="doc.height"
        :source="i"
        :active="activeSource === i"
        :can-remove="canRemove"
        @toggle="(r: number, c: number, erase: boolean) => togglePixel(i, r, c, erase)"
        @update:char="(v: string) => setChar(i, v)"
        @update:width="(v: number) => setWidth(i, v)"
        @remove="removeGlyph(i)"
        @clear="clearGlyph(i)"
        @activate="selectGlyph(i)"
      />
    </div>
  </section>

  <section class="panel">
    <h2>排版字串</h2>
    <div class="row">
      <input
        v-model="text"
        type="text"
        :maxlength="MAX_TEXT * 2"
        placeholder="输入要排版的字符，可重复"
        style="flex: 1; min-width: 240px"
      />
      <span class="counter" :class="{ over: charCount > MAX_TEXT }">
        {{ charCount }} / {{ MAX_TEXT }} 个码位
      </span>
    </div>
  </section>

  <section class="panel">
    <div class="row" style="margin-bottom: 12px">
      <h2 style="margin: 0">合成结果</h2>
      <span class="badge ok" v-if="!issues.length">布局有效</span>
      <span class="badge" v-else>无布局</span>
      <span class="muted" v-if="!issues.length">
        黑像素最小包围盒：<b>{{ bboxLabel }}</b>
        ｜ 放置范围：{{ snapshot.out.extent.width }}×{{ snapshot.out.extent.height }}
      </span>
      <span style="margin-left: auto" />
      <label class="field">
        导出像素
        <input v-model.number="scale" type="number" min="1" max="32" style="width: 64px" />
      </label>
      <button class="primary" :disabled="!!issues.length" @click="exportPNG">导出 PNG</button>
      <button class="primary" :disabled="!!issues.length" @click="exportJSON">导出位置 JSON</button>
    </div>

    <div v-if="snapshot.comp" class="canvas-wrap">
      <ComposeCanvas
        :comp="snapshot.comp"
        :positions="positions"
        :bbox="snapshot.out.bbox"
        :cell="14"
      />
    </div>
    <p v-else class="muted">当前无有效合成图。</p>

    <h2 style="margin-top: 16px">
      全部字形位置
      <span class="muted">（颜色＝字形来源，重复字符同色：
        <span
          v-for="(g, i) in doc.glyphs"
          :key="i"
          class="swatch"
          :style="{ background: toHex(sourceColor(i)) }"
        />）</span>
    </h2>
    <div style="max-height: 260px; overflow: auto">
      <PositionsTable :positions="positions" />
    </div>
  </section>
</template>
