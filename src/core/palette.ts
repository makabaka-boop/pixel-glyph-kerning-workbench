/**
 * 按字形「来源」分配颜色：同一来源（同一字符重复出现）始终得到同一颜色。
 * 调色板为高区分度的分类色，按来源下标循环取色。
 */
export interface RGB {
  r: number
  g: number
  b: number
}

export const PALETTE: RGB[] = [
  { r: 0xe6, g: 0x39, b: 0x46 }, // 红
  { r: 0x1d, g: 0x7a, b: 0xf2 }, // 蓝
  { r: 0x2a, g: 0x9d, b: 0x8f }, // 青绿
  { r: 0xf4, g: 0xa2, b: 0x61 }, // 橙
  { r: 0x7b, g: 0x2c, b: 0xbf }, // 紫
  { r: 0x21, g: 0x9e, b: 0xbc }, // 天蓝
  { r: 0xc7, g: 0x7c, b: 0xff }, // 淡紫
  { r: 0x57, g: 0xcc, b: 0x94 }, // 翠绿
  { r: 0xd4, g: 0xac, b: 0x0d }, // 芥末黄
  { r: 0xe7, g: 0x6f, b: 0x51 }, // 砖橙
  { r: 0x2d, g: 0x6a, b: 0x4f }, // 墨绿
  { r: 0xb5, g: 0x17, b: 0x9e }, // 品红
]

export function sourceColor(source: number): RGB {
  return PALETTE[source % PALETTE.length]
}

export function toHex(c: RGB): string {
  return '#' + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('')
}
