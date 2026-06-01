<template>
  <div :style="{ opacity: show ? '0.6' : '0.1' }" class="player-spectrum">
    <canvas ref="canvasRef" :style="{ height: height + 'px' }" class="spectrum-line" />
  </div>
</template>

<script setup lang="ts">
import { usePlayerController } from "@/core/player/PlayerController";

const props = defineProps<{
  show: boolean;
  height?: number;
  radius?: number;
  color?: string;
}>();

const player = usePlayerController();

// canvas
const canvasRef = ref<HTMLCanvasElement | null>(null);
const isKeepDrawing = ref<boolean>(true);

const SKIP_BINS = 10;
const SPECTRUM_GAIN = 0.8;
const FRAME_BASE_MS = 16.67;
const ATTACK_SMOOTHING = 0.36;
const RELEASE_SMOOTHING = 0.12;
const NOISE_FLOOR = 0;
const SPATIAL_SMOOTHING = 0.18;
const MIN_VISIBLE_BAR_HEIGHT = 1;
let cachedCanvasWidth = 0;
let cachedCanvasHeight = 0;
let cachedPixelRatio = 0;
let ctx: CanvasRenderingContext2D | null = null;
let smoothedSpectrumData = new Float32Array(0);
let lastFrameTime = 0;

// 仅尺寸变化时重设 canvas
const updateCanvasSize = () => {
  if (!canvasRef.value) return;
  const targetWidth = Math.min(document.body.clientWidth, 1600);
  const targetHeight = props.height || 80;
  const targetPixelRatio = window.devicePixelRatio || 1;
  if (
    targetWidth !== cachedCanvasWidth ||
    targetHeight !== cachedCanvasHeight ||
    targetPixelRatio !== cachedPixelRatio
  ) {
    canvasRef.value.width = Math.round(targetWidth * targetPixelRatio);
    canvasRef.value.height = Math.round(targetHeight * targetPixelRatio);
    canvasRef.value.style.width = `${targetWidth}px`;
    canvasRef.value.style.height = `${targetHeight}px`;
    cachedCanvasWidth = targetWidth;
    cachedCanvasHeight = targetHeight;
    cachedPixelRatio = targetPixelRatio;
    ctx = canvasRef.value.getContext("2d");
    ctx?.setTransform(targetPixelRatio, 0, 0, targetPixelRatio, 0, 0);
  }
};

const getFrameAlpha = (baseAlpha: number, deltaMs: number) => {
  const normalizedDelta = Math.max(0.5, Math.min(3, deltaMs / FRAME_BASE_MS));
  return 1 - Math.pow(1 - baseAlpha, normalizedDelta);
};

const resetSpectrumSmoothing = () => {
  smoothedSpectrumData = new Float32Array(0);
  lastFrameTime = 0;
};

const updateSmoothedSpectrum = (spectrumData: Uint8Array, deltaMs: number) => {
  const shouldSeed = smoothedSpectrumData.length !== spectrumData.length;
  if (smoothedSpectrumData.length !== spectrumData.length) {
    smoothedSpectrumData = new Float32Array(spectrumData.length);
  }
  const attack = getFrameAlpha(ATTACK_SMOOTHING, deltaMs);
  const release = getFrameAlpha(RELEASE_SMOOTHING, deltaMs);
  for (let i = 0; i < spectrumData.length; i++) {
    const target = spectrumData[i] <= NOISE_FLOOR ? 0 : spectrumData[i];
    if (shouldSeed) {
      smoothedSpectrumData[i] = target;
      continue;
    }
    const current = smoothedSpectrumData[i];
    const alpha = target > current ? attack : release;
    smoothedSpectrumData[i] = current + (target - current) * alpha;
  }
};

const getSmoothedBin = (index: number) => {
  const center = smoothedSpectrumData[index] || 0;
  if (SPATIAL_SMOOTHING <= 0) return center;
  const prev = smoothedSpectrumData[index - 1] ?? center;
  const next = smoothedSpectrumData[index + 1] ?? center;
  return center * (1 - SPATIAL_SMOOTHING) + ((prev + next) / 2) * SPATIAL_SMOOTHING;
};

const drawSpectrum = () => {
  if (!isKeepDrawing.value || !ctx) return;
  const now = performance.now();
  const deltaMs = lastFrameTime > 0 ? now - lastFrameTime : FRAME_BASE_MS;
  lastFrameTime = now;
  const spectrumData = player.getSpectrumData();
  if (!spectrumData) return;
  updateSmoothedSpectrum(spectrumData, deltaMs);
  const dataLen = spectrumData.length - SKIP_BINS;
  if (dataLen <= 0) return;
  const numBars = Math.floor(dataLen / 2.5);
  if (numBars <= 0) return;
  const canvasWidth = cachedCanvasWidth;
  const canvasHeight = cachedCanvasHeight;
  const cornerRadius = props.radius || 2.5;
  const barWidth = canvasWidth / numBars / 2;
  const halfWidth = canvasWidth / 2;
  const drawWidth = barWidth - 3;
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.fillStyle = props.color || "#efefef";

  // 累积所有柱到单 Path 后一次 fill，减少 GPU 状态切换
  ctx.beginPath();
  for (let i = 0; i < numBars; i++) {
    const binValue = getSmoothedBin(i + SKIP_BINS);
    if (binValue <= 0) continue;
    const barHeight = Math.max(
      MIN_VISIBLE_BAR_HEIGHT,
      (binValue / 255) * canvasHeight * SPECTRUM_GAIN,
    );
    const x1 = i * barWidth + halfWidth;
    const x2 = halfWidth - (i + 1) * barWidth;
    const y = canvasHeight - barHeight;
    addRoundRectPath(ctx, x1, y, drawWidth, barHeight, cornerRadius);
    addRoundRectPath(ctx, x2, y, drawWidth, barHeight, cornerRadius);
  }
  ctx.fill();
};

// 追加圆角矩形 sub-path；外层负责 beginPath + fill 批处理
const addRoundRectPath = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) => {
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
};

// 开始绘制频谱
const { pause: pauseDraw, resume: resumeDraw } = useRafFn(
  () => {
    drawSpectrum();
  },
  { immediate: false },
);

const onResize = () => updateCanvasSize();

// 避免重复 acquire/release 撕裂 Java visualizerRefCount
let visualizerHeld = false;
const acquireVis = () => {
  if (visualizerHeld) return;
  visualizerHeld = true;
  void player.acquireVisualizer();
};
const releaseVis = () => {
  if (!visualizerHeld) return;
  visualizerHeld = false;
  resetSpectrumSmoothing();
  player.releaseVisualizer();
};

// 仅 visibility 切换驱动 acquire/release；props.show 只控 CSS opacity，
// 不接入避免 playerMetaShow 高频 toggle 让原生 enableVisualizer 队列堆积导致 flag 错位锁死
const onVisibility = () => {
  if (typeof document === "undefined") return;
  if (document.visibilityState === "visible") {
    if (!isKeepDrawing.value) return;
    acquireVis();
    resumeDraw();
  } else {
    pauseDraw();
    releaseVis();
  }
};

onMounted(() => {
  isKeepDrawing.value = true;
  updateCanvasSize();
  window.addEventListener("resize", onResize);
  document.addEventListener("visibilitychange", onVisibility);
  if (typeof document === "undefined" || document.visibilityState === "visible") {
    acquireVis();
    resumeDraw();
  }
});

watch(() => props.height, () => updateCanvasSize());

onBeforeUnmount(() => {
  isKeepDrawing.value = false;
  pauseDraw();
  resetSpectrumSmoothing();
  window.removeEventListener("resize", onResize);
  document.removeEventListener("visibilitychange", onVisibility);
  releaseVis();
});
</script>

<style lang="scss" scoped>
.player-spectrum {
  position: fixed;
  left: 0;
  bottom: 0;
  width: 100%;
  display: flex;
  flex-direction: row;
  justify-content: center;
  opacity: 0.6;
  z-index: -1;
  pointer-events: none;
  transition: opacity 0.3s;
  mask: linear-gradient(
    90deg,
    hsla(0, 0%, 100%, 0) 0,
    hsla(0, 0%, 100%, 0.6) 10%,
    #fff 15%,
    #fff 85%,
    hsla(0, 0%, 100%, 0.6) 90%,
    hsla(0, 0%, 100%, 0)
  );
  -webkit-mask: linear-gradient(
    90deg,
    hsla(0, 0%, 100%, 0) 0,
    hsla(0, 0%, 100%, 0.6) 10%,
    #fff 15%,
    #fff 85%,
    hsla(0, 0%, 100%, 0.6) 90%,
    hsla(0, 0%, 100%, 0)
  );
  .spectrum-line {
    mask: linear-gradient(
      90deg,
      hsla(0, 0%, 100%, 0) 0,
      hsla(0, 0%, 100%, 0.6) 5%,
      #fff 10%,
      #fff 90%,
      hsla(0, 0%, 100%, 0.6) 95%,
      hsla(0, 0%, 100%, 0)
    );
    -webkit-mask: linear-gradient(
      90deg,
      hsla(0, 0%, 100%, 0) 0,
      hsla(0, 0%, 100%, 0.6) 5%,
      #fff 10%,
      #fff 90%,
      hsla(0, 0%, 100%, 0.6) 95%,
      hsla(0, 0%, 100%, 0)
    );
  }
}
</style>
