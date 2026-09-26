<script setup lang="ts">
import type { Position } from '../core/types'
import { sourceColor, toHex } from '../core/palette'

defineProps<{ positions: Position[] }>()
</script>

<template>
  <table class="positions">
    <thead>
      <tr>
        <th>#</th>
        <th>字符</th>
        <th>来源</th>
        <th>x</th>
        <th>y</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="p in positions" :key="p.index">
        <td>{{ p.index }}</td>
        <td>{{ p.ch }}</td>
        <td>
          <span class="swatch" :style="{ background: toHex(sourceColor(p.source)) }" />
          #{{ p.source }}
        </td>
        <td>{{ p.x }}</td>
        <td>0</td>
      </tr>
      <tr v-if="positions.length === 0">
        <td colspan="5" class="muted">（空字串没有位置）</td>
      </tr>
    </tbody>
  </table>
</template>
