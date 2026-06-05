<script setup lang="ts">
// 液态玻璃底部导航栏
// 完全匹配 vue-web-liquid-glass: LiquidGlassBottomNavBar.vue 的结构与交互
// 仅替换 Tailwind 为 scoped CSS，图标使用 SPlayer 的 SvgIcon

import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import LiquidGlassFilter from "./LiquidGlassFilter.vue";
import SvgIcon from "@/components/Global/SvgIcon.vue";

interface NavItem {
  id: string;
  label: string;
  icon: string;
}

const props = withDefaults(
  defineProps<{
    modelValue: string;
    items: NavItem[];
    disabled?: boolean;
    specularOpacity?: number;
    specularSaturation?: number;
    blur?: number;
    baseRefraction?: number;
    activeColor?: string;
    alwaysShowGlass?: boolean;
  }>(),
  {
    disabled: false,
    specularOpacity: 0.4,
    specularSaturation: 10,
    blur: 0,
    baseRefraction: -0.4,
    activeColor: "var(--primary-hex)",
    alwaysShowGlass: false,
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

// —— 尺寸预设 ——
const sizePresets = {
  height: 64,
  itemWidth: 90,
  thumbHeight: 58,
  bezelWidth: 8,
  bazelWidthBg: 30,
  glassThickness: 110,
  fontSize: "0.75rem",
  iconSize: 24,
  thumbScale: 1.3,
  thumbScaleY: 1.1,
};

const sliderHeight = computed(() => sizePresets.height);
const itemWidth = computed(() => sizePresets.itemWidth);
const sliderWidth = computed(() => itemWidth.value * props.items.length);
const thumbWidth = computed(() => itemWidth.value - 4);
const thumbHeight = computed(() => sizePresets.thumbHeight);
const thumbRadius = computed(() => thumbHeight.value / 2);
const bezelWidth = computed(() => sizePresets.bezelWidth);
const bazelWidthBg = computed(() => sizePresets.bazelWidthBg);
const glassThickness = computed(() => sizePresets.glassThickness);

// 唯一滤镜 ID
const filterId = `lgl-navbar-${Math.random().toString(36).substring(2, 11)}`;
const bgFilterId = `lgl-navbar-bg-${Math.random().toString(36).substring(2, 11)}`;

// 动画相关常量
const THUMB_REST_SCALE = 1;
const THUMB_ACTIVE_SCALE = sizePresets.thumbScale;
const THUMB_ACTIVE_SCALE_Y = sizePresets.thumbScaleY;

// 内部状态
const internalValue = ref(props.modelValue);
const selectedIndex = computed(() =>
  props.items.findIndex((item) => item.id === internalValue.value),
);
const pointerDown = ref(0);
const initialPointerX = ref(0);
const initialThumbX = ref(0);
const currentThumbX = ref(0);
const isMounted = ref(false);

onMounted(() => {
  isMounted.value = true;
});

watch(
  () => props.modelValue,
  (newVal) => {
    internalValue.value = newVal;
    const index = props.items.findIndex((item) => item.id === newVal);
    if (index !== -1 && pointerDown.value === 0 && !isMounted.value) {
      targetThumbX(index);
    }
  },
  { immediate: true },
);

function targetThumbX(index: number) {
  const centerOffset = (itemWidth.value - thumbWidth.value) / 2;
  const target = index * itemWidth.value + centerOffset;
  currentThumbX.value = target;
}

// 物理动画
const isAnimating = ref(false);
let animationFrame: number;

const glassVisible = ref(false);
let hideGlassTimeout: ReturnType<typeof setTimeout> | null = null;

const wobbleScaleX = ref(1);
const wobbleScaleY = ref(1);

function lerp(start: number, end: number, t: number) {
  return start * (1 - t) + end * t;
}

function updatePhysics() {
  if (pointerDown.value > 0) {
    wobbleScaleX.value = lerp(wobbleScaleX.value, 1, 0.2);
    wobbleScaleY.value = lerp(wobbleScaleY.value, 1, 0.2);
    return;
  }

  const index = selectedIndex.value;
  const centerOffset = (itemWidth.value - thumbWidth.value) / 2;
  const dest = (index === -1 ? 0 : index) * itemWidth.value + centerOffset;

  const diff = dest - currentThumbX.value;
  const newVelocity = diff * 0.5;
  currentThumbX.value += newVelocity;

  const speed = Math.abs(newVelocity);
  const stretchFactor = 1 + Math.min(speed * 0.02, 0.5);
  const squashFactor = 1 / stretchFactor;

  wobbleScaleX.value = lerp(wobbleScaleX.value, stretchFactor, 0.2);
  wobbleScaleY.value = lerp(wobbleScaleY.value, squashFactor, 0.2);

  const isSettled =
    Math.abs(diff) < 0.1 && Math.abs(wobbleScaleX.value - 1) < 0.01;

  if (isSettled) {
    currentThumbX.value = dest;
    wobbleScaleX.value = 1;
    wobbleScaleY.value = 1;
    isAnimating.value = false;
    return;
  }

  animationFrame = requestAnimationFrame(updatePhysics);
}

watch(
  () => internalValue.value,
  () => {
    if (pointerDown.value === 0) {
      isAnimating.value = true;
      cancelAnimationFrame(animationFrame);
      updatePhysics();
    }
  },
);

// 玻璃显示状态：活动时 true，静止时 false
const isActive = computed(() => {
  return (
    props.alwaysShowGlass ||
    pointerDown.value > 0.5 ||
    glassVisible.value
  );
});

// thumb 缩放
const thumbScale = computed(() => {
  const base =
    THUMB_REST_SCALE +
    (THUMB_ACTIVE_SCALE - THUMB_REST_SCALE) * (isActive.value ? 1 : 0);
  return base * wobbleScaleX.value;
});

const thumbScaleY = computed(() => {
  const base =
    THUMB_REST_SCALE +
    (THUMB_ACTIVE_SCALE_Y - THUMB_REST_SCALE) * (isActive.value ? 1 : 0);
  return base * wobbleScaleY.value;
});

// 位移图缩放比
const scaleRatio = computed(() => 0.1);

// —— 事件处理 ——
const handlePointerDown = (e: MouseEvent | TouchEvent) => {
  if (props.disabled) return;

  e.preventDefault();
  e.stopPropagation();

  const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;

  pointerDown.value = 1;
  initialPointerX.value = clientX;
  initialThumbX.value = currentThumbX.value;

  if (hideGlassTimeout) clearTimeout(hideGlassTimeout);
  glassVisible.value = true;

  isAnimating.value = false;
  cancelAnimationFrame(animationFrame);

  window.addEventListener("mousemove", handlePointerMove);
  window.addEventListener("touchmove", handlePointerMove, { passive: false });
  window.addEventListener("mouseup", handlePointerUp);
  window.addEventListener("touchend", handlePointerUp);
};

const handlePointerMove = (e: PointerEvent | TouchEvent | MouseEvent) => {
  if (pointerDown.value === 0) return;
  e.preventDefault();

  const clientX =
    "touches" in e ? e.touches[0].clientX : e.clientX;
  const delta = clientX - initialPointerX.value;
  let newPos = initialThumbX.value + delta;

  const maxPos =
    sliderWidth.value -
    thumbWidth.value -
    (itemWidth.value - thumbWidth.value) / 2;
  const minPos = (itemWidth.value - thumbWidth.value) / 2;

  if (newPos < minPos) {
    const overflow = minPos - newPos;
    newPos = minPos - overflow / 3;
  }
  if (newPos > maxPos) {
    const overflow = newPos - maxPos;
    newPos = maxPos + overflow / 3;
  }

  const velocity = newPos - currentThumbX.value;
  const speed = Math.abs(velocity);
  const stretchFactor = 1 + Math.min(speed * 0.05, 0.4);
  const squashFactor = 1 / stretchFactor;

  wobbleScaleX.value = lerp(wobbleScaleX.value, stretchFactor, 0.2);
  wobbleScaleY.value = lerp(wobbleScaleY.value, squashFactor, 0.2);

  currentThumbX.value = newPos;
};

const handlePointerUp = (e: PointerEvent | TouchEvent | MouseEvent) => {
  pointerDown.value = 0;
  e.preventDefault();
  e.stopPropagation();

  window.removeEventListener("mousemove", handlePointerMove);
  window.removeEventListener("touchmove", handlePointerMove);
  window.removeEventListener("mouseup", handlePointerUp);
  window.removeEventListener("touchend", handlePointerUp);

  const thumbCenter = currentThumbX.value + thumbWidth.value / 2;
  let index = Math.floor(thumbCenter / itemWidth.value);
  index = Math.max(0, Math.min(index, props.items.length - 1));

  const newItem = props.items[index];
  if (newItem && newItem.id !== internalValue.value) {
    internalValue.value = newItem.id;
    emit("update:modelValue", newItem.id);
  }

  isAnimating.value = true;
  updatePhysics();

  hideGlassTimeout = setTimeout(() => {
    glassVisible.value = false;
  }, 280);
};

// 点击导航项（非拖拽）
const handleItemClick = (item: NavItem, e: MouseEvent | TouchEvent) => {
  if (e.preventDefault) e.preventDefault();
  if (e.stopPropagation) e.stopPropagation();

  if (internalValue.value !== item.id) {
    internalValue.value = item.id;
    emit("update:modelValue", item.id);

    if (hideGlassTimeout) clearTimeout(hideGlassTimeout);
    glassVisible.value = true;
    hideGlassTimeout = setTimeout(() => {
      glassVisible.value = false;
    }, 280);

    isAnimating.value = true;
    cancelAnimationFrame(animationFrame);
    updatePhysics();
  }
};

onUnmounted(() => {
  cancelAnimationFrame(animationFrame);
  if (hideGlassTimeout) clearTimeout(hideGlassTimeout);
  window.removeEventListener("mousemove", handlePointerMove);
  window.removeEventListener("touchmove", handlePointerMove);
  window.removeEventListener("mouseup", handlePointerUp);
  window.removeEventListener("touchend", handlePointerUp);
});
</script>

<template>
  <!-- 外层容器（与参考项目 class 逻辑一致） -->
  <div
    class="lg-navbar"
    :class="{ 'lg-navbar--disabled': disabled }"
    :style="{
      transform: isActive ? 'scale(1.05)' : 'scale(1)',
      transition: 'transform 0.1s ease-out',
    }"
  >
    <!-- 背景滤镜 -->
    <LiquidGlassFilter
      :id="bgFilterId"
      :width="sliderWidth"
      :height="sliderHeight"
      :radius="sliderHeight / 2"
      :bezel-width="bazelWidthBg"
      :glass-thickness="190"
      :refractive-index="1.3"
      bezel-type="convex_squircle"
      shape="pill"
      :blur="2"
      :scale-ratio="0.4"
      :specular-opacity="1"
      :specular-saturation="19"
    />

    <!-- 指示器滤镜 -->
    <LiquidGlassFilter
      :id="filterId"
      :width="thumbWidth"
      :height="thumbHeight"
      :radius="thumbRadius"
      :bezel-width="bezelWidth"
      :glass-thickness="glassThickness"
      :refractive-index="1.5"
      bezel-type="convex_circle"
      shape="pill"
      :blur="blur"
      :scale-ratio="scaleRatio"
      :specular-opacity="specularOpacity"
      :specular-saturation="specularSaturation"
    />

    <!-- 轨道（Pill 形） -->
    <div
      class="lg-navbar__track"
      :style="{
        width: `${sliderWidth}px`,
        height: `${sliderHeight}px`,
        borderRadius: `${sliderHeight / 2}px`,
      }"
    >
      <!-- 玻璃背景 -->
      <div
        class="lg-navbar__bg"
        :style="{
          borderRadius: `${sliderHeight / 2}px`,
          backdropFilter: `url(#${bgFilterId})`,
          WebkitBackdropFilter: `url(#${bgFilterId})`,
        }"
      ></div>

      <!-- 点击目标层（z-30） -->
      <div class="lg-navbar__click-area">
        <div
          v-for="item in items"
          :key="item.id"
          class="lg-navbar__click-target"
          :style="{ width: `${itemWidth}px` }"
          @mousedown="handleItemClick(item, $event)"
          @touchstart="handleItemClick(item, $event)"
        ></div>
      </div>

      <!-- 玻璃指示块（z-40，在点击目标之上、图标之下） -->
      <div
        class="lg-navbar__thumb"
        :style="{
          height: `${thumbHeight}px`,
          width: `${thumbWidth}px`,
          transform: `translateX(${currentThumbX}px) translateY(-50%) scale(${thumbScale}) scaleY(${thumbScaleY})`,
          top: `${sliderHeight / 2}px`,
          left: 0,
          pointerEvents: 'auto',
        }"
        @mousedown="handlePointerDown"
        @touchstart.stop="handlePointerDown"
      >
        <div class="lg-navbar__thumb-inner">
          <div
            class="lg-navbar__thumb-glass"
            :class="{ 'lg-navbar__thumb-glass--opaque': !isActive }"
            :style="{
              borderRadius: `${thumbRadius}px`,
              backdropFilter: `url(#${filterId})`,
              WebkitBackdropFilter: `url(#${filterId})`,
              transition: 'background-color 0.1s ease, box-shadow 0.1s ease',
            }"
          ></div>
        </div>
      </div>

      <!-- 导航项层（玻璃时在 z-20，静止时在 z-50） -->
      <div
        class="lg-navbar__items"
        :style="{ zIndex: isActive ? 20 : 50 }"
      >
        <div
          v-for="item in items"
          :key="item.id"
          class="lg-navbar__item"
          :style="{
            width: `${itemWidth}px`,
            opacity: internalValue === item.id ? 1 : 0.6,
            transform: internalValue === item.id ? 'scale(1.05)' : 'scale(1)',
            transition: 'all 0.1s ease',
          }"
        >
          <SvgIcon
            :name="item.icon"
            :size="sizePresets.iconSize"
            :style="{
              color:
                internalValue === item.id ? activeColor : 'var(--text-3)',
              marginBottom: '2px',
            }"
          />
          <span
            class="lg-navbar__item-label"
            :style="{
              fontSize: sizePresets.fontSize,
              color:
                internalValue === item.id ? activeColor : 'var(--text-3)',
              fontWeight: 500,
              lineHeight: 1,
              textAlign: 'center',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              transition: 'color 0.1s ease',
            }"
          >
            {{ item.label }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 完全匹配参考项目 Tailwind 类的 scoped CSS */
.lg-navbar {
  display: inline-block;
  user-select: none;
  touch-action: none;
}

.lg-navbar--disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.lg-navbar__track {
  position: relative;
  pointer-events: auto;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
}

.lg-navbar__bg {
  position: absolute;
  inset: 0;
  background-color: rgba(var(--surface-container), 0.6);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
  pointer-events: none;
}

.lg-navbar__click-area {
  position: absolute;
  inset: 0;
  display: flex;
  z-index: 30;
  pointer-events: auto;
}

.lg-navbar__click-target {
  height: 100%;
  cursor: pointer;
  background: rgba(0, 0, 0, 0);
}

.lg-navbar__thumb {
  position: absolute;
  cursor: pointer;
  transition: transform 0.1s ease-out;
  z-index: 40;
}

.lg-navbar__thumb-inner {
  position: relative;
  width: 100%;
  height: 100%;
}

.lg-navbar__thumb-glass {
  position: absolute;
  inset: 0;
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.25), inset 0 -1px 2px rgba(0, 0, 0, 0.1);
}

.lg-navbar__thumb-glass--opaque {
  background-color: rgba(var(--surface-container), 0.85);
}

.lg-navbar__items {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  pointer-events: none;
}

.lg-navbar__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.lg-navbar__item-label {
  display: block;
}
</style>
