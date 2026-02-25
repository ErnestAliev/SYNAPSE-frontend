<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    value: number;
    size?: number;
    strokeWidth?: number;
    color?: string;
    trackColor?: string;
    durationMs?: number;
  }>(),
  {
    size: 72,
    strokeWidth: 4,
    color: '#1058ff',
    trackColor: '#dbe4f3',
    durationMs: 240,
  },
);

const normalizedValue = computed(() => Math.max(0, Math.min(100, Number(props.value) || 0)));
const radius = computed(() => (props.size - props.strokeWidth) / 2);
const circumference = computed(() => 2 * Math.PI * radius.value);
const dashoffset = computed(
  () => circumference.value - (normalizedValue.value / 100) * circumference.value,
);
</script>

<template>
  <span class="profile-progress-ring" :style="{ width: `${size}px`, height: `${size}px` }">
    <svg class="profile-progress-svg" :viewBox="`0 0 ${size} ${size}`" aria-hidden="true">
      <circle
        class="profile-progress-track"
        :cx="size / 2"
        :cy="size / 2"
        :r="radius"
        :stroke-width="strokeWidth"
        :stroke="trackColor"
      />
      <circle
        class="profile-progress-value"
        :cx="size / 2"
        :cy="size / 2"
        :r="radius"
        :stroke-width="strokeWidth"
        :stroke="color"
        :stroke-dasharray="circumference"
        :stroke-dashoffset="dashoffset"
        :transform="`rotate(-90 ${size / 2} ${size / 2})`"
        :style="{ transitionDuration: `${durationMs}ms` }"
      />
    </svg>

    <span class="profile-progress-content">
      <slot />
    </span>
  </span>
</template>

<style scoped>
.profile-progress-ring {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.profile-progress-svg {
  width: 100%;
  height: 100%;
  display: block;
}

.profile-progress-track {
  fill: none;
}

.profile-progress-value {
  fill: none;
  stroke-linecap: round;
  transition-property: stroke-dashoffset;
  transition-timing-function: ease-in-out;
}

.profile-progress-content {
  position: absolute;
  inset: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
</style>
