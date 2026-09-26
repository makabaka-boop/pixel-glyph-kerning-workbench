<script setup lang="ts">
import { computed } from 'vue'
import type { Composite } from '../core/composite'
import { toHex } from '../core/palette'
import type { Box, Position } from '../core/types'

const props = defineProps<{
  comp: Composite
  positions: Position[]
  bbox: Box | null
  /** SVG 中每个像素格的边长。 */
  cell?: number
}>()

const cellSize = computed(() => props.cell ?? 14)

interface Rect {
  x: number
  y: number
  fill: string
}

const rects = computed<Rect[]>(() => {
  const out: Rect[] = []
  for (let r = 0; r < props.comp.height; r++) {
    for (let c = 0; c < props.comp.width; c++) {
      const src = props.comp.cells[r * props.comp.width + c]
      if (src !== null) {
        out.push({ x: c, y: r, fill: toHex(props.comp.colorOf(src)) })
      }
    }
  }
  return out
})

const w = computed(() => Math.max(props.comp.width, 1))
const h = computed(() => Math.max(props.comp.height, 1))
</script>

<template>
  <svg
    :width="w * cellSize + 2"
    :height="h * cellSize + 2"
    :viewBox="`-1 -1 ${w + 2} ${h + 2}`"
    shape-rendering="crispEdges"
  >
    <!-- 网格 -->
    <g stroke="#22262e" stroke-width="0.03">
      <line v-for="x in w + 1" :key="'v' + x" :x1="x - 1" :y1="0" :x2="x - 1" :y2="h" />
      <line v-for="y in h + 1" :key="'h' + y" :x1="0" :y1="y - 1" :x2="w" :y2="y - 1" />
    </g>

    <!-- 每个字符的左边缘参考线与序号 -->
    <g v-for="p in positions" :key="'p' + p.index">
      <line
        :x1="p.x"
        :y1="-1"
        :x2="p.x"
        :y2="h"
        stroke="#5b6577"
        stroke-width="0.05"
        stroke-dasharray="0.18 0.18"
      />
      <text
        :x="p.x + 0.12"
        y="-0.18"
        font-size="0.5"
        fill="#9aa3b2"
      >{{ p.index }}:{{ p.x }}</text>
    </g>

    <!-- 黑像素 -->
    <rect
      v-for="(rc, i) in rects"
      :key="i"
      :x="rc.x"
      :y="rc.y"
      width="1"
      height="1"
      :fill="rc.fill"
    />

    <!-- 黑像素最小包围盒 -->
    <rect
      v-if="bbox"
      :x="bbox.x"
      :y="bbox.y"
      :width="bbox.width"
      :height="bbox.height"
      fill="none"
      stroke="#ffd166"
      stroke-width="0.08"
    />
  </svg>
</template>
