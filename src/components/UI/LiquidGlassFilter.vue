<script setup lang="ts">
// 液态玻璃 SVG 滤镜生成器
// 基于 vue-web-liquid-glass: Filter.vue
// 使用 canvas 生成真实折射位移图（非 feTurbulence 噪声）

import { computed, ref, watch } from "vue";
import {
  calculateDisplacementMap,
  calculateDisplacementMap2,
  calculateDisplacementMapWithShape,
  type ShapeType,
} from "@/utils/liquidGlass/displacementMap";
import { calculateRefractionSpecular } from "@/utils/liquidGlass/specular";
import { CONVEX, CONVEX_CIRCLE, CONCAVE, LIP } from "@/utils/liquidGlass/surfaceEquations";

interface Props {
  id: string;
  width?: number;
  height?: number;
  radius?: number;
  bezelWidth?: number;
  glassThickness?: number;
  refractiveIndex?: number;
  bezelType?: "convex_circle" | "convex_squircle" | "concave" | "lip";
  blur?: number;
  scaleRatio?: number;
  specularOpacity?: number;
  specularSaturation?: number;
  shape?: ShapeType;
  cornerRadius?: number;
  squircleExponent?: number;
  quality?: number;
}

const props = withDefaults(defineProps<Props>(), {
  width: 150,
  height: 150,
  radius: 75,
  bezelWidth: 40,
  glassThickness: 120,
  refractiveIndex: 1.5,
  bezelType: "convex_squircle",
  blur: 0.2,
  scaleRatio: 1,
  specularOpacity: 0.4,
  specularSaturation: 4,
  shape: "pill",
  cornerRadius: 1.0,
  squircleExponent: 2,
  quality: 2,
});

const displacementMapUrl = ref("");
const specularMapUrl = ref("");
const maxDisplacement = ref(0);

// 防抖定时器 —— 防止 props 频繁变化时过度重算
let regenerateTimeout: ReturnType<typeof setTimeout> | null = null;

function imageDataToDataUrl(imageData: ImageData): string {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

function getSurfaceFn(bezelType: string) {
  switch (bezelType) {
    case "convex_circle":
      return CONVEX_CIRCLE.fn;
    case "convex_squircle":
      return CONVEX.fn;
    case "concave":
      return CONCAVE.fn;
    case "lip":
      return LIP.fn;
    default:
      return CONVEX.fn;
  }
}

function regenerateAssets() {
  const surfaceFn = getSurfaceFn(props.bezelType);
  const precomputedMap = calculateDisplacementMap(
    props.glassThickness,
    props.bezelWidth,
    surfaceFn,
    props.refractiveIndex,
  );
  maxDisplacement.value = Math.max(...precomputedMap.map((x) => Math.abs(x))) || 1;

  let displacementImageData: ImageData;
  if (props.shape && props.shape !== "circle") {
    displacementImageData = calculateDisplacementMapWithShape(
      props.width,
      props.height,
      props.width,
      props.height,
      props.bezelWidth,
      100,
      precomputedMap,
      props.shape,
      props.cornerRadius,
      props.squircleExponent,
      props.quality,
    );
  } else {
    displacementImageData = calculateDisplacementMap2(
      props.width,
      props.height,
      props.width,
      props.height,
      props.radius,
      props.bezelWidth,
      100,
      precomputedMap,
      props.quality,
    );
  }
  displacementMapUrl.value = imageDataToDataUrl(displacementImageData);

  const specularImageData = calculateRefractionSpecular(
    props.width,
    props.height,
    props.radius,
    props.bezelWidth,
    undefined,
    props.quality,
  );
  specularMapUrl.value = imageDataToDataUrl(specularImageData);
}

function debouncedRegenerate() {
  if (regenerateTimeout) clearTimeout(regenerateTimeout);
  regenerateTimeout = setTimeout(() => {
    regenerateAssets();
  }, 16);
}

watch(
  () => [
    props.width,
    props.height,
    props.radius,
    props.bezelWidth,
    props.glassThickness,
    props.refractiveIndex,
    props.bezelType,
    props.shape,
    props.cornerRadius,
    props.squircleExponent,
    props.quality,
  ],
  () => debouncedRegenerate(),
  { immediate: true, deep: true },
);

const scale = computed(() => maxDisplacement.value * props.scaleRatio);
const specularSaturationValue = computed(() => props.specularSaturation.toString());
</script>

<template>
  <svg color-interpolation-filters="sRGB" style="display: none" aria-hidden="true">
    <defs>
      <filter :id="id">
        <!-- 模糊 -->
        <feGaussianBlur in="SourceGraphic" :stdDeviation="blur" result="blurred_source" />
        <!-- 位移图（真实折射） -->
        <feImage
          v-if="displacementMapUrl"
          :href="displacementMapUrl"
          x="0"
          y="0"
          :width="width"
          :height="height"
          result="displacement_map"
        />
        <feDisplacementMap
          in="blurred_source"
          in2="displacement_map"
          :scale="scale"
          xChannelSelector="R"
          yChannelSelector="G"
          result="displaced"
        />
        <!-- 饱和度 -->
        <feColorMatrix in="displaced" type="saturate" :values="specularSaturationValue" result="displaced_saturated" />
        <!-- 高光 -->
        <feImage
          v-if="specularMapUrl"
          :href="specularMapUrl"
          x="0"
          y="0"
          :width="width"
          :height="height"
          result="specular_layer"
        />
        <feComposite in="displaced_saturated" in2="specular_layer" operator="in" result="specular_saturated" />
        <feComponentTransfer in="specular_layer" result="specular_faded">
          <feFuncA type="linear" :slope="specularOpacity" />
        </feComponentTransfer>
        <!-- 混合 -->
        <feBlend in="specular_saturated" in2="displaced" mode="normal" result="withSaturation" />
        <feBlend in="specular_faded" in2="withSaturation" mode="normal" />
      </filter>
    </defs>
  </svg>
</template>
