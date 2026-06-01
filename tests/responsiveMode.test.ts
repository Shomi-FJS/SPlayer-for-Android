import assert from "node:assert/strict";
import {
  getResponsiveMode,
  getResponsiveModeTransition,
  type ResponsiveMode,
  type ResponsiveModeTransition,
} from "../src/composables/useResponsiveMode";
import { ANDROID_PAD_LAYOUT_MIN_WIDTH, getIsPadLayout } from "../src/composables/useDevice";

const cases: Array<{
  name: string;
  isPadDevice: boolean;
  isLandscape: boolean;
  isPadLayout?: boolean;
  expected: ResponsiveMode;
}> = [
  {
    name: "手机竖屏保持手机竖屏模式",
    isPadDevice: false,
    isLandscape: false,
    expected: "phonePortrait",
  },
  {
    name: "手机横屏使用紧凑横屏模式",
    isPadDevice: false,
    isLandscape: true,
    expected: "phoneLandscape",
  },
  {
    name: "平板竖屏保持移动分页语义",
    isPadDevice: true,
    isLandscape: false,
    expected: "padPortrait",
  },
  {
    name: "平板横屏独立于桌面双栏语义",
    isPadDevice: true,
    isLandscape: true,
    expected: "padLandscape",
  },
  {
    name: "平板小窗横屏回退手机横屏语义",
    isPadDevice: true,
    isLandscape: true,
    isPadLayout: false,
    expected: "phoneLandscape",
  },
];

for (const item of cases) {
  assert.equal(
    getResponsiveMode({
      isPadDevice: item.isPadDevice,
      isLandscape: item.isLandscape,
      isPadLayout: item.isPadLayout,
    }),
    item.expected,
    item.name,
  );
}

console.log(`responsive mode assertions passed: ${cases.length}`);

const transitionCases: Array<{
  name: string;
  from: ResponsiveMode;
  to: ResponsiveMode;
  expected: ResponsiveModeTransition;
}> = [
  {
    name: "手机竖屏到手机横屏标记为转向横屏",
    from: "phonePortrait",
    to: "phoneLandscape",
    expected: "toLandscape",
  },
  {
    name: "手机横屏到手机竖屏标记为转向竖屏",
    from: "phoneLandscape",
    to: "phonePortrait",
    expected: "toPortrait",
  },
  {
    name: "平板竖屏到平板横屏标记为转向横屏",
    from: "padPortrait",
    to: "padLandscape",
    expected: "toLandscape",
  },
  {
    name: "平板横屏到平板竖屏标记为转向竖屏",
    from: "padLandscape",
    to: "padPortrait",
    expected: "toPortrait",
  },
  {
    name: "同一模式不触发切换",
    from: "padLandscape",
    to: "padLandscape",
    expected: "idle",
  },
];

for (const item of transitionCases) {
  assert.equal(
    getResponsiveModeTransition(item.from, item.to),
    item.expected,
    item.name,
  );
}

console.log(`responsive transition assertions passed: ${transitionCases.length}`);

const padLayoutCases: Array<{
  name: string;
  isPadDevice: boolean;
  width: number;
  height: number;
  expected: boolean;
}> = [
  {
    name: "Galaxy Tab S6 竖屏保持手机式布局",
    isPadDevice: true,
    width: 800,
    height: 1280,
    expected: false,
  },
  {
    name: "Galaxy Tab S6 横屏使用平板布局",
    isPadDevice: true,
    width: 1280,
    height: 800,
    expected: true,
  },
  {
    name: "平板小窗横屏但宽度不足时保持手机式布局",
    isPadDevice: true,
    width: ANDROID_PAD_LAYOUT_MIN_WIDTH - 1,
    height: 500,
    expected: false,
  },
  {
    name: "平板小窗宽度足够时允许平板布局",
    isPadDevice: true,
    width: ANDROID_PAD_LAYOUT_MIN_WIDTH,
    height: 600,
    expected: true,
  },
  {
    name: "手机横屏不进入平板布局",
    isPadDevice: false,
    width: 932,
    height: 430,
    expected: false,
  },
];

for (const item of padLayoutCases) {
  assert.equal(
    getIsPadLayout({
      isPadDevice: item.isPadDevice,
      effectiveWidth: item.width,
      effectiveHeight: item.height,
    }),
    item.expected,
    item.name,
  );
}

console.log(`pad layout assertions passed: ${padLayoutCases.length}`);
