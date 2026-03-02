<script setup lang="ts">
import type { EntityType } from '../../types/entity';

type IconName =
  | EntityType
  | 'plus'
  | 'search'
  | 'back'
  | 'loader'
  | 'pause'
  | 'play'
  | 'square'
  | 'unplug'
  | 'wifi-off'
  | 'shield-check'
  | 'check-circle'
  | 'close';

defineProps<{
  name: IconName;
}>();
</script>

<template>
  <svg
    v-if="name === 'project'"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
  </svg>

  <svg
    v-else-if="name === 'connection'"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path d="M16 2h3a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2h-3" />
    <path d="M8 2H5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h3" />
    <path d="M12 8a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z" />
    <path d="M7.5 18a4.5 4.5 0 0 1 9 0" />
  </svg>

  <svg
    v-else-if="name === 'person'"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>

  <svg
    v-else-if="name === 'company'"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
    <path d="M9 22v-4h6v4" />
    <path d="M8 6h.01" />
    <path d="M16 6h.01" />
    <path d="M12 6h.01" />
    <path d="M12 10h.01" />
    <path d="M12 14h.01" />
  </svg>

  <svg
    v-else-if="name === 'event'"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>

  <svg
    v-else-if="name === 'resource'"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
  </svg>

  <svg
    v-else-if="name === 'goal'"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="6" />
    <circle cx="12" cy="12" r="2" />
  </svg>

  <svg
    v-else-if="name === 'result'"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
    <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
    <path d="M4 22h16" />
    <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
    <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
    <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
  </svg>

  <svg
    v-else-if="name === 'task'"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <polyline points="9 11 12 14 22 4" />
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </svg>

  <svg
    v-else-if="name === 'shape'"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="10" />
  </svg>

  <svg
    v-else-if="name === 'plus'"
    width="24"
    height="24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>

  <svg
    v-else-if="name === 'search'"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>

  <svg
    v-else-if="name === 'back'"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>

  <svg
    v-else-if="name === 'loader'"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <line x1="12" y1="2" x2="12" y2="6" />
    <line x1="12" y1="18" x2="12" y2="22" />
    <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
    <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
    <line x1="2" y1="12" x2="6" y2="12" />
    <line x1="18" y1="12" x2="22" y2="12" />
    <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
    <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
  </svg>

  <svg
    v-else-if="name === 'pause'"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <line x1="10" y1="4" x2="10" y2="20" />
    <line x1="14" y1="4" x2="14" y2="20" />
  </svg>

  <svg
    v-else-if="name === 'play'"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <polygon points="8 5 19 12 8 19 8 5" />
  </svg>

  <svg
    v-else-if="name === 'square'"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <rect x="6" y="6" width="12" height="12" rx="1" />
  </svg>

  <svg
    v-else-if="name === 'unplug'"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path d="M9 2v6" />
    <path d="M15 2v6" />
    <path d="M12 17v5" />
    <path d="M5 8h14a0 0 0 0 1 0 0v1a7 7 0 0 1-14 0V8a0 0 0 0 1 0 0Z" />
    <line x1="8" y1="14" x2="16" y2="6" />
  </svg>

  <svg
    v-else-if="name === 'wifi-off'"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <line x1="2" y1="2" x2="22" y2="22" />
    <path d="M16.72 11.06a10.94 10.94 0 0 1 3.28 2.94" />
    <path d="M5 12.55a11 11 0 0 1 14.08-2.88" />
    <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
    <path d="M1.42 9a16 16 0 0 1 4.7-2.88" />
    <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
    <line x1="12" y1="20" x2="12.01" y2="20" />
  </svg>

  <svg
    v-else-if="name === 'shield-check'"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3z" />
    <path d="m9 12 2 2 4-4" />
  </svg>

  <svg
    v-else-if="name === 'check-circle'"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="m9 12 2 2 4-4" />
  </svg>

  <svg
    v-else-if="name === 'close'"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
</template>
