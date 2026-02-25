<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { CanvasEdgeProjection, CanvasNodeProjection } from '../../types/entity';

const props = withDefaults(
  defineProps<{
    nodes: CanvasNodeProjection[];
    edges: CanvasEdgeProjection[];
    camera: {
      x: number;
      y: number;
      zoom: number;
    };
    activeEdgeId?: string | null;
  }>(),
  {
    activeEdgeId: null,
  },
);

const canvasRef = ref<HTMLCanvasElement | null>(null);
const defaultEdgeColor = '#262626';
let resizeObserver: ResizeObserver | null = null;
let rafId = 0;

function scheduleDraw() {
  if (rafId) return;

  rafId = window.requestAnimationFrame(() => {
    rafId = 0;
    draw();
  });
}

function roundRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const clamped = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + clamped, y);
  context.lineTo(x + width - clamped, y);
  context.quadraticCurveTo(x + width, y, x + width, y + clamped);
  context.lineTo(x + width, y + height - clamped);
  context.quadraticCurveTo(x + width, y + height, x + width - clamped, y + height);
  context.lineTo(x + clamped, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - clamped);
  context.lineTo(x, y + clamped);
  context.quadraticCurveTo(x, y, x + clamped, y);
  context.closePath();
}

function drawArrowAt(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  dirX: number,
  dirY: number,
  color: string,
  scale = 1,
) {
  const arrowLength = 8 * scale;
  const arrowWidth = 5 * scale;
  const tipX = centerX + dirX * arrowLength;
  const tipY = centerY + dirY * arrowLength;
  const baseX = centerX - dirX * arrowLength;
  const baseY = centerY - dirY * arrowLength;
  const normalX = -dirY;
  const normalY = dirX;

  context.beginPath();
  context.moveTo(tipX, tipY);
  context.lineTo(baseX + normalX * arrowWidth, baseY + normalY * arrowWidth);
  context.lineTo(baseX - normalX * arrowWidth, baseY - normalY * arrowWidth);
  context.closePath();
  context.fillStyle = color;
  context.fill();
}

function draw() {
  const canvas = canvasRef.value;
  if (!canvas) return;

  const context = canvas.getContext('2d');
  if (!context) return;

  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const nextWidth = Math.round(rect.width * dpr);
  const nextHeight = Math.round(rect.height * dpr);

  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);
  context.lineCap = 'round';

  const nodeMap = new Map<string, CanvasNodeProjection>();
  for (const node of props.nodes) {
    nodeMap.set(node.id, node);
  }

  for (const edge of props.edges) {
    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);
    if (!sourceNode || !targetNode) continue;

    const sourceX = props.camera.x + sourceNode.x * props.camera.zoom;
    const sourceY = props.camera.y + sourceNode.y * props.camera.zoom;
    const targetX = props.camera.x + targetNode.x * props.camera.zoom;
    const targetY = props.camera.y + targetNode.y * props.camera.zoom;

    const color = edge.color || defaultEdgeColor;
    const isActive = edge.id === props.activeEdgeId;
    const baseLineWidth = Math.max(1.1, 2 * props.camera.zoom);

    context.beginPath();
    context.moveTo(sourceX, sourceY);
    context.lineTo(targetX, targetY);
    context.strokeStyle = color;
    context.lineWidth = isActive ? Math.max(baseLineWidth + 1, 2) : baseLineWidth;

    if (isActive) {
      context.shadowColor = 'rgba(16, 88, 255, 0.35)';
      context.shadowBlur = 12;
    } else {
      context.shadowBlur = 0;
    }
    context.stroke();
    context.shadowBlur = 0;

    const midX = (sourceX + targetX) / 2;
    const midY = (sourceY + targetY) / 2;
    const sourceIsLeft = sourceX < targetX || (sourceX === targetX && sourceY <= targetY);
    const leftNodeX = sourceIsLeft ? sourceX : targetX;
    const leftNodeY = sourceIsLeft ? sourceY : targetY;
    const rightNodeX = sourceIsLeft ? targetX : sourceX;
    const rightNodeY = sourceIsLeft ? targetY : sourceY;
    const leftDx = leftNodeX - midX;
    const leftDy = leftNodeY - midY;
    const rightDx = rightNodeX - midX;
    const rightDy = rightNodeY - midY;
    const leftLength = Math.hypot(leftDx, leftDy) || 1;
    const rightLength = Math.hypot(rightDx, rightDy) || 1;
    const leftUnitX = leftDx / leftLength;
    const leftUnitY = leftDy / leftLength;
    const rightUnitX = rightDx / rightLength;
    const rightUnitY = rightDy / rightLength;
    const chipScale = props.camera.zoom;
    const edgeAngle = Math.atan2(rightNodeY - leftNodeY, rightNodeX - leftNodeX);
    const chipAngle =
      edgeAngle > Math.PI / 2 || edgeAngle < -Math.PI / 2
        ? edgeAngle + Math.PI
        : edgeAngle;

    if (edge.label && edge.label.trim().length > 0) {
      const label = edge.label.trim();
      const fontSize = 12 * chipScale;
      const chipPaddingX = 10 * chipScale;
      const chipHeight = 24 * chipScale;
      context.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      const textWidth = Math.ceil(context.measureText(label).width);
      const rectWidth = textWidth + chipPaddingX * 2;
      const rectHeight = chipHeight;
      const rectX = -rectWidth / 2;
      const rectY = -rectHeight / 2;

      context.save();
      context.translate(midX, midY);
      context.rotate(chipAngle);

      roundRectPath(context, rectX, rectY, rectWidth, rectHeight, 6 * chipScale);
      context.fillStyle = color;
      context.fill();

      context.fillStyle = '#ffffff';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(label, 0, 0.5 * chipScale);
      context.restore();

      if (edge.arrowLeft) {
        const arrowOffset = rectWidth / 2 + 12 * chipScale;
        drawArrowAt(
          context,
          midX + leftUnitX * arrowOffset,
          midY + leftUnitY * arrowOffset,
          leftUnitX,
          leftUnitY,
          color,
          chipScale,
        );
      }

      if (edge.arrowRight) {
        const arrowOffset = rectWidth / 2 + 12 * chipScale;
        drawArrowAt(
          context,
          midX + rightUnitX * arrowOffset,
          midY + rightUnitY * arrowOffset,
          rightUnitX,
          rightUnitY,
          color,
          chipScale,
        );
      }
    } else {
      const plusRadius = 10 * chipScale;
      context.beginPath();
      context.arc(midX, midY, plusRadius, 0, Math.PI * 2);
      context.fillStyle = defaultEdgeColor;
      context.fill();

      context.strokeStyle = '#ffffff';
      context.lineWidth = Math.max(1, 1.8 * chipScale);
      context.beginPath();
      context.moveTo(midX - 4 * chipScale, midY);
      context.lineTo(midX + 4 * chipScale, midY);
      context.moveTo(midX, midY - 4 * chipScale);
      context.lineTo(midX, midY + 4 * chipScale);
      context.stroke();
    }
  }
}

watch(
  () => props.nodes,
  () => {
    scheduleDraw();
  },
  { deep: true },
);

watch(
  () => props.edges,
  () => {
    scheduleDraw();
  },
  { deep: true },
);

watch(
  () => props.camera,
  () => {
    scheduleDraw();
  },
  { deep: true },
);

watch(
  () => props.activeEdgeId,
  () => {
    scheduleDraw();
  },
);

onMounted(() => {
  scheduleDraw();
  if (typeof ResizeObserver !== 'undefined' && canvasRef.value) {
    resizeObserver = new ResizeObserver(() => {
      scheduleDraw();
    });
    resizeObserver.observe(canvasRef.value);
  }
});

onBeforeUnmount(() => {
  if (rafId) {
    window.cancelAnimationFrame(rafId);
    rafId = 0;
  }
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
});
</script>

<template>
  <canvas ref="canvasRef" class="edge-layer-canvas" />
</template>

<style scoped>
.edge-layer-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 24;
}
</style>
