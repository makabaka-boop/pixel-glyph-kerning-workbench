<script setup lang="ts">
import { computed, ref } from 'vue'
import { sourceColor, toHex } from '../core/palette'
import type { Glyph } from '../core/types'
import { codePoints } from '../core/layout'

const props = defineProps<{
  glyph: Glyph
  height: number
  source: number
  active: boolean
  canRemove: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle', r: number, c: number, erase: boolean): void
  (e: 'update:char', value: string): void
  (e: 'update:width', value: number): void
  (e: 'remove'): void
  (e: 'clear'): void
  (e: 'activate'): void
}>()

const rows = computed(() => Array.from({ length: props.height }, (_, r) => r))
const cols = computed(() => Array.from({ length: props.glyph.width }, (_, c) => c))
const inkColor = computed(() => toHex(sourceColor(props.source)))

const chInput = ref(props.glyph.ch)
const syncChar = () => {
  chInput.value = props.glyph.ch
}
const commitChar = () => {
  const cp = codePoints(chInput.value)[0] ?? ''
  chInput.value = cp
  emit('update:char', cp)
}

let painting = false
let eraseMode = false

function down(r: number, c: number, ev: MouseEvent) {
  painting = true
  eraseMode = (ev.button === 2) || ((props.glyph.pixels[r] >> c) & 1) === 1 && ev.button === 0
  emit('activate')
  emit('toggle', r, c, eraseMode)
  ev.preventDefault()
}

function enter(r: number, c: number) {
  if (painting) emit('toggle', r, c, eraseMode)
}

function up() {
  painting = false
}
</script>

<template>
  <div
    class="glyph-editor"
    :class="{ active }"
    :style="{ '--ink': inkColor }"
    @mouseup="up"
    @mouseleave="up"
  >
    <div class="glyph-head">
      <input
        v-model="chInput"
        class="ch"
        maxlength="2"
        @focus="syncChar"
        @change="commitChar"
        @keydown.enter="($event.target as HTMLInputElement).blur()"
      />
      <label class="field">
        宽
        <input
          type="number"
          min="1"
          max="32"
          :value="glyph.width"
          style="width: 56px"
          @change="emit('update:width', Number(($event.target as HTMLInputElement).value))"
        />
      </label>
      <span class="src-tag">
        <span class="swatch" :style="{ background: inkColor }" />来源 #{{ source }}
      </span>
    </div>
    <div
      class="pixel-grid"
      :style="{ gridTemplateColumns: `repeat(${glyph.width}, 18px)` }"
      @contextmenu.prevent
    >
      <template v-for="r in rows" :key="r">
        <div
          v-for="c in cols"
          :key="`${r}-${c}`"
          class="pixel"
          :class="{ on: ((glyph.pixels[r] >> c) & 1) === 1 }"
          @mousedown="down(r, c, $event)"
          @mouseenter="enter(r, c)"
        />
      </template>
    </div>
    <div class="row" style="margin-top: 8px">
      <button @click="emit('clear')">清空</button>
      <button class="danger" :disabled="!canRemove" @click="emit('remove')">删除字形</button>
    </div>
  </div>
</template>
