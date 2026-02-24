<script setup lang="ts">
import { onMounted } from 'vue';
import { useEntitiesStore } from '../stores/entities';

const entitiesStore = useEntitiesStore();

onMounted(async () => {
  if (!entitiesStore.initialized) {
    await entitiesStore.bootstrap();
  }
});
</script>

<template>
  <div class="canvas-view"></div>
</template>

<style scoped>
.canvas-view {
  flex: 1;
  position: relative;
  background-color: var(--bg-app);
  background-image:
    linear-gradient(rgba(112, 144, 176, 0.08) 1px, transparent 1px),
    linear-gradient(90deg, rgba(112, 144, 176, 0.08) 1px, transparent 1px);
  background-size: 40px 40px;
}
</style>
