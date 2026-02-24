<script setup lang="ts">
import CollectionView from './CollectionView.vue';

defineProps<{
  type: string;
}>();
</script>

<template>
  <CollectionView :type="type" />
</template>
