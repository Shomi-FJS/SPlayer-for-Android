<script setup lang="ts">
/**
 * 歌词渲染组件 - 基于 @applemusic-like-lyrics/core
 */
import {
  type BaseRenderer,
  LyricPlayer as CoreLyricPlayer,
  type LyricLine,
  type LyricLineMouseEvent,
  type LyricPlayerBase,
  type spring,
} from "@applemusic-like-lyrics/core";
import type { PropType, Ref, ShallowRef } from "vue";
import "@applemusic-like-lyrics/core/style.css";

/**
 * Props 定义
 */
const props = defineProps({
  /**
   * 是否禁用歌词播放组件，默认为 `false`，歌词组件启用后将会开始逐帧更新歌词的动画效果，并对传入的其他参数变更做出反馈。
   *
   * 如果禁用了歌词组件动画，你也可以通过引用取得原始渲染组件实例，手动逐帧调用其 `update` 函数来更新动画效果。
   */
  disabled: {
    type: Boolean,
    default: false,
  },
  /**
   * 是否演出部分效果，目前会控制播放间奏点的动画的播放暂停与否，默认为 `true`
   */
  playing: {
    type: Boolean,
    default: true,
  },
  /**
   * 设置歌词行的对齐方式，如果为 `undefined` 则默认为 `center`
   *
   * - 设置成 `top` 的话将会向目标歌词行的顶部对齐
   * - 设置成 `bottom` 的话将会向目标歌词行的底部对齐
   * - 设置成 `center` 的话将会向目标歌词行的垂直中心对齐
   */
  alignAnchor: {
    type: String as PropType<"top" | "bottom" | "center">,
    default: "center",
  },
  /**
   * 设置默认的歌词行对齐位置，相对于整个歌词播放组件的大小位置，如果为 `undefined`
   * 则默认为 `0.5`
   *
   * 可以设置一个 `[0.0-1.0]` 之间的任意数字，代表组件高度由上到下的比例位置
   */
  alignPosition: {
    type: Number,
    default: 0.5,
  },
  /**
   * 设置是否使用物理弹簧算法实现歌词动画效果，默认启用
   *
   * 如果启用，则会通过弹簧算法实时处理歌词位置，但是需要性能足够强劲的电脑方可流畅运行
   *
   * 如果不启用，则会回退到基于 `transition` 的过渡效果，对低性能的机器比较友好，但是效果会比较单一
   */
  enableSpring: {
    type: Boolean,
    default: true,
  },
  /**
   * 设置是否启用歌词行的模糊效果，默认为 `true`
   */
  enableBlur: {
    type: Boolean,
    default: true,
  },
  /**
   * 设置是否使用物理弹簧算法实现歌词动画效果，默认启用
   *
   * 如果启用，则会通过弹簧算法实时处理歌词位置，但是需要性能足够强劲的电脑方可流畅运行
   *
   * 如果不启用，则会回退到基于 `transition` 的过渡效果，对低性能的机器比较友好，但是效果会比较单一
   */
  enableScale: {
    type: Boolean,
    default: true,
  },
  /**
   * 设置是否隐藏已经播放过的歌词行，默认不隐藏
   */
  hidePassedLines: {
    type: Boolean,
    default: false,
  },
  /**
   * 设置当前播放歌词，要注意传入后这个数组内的信息不得修改，否则会发生错误
   */
  lyricLines: {
    type: Object as PropType<LyricLine[]>,
    required: false,
  },
  /**
   * 设置当前播放进度，单位为毫秒且**必须是整数**，此时将会更新内部的歌词进度信息
   * 内部会根据调用间隔和播放进度自动决定如何滚动和显示歌词，所以这个的调用频率越快越准确越好
   */
  currentTime: {
    type: Number,
    default: 0,
  },
  /**
   * 设置文字动画的渐变宽度，单位以歌词行的主文字字体大小的倍数为单位，默认为 0.5，即一个全角字符的一半宽度
   *
   * 如果要模拟 Apple Music for Android 的效果，可以设置为 1
   *
   * 如果要模拟 Apple Music for iPad 的效果，可以设置为 0.5
   *
   * 如果想要近乎禁用渐变效果，可以设置成非常接近 0 的小数（例如 `0.0001` ），但是**不可以为 0**
   */
  wordFadeWidth: {
    type: Number,
    default: 0.5,
  },
  /**
   * 设置所有歌词行在横坐标上的弹簧属性，包括重量、弹力和阻力。
   *
   * @param params 需要设置的弹簧属性，提供的属性将会覆盖原来的属性，未提供的属性将会保持原样
   */
  linePosXSpringParams: {
    type: Object as PropType<Partial<spring.SpringParams>>,
    required: false,
  },
  /**
   * 设置所有歌词行在​纵坐标上的弹簧属性，包括重量、弹力和阻力。
   *
   * @param params 需要设置的弹簧属性，提供的属性将会覆盖原来的属性，未提供的属性将会保持原样
   */
  linePosYSpringParams: {
    type: Object as PropType<Partial<spring.SpringParams>>,
    required: false,
  },
  /**
   * 设置所有歌词行在​缩放大小上的弹簧属性，包括重量、弹力和阻力。
   *
   * @param params 需要设置的弹簧属性，提供的属性将会覆盖原来的属性，未提供的属性将会保持原样
   */
  lineScaleSpringParams: {
    type: Object as PropType<Partial<spring.SpringParams>>,
    required: false,
  },
  /**
   * 设置渲染器，如果为 `undefined` 则默认为 `MeshGradientRenderer`
   * 默认渲染器有可能会随着版本更新而更换
   */
  lyricPlayer: {
    type: Object as PropType<{
      new (...args: ConstructorParameters<typeof BaseRenderer>): BaseRenderer;
    }>,
    required: false,
  },
});

/**
 * 歌词播放组件的事件
 */
const emit = defineEmits<{
  lineClick: [event: LyricLineMouseEvent];
  lineContextmenu: [event: LyricLineMouseEvent];
}>();

/**
 * 歌词播放组件的引用
 */
export interface LyricPlayerRef {
  /**
   * 歌词播放实例
   */
  lyricPlayer: Ref<LyricPlayerBase | undefined>;
  /**
   * 将歌词播放实例的元素包裹起来的 DIV 元素实例
   */
  wrapperEl: Readonly<ShallowRef<HTMLDivElement | null>>;
}

// 模板引用
const wrapperRef = useTemplateRef<HTMLDivElement>("wrapper-ref");
// 歌词播放实例
const playerRef = ref<CoreLyricPlayer>();

// 事件处理器
const lineClickHandler = (e: Event) => emit("lineClick", e as LyricLineMouseEvent);
const lineContextMenuHandler = (e: Event) => emit("lineContextmenu", e as LyricLineMouseEvent);

// 底部行元素
const bottomLineEl = computed(() => playerRef.value?.getBottomLineElement());

type InternalLyricLineObject = {
  enable?: (time?: number, shouldPlay?: boolean) => void | Promise<void>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyInternal = any;

type InternalLyricPlayer = CoreLyricPlayer & {
  hotLines?: Set<number>;
  bufferedLines?: Set<number>;
  processedLines?: LyricLine[];
  currentLyricLineObjects?: InternalLyricLineObject[];
  currentLyricGroups?: AnyInternal[];
  scrollToIndex?: number;
  resetScroll?: () => void;
  calcLayout?: () => void | Promise<void>;
};

const getInternalPlayer = () =>
  playerRef.value as unknown as InternalLyricPlayer | undefined;

// ─── 性能补丁: 逐属性独立写+dedup,消除 setAttribute 解析开销 ───
const applyPerformancePatches = (player: InternalLyricPlayer) => {
  const groups = player.currentLyricGroups;
  if (!groups || groups.length === 0) return;

  const groupProto = Object.getPrototypeOf(groups[0]);
  if (groupProto?.__spaPerf) return;
  groupProto.__spaPerf = true;
  const lineProto = groups[0].mainLine
    ? Object.getPrototypeOf(groups[0].mainLine)
    : null;

  // Patch 1: LyricLineGroup.prototype.renderStyles — 逐属性独立 dedup + bgWrapper 内联
  // 上浮场景: 仅 transform 变化,opacity/filter 不变 → 省 2/3 DOM 写入
  // bgWrapper: 内联渲染逻辑 + clientHeight 缓存(消除 layout thrash)
  if (groupProto && typeof groupProto.renderStyles === "function") {
    const origRenderStyles = groupProto.renderStyles;
    groupProto.renderStyles = function (this: AnyInternal) {
      // 元素重建 → 设 will-change 提升合成层 + 失效缓存
      if (this.__cachedEl !== this.element) {
        this.__cachedEl = this.element;
        this.__lastY = this.__lastOpacity = this.__lastBlur = undefined;
        this.element.style.willChange = "transform, opacity, filter";
        this.element.style.contain = "layout style";
      }

      // 逐属性 dedup: 只写实际变化的属性
      const y = this.posY.getCurrentPosition().toFixed(1) as string;
      if (y !== this.__lastY) {
        this.__lastY = y;
        this.element.style.transform = `translateY(${y}px)`;
      }

      const opacity = this.opacity?.toString() ?? "1";
      if (opacity !== this.__lastOpacity) {
        this.__lastOpacity = opacity;
        this.element.style.opacity = opacity;
      }

      const blurVal = Math.min(5, this.blur ?? 0);
      const blurStr = `blur(${blurVal}px)`;
      if (blurStr !== this.__lastBlur) {
        this.__lastBlur = blurStr;
        this.element.style.filter = blurStr;
      }

      if (!this.lyricPlayer.getEnableSpring()) {
        this.element.style.transitionDelay = `${this.delay}ms`;
      }

      // bgWrapper: active 变更走原方法(处理 classList),稳态走 dedup
      if (this.bgWrapper) {
        if (this.lastIsActive !== this.isActive) {
          // active 状态变更: 委托原方法处理 classList toggle + 缓存高度
          origRenderStyles.call(this);
          this.__bgHeight = this.bgWrapper.clientHeight || 0;
          this.__lastBgTransform = undefined;
        } else {
          // 稳态: dedup bgWrapper transform + marginTop
          const slideY = this.bgSlideY.getCurrentPosition();
          const slideYStr = slideY.toFixed(1);
          const activeProgress = Math.max(0, Math.min(1, 1 - Math.abs(slideY) / 80));
          const scaleStr = (0.8 + activeProgress * 0.2).toFixed(3);
          const bgTransform = `translateY(${slideYStr}%) scale(${scaleStr})`;
          if (bgTransform !== this.__lastBgTransform) {
            this.__lastBgTransform = bgTransform;
            this.bgWrapper.style.transform = bgTransform;
          }
          // marginTop: 用缓存高度避免 clientHeight layout thrash
          const shouldBgFirst =
            !this.lyricPlayer.getAlwaysPostpositionBackground() && this.isBgFirst;
          if (shouldBgFirst) {
            const h = this.__bgHeight ?? 0;
            const mt = `${(-h * (1 - activeProgress)).toFixed(1)}px`;
            if (mt !== this.__lastBgMargin) {
              this.__lastBgMargin = mt;
              this.bgWrapper.style.marginTop = mt;
            }
          }
        }
      }
    };
  }

  // Patch 2: LyricLineEl.prototype.rebuildStyle — 用逐属性写替代 setAttribute("style",...")
  // 原版 setAttribute 有两大开销: (1) CSS 字符串解析 (2) 清空所有 inline style 含 alpha vars
  // 改为直接 style.transform / style.filter 写入,彻底消除这两个问题
  if (lineProto && typeof lineProto.rebuildStyle === "function") {
    lineProto.rebuildStyle = function (this: AnyInternal) {
      // 元素重建 → 设 will-change 提升合成层 + 失效缓存
      if (this.__rsCachedEl !== this.element) {
        this.__rsCachedEl = this.element;
        this.__lastScale = this.__lastLineBlur = this.__lastLineDelay = undefined;
        this.element.style.willChange = "transform, filter";
        this.element.style.contain = "layout style";
      }

      const scaleVal = (
        this.lineTransforms.scale.getCurrentPosition() / 100
      ).toFixed(4);
      if (scaleVal !== this.__lastScale) {
        this.__lastScale = scaleVal;
        this.element.style.transform = `scale(${scaleVal})`;
      }

      const blurVal = Math.min(5, this.blur ?? 0);
      const blurStr = `${blurVal}px`;
      if (blurStr !== this.__lastLineBlur) {
        this.__lastLineBlur = blurStr;
        this.element.style.filter = `blur(${blurStr})`;
      }

      if (!this.lyricPlayer.getEnableSpring()) {
        const delayStr = `${this.delay}ms`;
        if (delayStr !== this.__lastLineDelay) {
          this.__lastLineDelay = delayStr;
          this.element.style.transitionDelay = delayStr;
        }
      }
    };
  }

  // Patch 3: LyricLineEl.prototype.applyAlphaToDom — 缓存 CSS var 字符串避免无变化写入
  // 由于 Patch 2 不再使用 setAttribute,alpha vars 不会被清空,dedup 完全安全
  if (lineProto && typeof lineProto.applyAlphaToDom === "function") {
    lineProto.applyAlphaToDom = function (this: AnyInternal, delta: number) {
      // 元素重建 → 新元素无 CSS var,失效缓存
      if (this.__alphaCachedEl !== this.element) {
        this.__alphaCachedEl = this.element;
        this.__lastBright = this.__lastDark = undefined;
      }

      const dt = delta || 0.016;
      const ATTACK = 50;
      const RELEASE = 7;
      const factor = (s: number) => 1 - Math.exp(-s * dt);

      const bf = factor(
        this.targetBrightAlpha > this.currentBrightAlpha ? ATTACK : RELEASE,
      );
      if (Math.abs(this.targetBrightAlpha - this.currentBrightAlpha) < 0.001)
        this.currentBrightAlpha = this.targetBrightAlpha;
      else this.currentBrightAlpha += (this.targetBrightAlpha - this.currentBrightAlpha) * bf;

      const df = factor(this.targetDarkAlpha > this.currentDarkAlpha ? ATTACK : RELEASE);
      if (Math.abs(this.targetDarkAlpha - this.currentDarkAlpha) < 0.001)
        this.currentDarkAlpha = this.targetDarkAlpha;
      else this.currentDarkAlpha += (this.targetDarkAlpha - this.currentDarkAlpha) * df;

      const bStr = this.currentBrightAlpha.toFixed(3);
      const dStr = this.currentDarkAlpha.toFixed(3);
      if (bStr !== this.__lastBright || dStr !== this.__lastDark) {
        this.__lastBright = bStr;
        this.__lastDark = dStr;
        this.element.style.setProperty("--bright-mask-alpha", bStr);
        this.element.style.setProperty("--dark-mask-alpha", dStr);
      }
    };
  }

  if (lineProto && typeof lineProto.enable === "function") {
    const origEnable = lineProto.enable;
    lineProto.enable = function (
      this: AnyInternal,
      maskAnimationTime = this.lyricPlayer.getCurrentTime(),
      shouldPlay = this.lyricPlayer.getIsPlaying(),
    ) {
      const token = `${maskAnimationTime}|${shouldPlay}`;
      if (this.isEnabled && this.__lastEnableToken === token && this.__lastEnableWords === this.splittedWords) return;
      this.__lastEnableToken = token;
      this.__lastEnableWords = this.splittedWords;
      return origEnable.call(this, maskAnimationTime, shouldPlay);
    };
  }

  if (lineProto && typeof lineProto.disable === "function") {
    const origDisable = lineProto.disable;
    lineProto.disable = function (this: AnyInternal) {
      if (!this.isEnabled) return;
      this.__lastEnableToken = undefined;
      this.__lastEnableWords = undefined;
      return origDisable.call(this);
    };
  }

  // Patch 4: DomLyricPlayer.prototype.update — --amll-player-time 作用域限定到活跃行
  // 原版: 每帧在 player 根元素设置 → 500-1500 个词元素全部触发 style recalc
  // 优化: 仅在 hotLines 对应的 line element 上设置 → 只有 5-15 个活跃词触发 recalc
  // 非活跃行继承根元素的冻结值(past: 全露出 / future: 全隐藏),无需每帧重算
  const playerProto = Object.getPrototypeOf(player);
  if (
    playerProto &&
    !playerProto.__spaUpdatePatched &&
    typeof playerProto.update === "function" &&
    !(player as AnyInternal).supportMaskImage
  ) {
    playerProto.__spaUpdatePatched = true;
    playerProto.update = function (this: AnyInternal, delta = 0) {
      if (!this.timelineState?.initialLayoutFinished) return;
      // 调用 LyricPlayerBase.update (super.update via 祖父原型)
      const baseProto = Object.getPrototypeOf(playerProto);
      if (baseProto?.update) baseProto.update.call(this, delta);

      // 将 --amll-player-time 写在活跃行 element 而非根 element
      const timeStr = `${this.timelineState.currentTime}`;
      const groups: AnyInternal[] = this.currentLyricGroups;

      // seek 检测: 一次性给所有行写入,确保 past 行显示为已揭示
      if (this.timelineState.isSeeking && groups) {
        for (const g of groups) {
          const mainEl = g.mainLine?.element;
          if (mainEl) mainEl.style.setProperty("--amll-player-time", timeStr);
          const bgEl = g.bgLine?.element;
          if (bgEl) bgEl.style.setProperty("--amll-player-time", timeStr);
        }
      } else {
        // 正常播放: 仅更新 hotGroups(活跃行)
        const hot: Set<number> | undefined = this.timelineState?.hotGroups;
        if (hot && groups) {
          for (const idx of hot) {
            const g = groups[idx];
            if (!g) continue;
            const mainEl = g.mainLine?.element;
            if (mainEl) mainEl.style.setProperty("--amll-player-time", timeStr);
            const bgEl = g.bgLine?.element;
            if (bgEl) bgEl.style.setProperty("--amll-player-time", timeStr);
          }
        }
      }

      if (!this.isPageVisible) return;
      const deltaS = delta / 1e3;
      const updateIndices = (this.__spaUpdateIndices ??= new Set<number>());
      updateIndices.clear();
      const addNearbyGroups = (center: number | undefined, radius: number) => {
        if (typeof center !== "number" || !Number.isFinite(center) || !groups) return;
        const start = Math.max(0, center - radius);
        const end = Math.min(groups.length - 1, center + radius);
        for (let i = start; i <= end; i += 1) updateIndices.add(i);
      };
      for (let i = 0; i < (groups?.length ?? 0); i += 1) {
        if (groups[i]?.element?.parentElement) updateIndices.add(i);
      }
      for (const idx of this.timelineState?.hotGroups ?? []) addNearbyGroups(idx, 3);
      for (const idx of this.timelineState?.bufferedGroups ?? []) addNearbyGroups(idx, 5);
      addNearbyGroups(this.timelineState?.scrollToIndex, 8);
      for (const idx of updateIndices) groups?.[idx]?.update(deltaS);
    };
  }

};

// 补齐新激活行的动画时间
const syncNewHotLineAnimations = (
  player: InternalLyricPlayer,
  previousHotLines: Set<number>,
  time: number,
) => {
  const { hotLines, currentLyricLineObjects } = player;
  if (!hotLines || !Array.isArray(currentLyricLineObjects)) return;

  for (const id of hotLines) {
    if (previousHotLines.has(id)) continue;
    void currentLyricLineObjects[id]?.enable?.(time, props.playing);
  }
};

// 正常播放时同步时间
const syncPlaybackTime = (time: number) => {
  const player = getInternalPlayer();
  if (!player) return;

  const previousHotLines: Set<number> = new Set(player.hotLines ?? []);
  player.setCurrentTime(time, false);
  syncNewHotLineAnimations(player, previousHotLines, time);
};

// 跳转或重载歌词时强制落位
const syncSeekTime = (time: number) => {
  const player = getInternalPlayer();
  if (!player) return;

  player.setCurrentTime(time, true);

  if (player.bufferedLines && player.hotLines && player.processedLines) {
    player.bufferedLines.clear();
    for (const v of player.hotLines) {
      player.bufferedLines.add(v);
    }

    if (player.bufferedLines.size > 0) {
      player.scrollToIndex = Math.min(...player.bufferedLines);
    } else {
      const foundIndex = player.processedLines.findIndex((line) => line.startTime >= time);
      player.scrollToIndex = foundIndex === -1 ? player.processedLines.length : foundIndex;
    }

    player.resetScroll?.();
    void player.calcLayout?.();
  }
};

// 组件挂载时初始化
onMounted(() => {
  const wrapper = wrapperRef.value;
  if (wrapper) {
    playerRef.value = new CoreLyricPlayer();
    const el = playerRef.value.getElement();
    el.style.touchAction = "none";
    wrapper.appendChild(el);
    playerRef.value.addEventListener("line-click", lineClickHandler);
    playerRef.value.addEventListener("line-contextmenu", lineContextMenuHandler);
  }
});

// 组件卸载时清理
onUnmounted(() => {
  const player = playerRef.value;
  if (player) {
    player.removeEventListener("line-click", lineClickHandler);
    player.removeEventListener("line-contextmenu", lineContextMenuHandler);
    player.dispose();
  }
});

// 限制单帧最大时间步长，避免后台恢复后动画突跳
// 设为 120ms 兼顾低端机偶发卡顿（≈30fps 下 33ms/帧），同时防止可见性切换前累计的大 delta 一次注入
const MAX_FRAME_DELTA = 120;

watchEffect((onCleanup) => {
  if (!props.disabled) {
    let canceled = false;
    let lastTime = -1;
    const resetLastTime = () => {
      lastTime = -1;
    };
    const onVisibility = () => {
      resetLastTime();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const onFrame = (time: number) => {
      if (canceled) return;
      if (lastTime === -1) {
        lastTime = time;
      }
      const rawDelta = time - lastTime;
      const delta = rawDelta > MAX_FRAME_DELTA ? MAX_FRAME_DELTA : rawDelta;
      playerRef.value?.update(delta);
      lastTime = time;
      requestAnimationFrame(onFrame);
    };
    requestAnimationFrame(onFrame);
    onCleanup(() => {
      canceled = true;
      document.removeEventListener("visibilitychange", onVisibility);
    });
  }
});

// 播放/暂停状态
watchEffect(() => {
  if (props.playing !== undefined) {
    if (props.playing) {
      playerRef.value?.resume();
    } else {
      playerRef.value?.pause();
    }
  } else playerRef.value?.resume();
});

// 对齐锚点
watchEffect(() => {
  if (props.alignAnchor !== undefined) playerRef.value?.setAlignAnchor(props.alignAnchor);
});

// 隐藏已播放歌词行
watchEffect(() => {
  if (props.hidePassedLines !== undefined)
    playerRef.value?.setHidePassedLines(props.hidePassedLines);
});

// 对齐位置
watchEffect(() => {
  if (props.alignPosition !== undefined) playerRef.value?.setAlignPosition(props.alignPosition);
});

// 弹簧动画
watchEffect(() => {
  if (props.enableSpring !== undefined) playerRef.value?.setEnableSpring(props.enableSpring);
  else playerRef.value?.setEnableSpring(true);
});

// 模糊效果
watchEffect(() => {
  if (props.enableBlur !== undefined) playerRef.value?.setEnableBlur(props.enableBlur);
  else playerRef.value?.setEnableBlur(true);
});

// 缩放效果
watchEffect(() => {
  if (props.enableScale !== undefined) playerRef.value?.setEnableScale(props.enableScale);
  else playerRef.value?.setEnableScale(true);
});

// 歌词行数据
// AMLL setLyricLines 同步构造每词 LyricLineEl + KeyframeEffect Animation：
// YRC 100-300 行 × 5-15 词 ≈ 2000 DOM 节点，主线程同步 100-500ms。
// 推到 idle frame：切歌 UI（封面/标题/进度条）先消化完，再幕后建词级动画；
// 200ms timeout 兜底避免歌词显示推迟过久。
let pendingSetLyricRic: number | null = null;
const cancelPendingSetLyric = () => {
  if (pendingSetLyricRic !== null) {
    const cic = (window as Window & { cancelIdleCallback?: typeof cancelIdleCallback })
      .cancelIdleCallback;
    if (typeof cic === "function") cic(pendingSetLyricRic);
    else clearTimeout(pendingSetLyricRic);
    pendingSetLyricRic = null;
  }
};

watch(
  [() => props.lyricLines, playerRef],
  ([lines, player]) => {
    if (lines === undefined || !player) return;
    cancelPendingSetLyric();
    const apply = () => {
      pendingSetLyricRic = null;
      // 异步窗口可能跨过组件销毁，二次校验 player 仍然存在
      if (!playerRef.value) return;
      playerRef.value.setLyricLines(lines);
      // 首次有歌词行时应用性能补丁
      applyPerformancePatches(getInternalPlayer()!);
      syncSeekTime(props.currentTime);
    };
    // 空数组（切歌瞬间清空）走同步：不会卡且能立即让 LoadingSpinner 显出
    if (lines.length === 0) {
      apply();
      return;
    }
    const ric = (window as Window & { requestIdleCallback?: typeof requestIdleCallback })
      .requestIdleCallback;
    if (typeof ric === "function") {
      pendingSetLyricRic = ric(apply, { timeout: 200 });
    } else {
      pendingSetLyricRic = window.setTimeout(apply, 0);
    }
  },
  { immediate: true },
);

onBeforeUnmount(cancelPendingSetLyric);

// 当前播放时间
watch(
  () => props.currentTime,
  (time, oldTime) => {
    if (time === undefined) return;
    const isSeek = oldTime !== undefined && Math.abs(time - oldTime) > 1000;

    if (isSeek) {
      syncSeekTime(time);
    } else {
      syncPlaybackTime(time);
    }
  },
  { immediate: true },
);

// 渐变宽度
watchEffect(() => {
  if (props.wordFadeWidth !== undefined) playerRef.value?.setWordFadeWidth(props.wordFadeWidth);
});

// X 轴弹簧参数
watchEffect(() => {
  if (props.linePosXSpringParams !== undefined)
    playerRef.value?.setLinePosXSpringParams(props.linePosXSpringParams);
});

// Y 轴弹簧参数
watchEffect(() => {
  if (props.linePosYSpringParams !== undefined)
    playerRef.value?.setLinePosYSpringParams(props.linePosYSpringParams);
});

// 缩放弹簧参数
watchEffect(() => {
  if (props.lineScaleSpringParams !== undefined)
    playerRef.value?.setLineScaleSpringParams(props.lineScaleSpringParams);
});

// 暴露给父组件
defineExpose<LyricPlayerRef>({
  lyricPlayer: playerRef,
  wrapperEl: wrapperRef,
});
</script>

<template>
  <div ref="wrapper-ref">
    <Teleport v-if="bottomLineEl" :to="bottomLineEl">
      <slot name="bottom-line" />
    </Teleport>
  </div>
</template>
