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
   * 启用 WebView 性能优化
   */
  optimizeForWebView: {
    type: Boolean,
    default: false,
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
const lineClickHandler = (e: Event) => {
  const player = getInternalPlayer();
  if (player) clearUserScrollTransition(player);
  emit("lineClick", e as LyricLineMouseEvent);
};
const lineContextMenuHandler = (e: Event) => emit("lineContextmenu", e as LyricLineMouseEvent);

// 底部行元素
const bottomLineEl = computed(() => playerRef.value?.getBottomLineElement());

type InternalLyricLineObject = {
  enable?: (time?: number, shouldPlay?: boolean) => void | Promise<void>;
  disable?: () => void;
  getLine?: () => LyricLine;
  hide?: () => void;
  show?: () => void;
  update?: (delta: number) => void;
  __amllIndex?: number;
  __amllOwnerPlayer?: InternalLyricPlayer;
  __amllVisibleInactiveClass?: boolean;
  __amllEnabled?: boolean;
  __amllLastAutoEnableTime?: number;
  __amllLastBlur?: number;
  __amllHotClass?: boolean;
  __amllLastWrittenBrightAlpha?: number;
  __amllLastWrittenDarkAlpha?: number;
  __amllLastInSight?: boolean;
};

type InternalTimelineState = {
  hotLines?: Set<number>;
  bufferedLines?: Set<number>;
  currentTime?: number;
  lastCurrentTime?: number;
  scrollToIndex?: number;
  initialLayoutFinished?: boolean;
};

type InternalScrollState = {
  isUserScrolling?: boolean;
};

type InternalLyricPlayer = CoreLyricPlayer & {
  hotLines?: Set<number>;
  bufferedLines?: Set<number>;
  currentLyricLineObjects?: InternalLyricLineObject[];
  currentTime?: number;
  bottomLine?: { update?: (delta: number) => void };
  interludeDots?: { update?: (delta: number) => void };
  element?: HTMLElement;
  initialLayoutFinished?: boolean;
  isPageVisible?: boolean;
  isUserScrolling?: boolean;
  timelineState?: InternalTimelineState;
  scrollState?: InternalScrollState;
  getEnableSpring?: () => boolean;
  getIsPlaying?: () => boolean;
  supportMaskImage?: boolean;
  scrollToIndex?: number;
  getCurrentTime?: () => number;
  lastCurrentTime?: number;
  processedLines?: LyricLine[];
  size?: [number, number];
  __amllIndexedLineObjects?: InternalLyricLineObject[];
  __amllReusedUpdateIndices?: Set<number>;
  __visibleLineIndices?: Set<number>;
  __amllPlaybackFastSyncUntil?: number;
  __amllPlaybackFastSyncLastTime?: number;
  __amllPlaybackFastSyncPlaying?: boolean;
  __amllScrollTransitionTimer?: ReturnType<typeof setTimeout>;
  __amllPendingClassSync?: boolean;
  __amllClassSyncFrame?: number;
  __amllLastClassSyncIndices?: Set<number>;
  __amllOptimizeForWebView?: boolean;
  __amllCalcLayoutActiveRange?: Set<number>;
  __amllLastHotLines?: Set<number>;
};

const getInternalPlayer = () => playerRef.value as InternalLyricPlayer | undefined;

const HOT_LINE_UPDATE_RADIUS = 3;
const BUFFERED_LINE_UPDATE_RADIUS = 5;
const LINE_UPDATE_INDEX_RADIUS = 8;
const PLAYBACK_FAST_SYNC_MAX_DELTA = 250;
const VISIBLE_INACTIVE_LINE_CLASS = "splayer-amll-visible-inactive";
const HOT_LINE_CLASS = "splayer-amll-hot";
const USER_SCROLLING_CLASS = "splayer-amll-user-scrolling";
const SCROLL_TRANSITION_IDLE_DELAY = 1500;

const patchedPlayerUpdatePrototypes = new WeakSet<object>();
const patchedLineVisibilityPrototypes = new WeakSet<object>();
const patchedLineRebuildStylePrototypes = new WeakSet<object>();
const patchedLineSetTransformPrototypes = new WeakSet<object>();
const patchedLineApplyAlphaPrototypes = new WeakSet<object>();
const patchedLineUpdatePrototypes = new WeakSet<object>();
const patchedPlayerScrollPrototypes = new WeakSet<object>();
const patchedPlayerSpringPrototypes = new WeakSet<object>();
const patchedPlayerCalcLayoutPrototypes = new WeakSet<object>();

type InternalLyricPlayerPrototype = {
  beginScrollHandler?: (this: InternalLyricPlayer) => boolean;
  endScrollHandler?: (this: InternalLyricPlayer) => void;
  calcLayout?: (this: InternalLyricPlayer, sync?: boolean, force?: boolean) => void;
  update?: (this: InternalLyricPlayer, delta?: number) => void;
};

type InternalLyricLinePrototype = {
  disable?: NonNullable<InternalLyricLineObject["disable"]>;
  enable?: NonNullable<InternalLyricLineObject["enable"]>;
  hide?: NonNullable<InternalLyricLineObject["hide"]>;
  show?: NonNullable<InternalLyricLineObject["show"]>;
  rebuildStyle?: () => void;
  setTransform?: (top: number, scale: number, opacity: number, blur: number, force: boolean, delay: number, mode: number) => void;
  update?: (delta: number) => void;
};

const getLineElement = (lineObject: InternalLyricLineObject) =>
  (lineObject as unknown as { element?: HTMLElement }).element;

const hasActiveLineClass = (lineObject: InternalLyricLineObject | undefined) => {
  if (!lineObject) return false;
  const lineElement = getLineElement(lineObject);
  return Boolean(lineElement?.className.includes("_active"));
};

const getLineObjects = (player: InternalLyricPlayer) =>
  player.currentLyricLineObjects as unknown as InternalLyricLineObject[] | undefined;

const getHotLines = (player: InternalLyricPlayer) =>
  player.timelineState?.hotLines ?? player.hotLines ?? new Set<number>();

const getBufferedLines = (player: InternalLyricPlayer) =>
  player.timelineState?.bufferedLines ?? player.bufferedLines ?? new Set<number>();

const getScrollToIndex = (player: InternalLyricPlayer) =>
  player.timelineState?.scrollToIndex ?? player.scrollToIndex;

// 0.5.0 将 lastCurrentTime 移至 timelineState，优先从该处读取
const getLastCurrentPlayerTime = (player: InternalLyricPlayer | undefined) =>
  player?.timelineState?.lastCurrentTime ?? player?.lastCurrentTime;

const isInitialLayoutFinished = (player: InternalLyricPlayer) =>
  player.timelineState?.initialLayoutFinished ?? player.initialLayoutFinished;

// 0.5.0 将 isUserScrolling 移至 scrollState
const isUserScrolling = (player: InternalLyricPlayer) =>
  player.scrollState?.isUserScrolling ?? player.isUserScrolling;

// 0.5.0 不再在 player 上直接持有 currentTime/lastCurrentTime，仅写 timelineState
const syncPlaybackClockState = (player: InternalLyricPlayer, time: number) => {
  if (player.timelineState) {
    player.timelineState.currentTime = time;
    player.timelineState.lastCurrentTime = time;
  }
};

const addNearbyLineIndices = (
  indices: Set<number>,
  center: number | undefined,
  radius: number,
  length: number,
) => {
  if (typeof center !== "number" || !Number.isFinite(center)) return;
  const start = Math.max(0, center - radius);
  const end = Math.min(length - 1, center + radius);
  for (let index = start; index <= end; index += 1) {
    indices.add(index);
  }
};

const syncVisibleInactiveLineClasses = (player: InternalLyricPlayer) => {
  // 延后一帧合并 class 切换，避免切行时抢占主线程
  if (player.__amllPendingClassSync) return;
  player.__amllPendingClassSync = true;
  player.__amllClassSyncFrame = requestAnimationFrame(() => {
    player.__amllPendingClassSync = false;
    player.__amllClassSyncFrame = undefined;
    const lineObjects = getLineObjects(player);
    if (!Array.isArray(lineObjects)) return;

    const hotLines = getVisualHotLineIndices(player);
    const syncIndices = new Set<number>();
    const visibleLineIndices = player.__visibleLineIndices;
    if (visibleLineIndices && visibleLineIndices.size > 0) {
      for (const index of visibleLineIndices) syncIndices.add(index);
    } else {
      for (const index of hotLines) {
        addNearbyLineIndices(syncIndices, index, HOT_LINE_UPDATE_RADIUS, lineObjects.length);
      }
      for (const index of getBufferedLines(player)) {
        addNearbyLineIndices(syncIndices, index, BUFFERED_LINE_UPDATE_RADIUS, lineObjects.length);
      }
      addNearbyLineIndices(
        syncIndices,
        getScrollToIndex(player),
        LINE_UPDATE_INDEX_RADIUS,
        lineObjects.length,
      );
    }
    for (const index of player.__amllLastClassSyncIndices ?? []) syncIndices.add(index);
    for (const index of hotLines) syncIndices.add(index);

    const nextSyncedIndices = new Set<number>();
    for (const index of syncIndices) {
      if (index < 0 || index >= lineObjects.length) continue;
      const lineObject = lineObjects[index];
      const lineElement = getLineElement(lineObject);
      const line = lineObject.getLine?.() ?? player.processedLines?.[index];
      const shouldApplyClass = Boolean(
        lineElement?.parentElement && line && !line.isBG && !hotLines.has(index),
      );
      if (!lineElement) continue;

      if (lineObject.__amllVisibleInactiveClass !== shouldApplyClass) {
        lineElement.classList.toggle(VISIBLE_INACTIVE_LINE_CLASS, shouldApplyClass);
        lineObject.__amllVisibleInactiveClass = shouldApplyClass;
      }

      const isHot = hotLines.has(index);
      if (lineObject.__amllHotClass !== isHot) {
        lineElement.classList.toggle(HOT_LINE_CLASS, isHot);
        lineObject.__amllHotClass = isHot;
      }
      if (lineElement.parentElement || lineObject.__amllVisibleInactiveClass) {
        nextSyncedIndices.add(index);
      }
    }
    player.__amllLastClassSyncIndices = nextSyncedIndices;
  });
};

// 立即同步 hot 行 class，确保 will-change 在行切换瞬间生效
// 同时移除旧行的 hot class，减少合成层
const syncHotLineClassesImmediate = (player: InternalLyricPlayer) => {
  const lineObjects = getLineObjects(player);
  if (!Array.isArray(lineObjects)) return;
  const hotLines = getVisualHotLineIndices(player);
  const lastHotLines = player.__amllLastHotLines ?? new Set<number>();

  // 移除旧行的 hot class
  for (const index of lastHotLines) {
    if (hotLines.has(index)) continue;
    if (index < 0 || index >= lineObjects.length) continue;
    const lineObject = lineObjects[index];
    const lineElement = getLineElement(lineObject);
    if (!lineElement || lineObject.__amllHotClass !== true) continue;
    lineElement.classList.remove(HOT_LINE_CLASS);
    lineObject.__amllHotClass = false;
  }

  // 添加新行的 hot class
  for (const index of hotLines) {
    if (index < 0 || index >= lineObjects.length) continue;
    const lineObject = lineObjects[index];
    const lineElement = getLineElement(lineObject);
    if (!lineElement || lineObject.__amllHotClass === true) continue;
    lineElement.classList.add(HOT_LINE_CLASS);
    lineObject.__amllHotClass = true;
  }

  player.__amllLastHotLines = new Set(hotLines);
};

const patchLineVisibilityPrototype = (lineObject: InternalLyricLineObject | undefined) => {
  if (!lineObject) return;
  const prototype = Object.getPrototypeOf(lineObject) as InternalLyricLinePrototype | null;
  if (!prototype || patchedLineVisibilityPrototypes.has(prototype)) return;

  if (prototype.enable) {
    const originalEnable = prototype.enable;
    prototype.enable = function (
      this: InternalLyricLineObject,
      time?: number,
      shouldPlay?: boolean,
    ) {
      const ownerPlayer = this.__amllOwnerPlayer;
      if (!ownerPlayer?.__amllOptimizeForWebView) {
        return originalEnable.call(this, time, shouldPlay);
      }

      const isAutoEnable = time === undefined && shouldPlay === undefined;
      const currentTime = ownerPlayer.getCurrentTime?.() ?? ownerPlayer.timelineState?.currentTime ?? ownerPlayer.currentTime;
      if (
        isAutoEnable &&
        this.__amllEnabled &&
        hasActiveLineClass(this) &&
        typeof currentTime === "number" &&
        this.__amllLastAutoEnableTime === currentTime
      ) {
        return;
      }

      this.__amllEnabled = true;
      if (isAutoEnable && typeof currentTime === "number") {
        this.__amllLastAutoEnableTime = currentTime;
      }
      return originalEnable.call(this, time, shouldPlay);
    };
  }

  if (prototype.disable) {
    const originalDisable = prototype.disable;
    prototype.disable = function (this: InternalLyricLineObject) {
      this.__amllEnabled = false;
      this.__amllLastAutoEnableTime = undefined;
      return originalDisable.call(this);
    };
  }

  if (prototype.show) {
    const originalShow = prototype.show;
    prototype.show = function (this: InternalLyricLineObject) {
      const result = originalShow.call(this);
      const index = this.__amllIndex;
      const ownerPlayer = this.__amllOwnerPlayer;
      if (typeof index === "number") ownerPlayer?.__visibleLineIndices?.add(index);
      if (ownerPlayer) syncVisibleInactiveLineClasses(ownerPlayer);
      return result;
    };
  }

  if (prototype.hide) {
    const originalHide = prototype.hide;
    prototype.hide = function (this: InternalLyricLineObject) {
      const result = originalHide.call(this);
      const index = this.__amllIndex;
      const ownerPlayer = this.__amllOwnerPlayer;
      if (typeof index === "number") ownerPlayer?.__visibleLineIndices?.delete(index);
      getLineElement(this)?.classList.remove(VISIBLE_INACTIVE_LINE_CLASS);
      this.__amllVisibleInactiveClass = false;
      if (ownerPlayer) syncVisibleInactiveLineClasses(ownerPlayer);
      return result;
    };
  }

  patchedLineVisibilityPrototypes.add(prototype);
};

// spring 模式：逐属性赋值替代 setAttribute 全量替换，避免 Layerize 风暴
// transform 每帧更新（弹簧位置变化），filter 仅值变化时更新（blur 不每帧变）
// 非 spring 模式：保留原生 setAttribute 逻辑（CSS transition 驱动，rebuildStyle 调用频率低）
const patchLineRebuildStylePrototype = (lineObject: InternalLyricLineObject | undefined) => {
  if (!lineObject) return;
  const prototype = Object.getPrototypeOf(lineObject) as InternalLyricLinePrototype | null;
  if (!prototype?.rebuildStyle || patchedLineRebuildStylePrototypes.has(prototype)) return;

  const originalRebuildStyle = prototype.rebuildStyle;
  prototype.rebuildStyle = function (this: InternalLyricLineObject & {
    lineTransforms?: { posY: { getCurrentPosition: () => number }; scale: { getCurrentPosition: () => number } };
    blur: number; delay: number; lastStyle?: string;
    lyricPlayer?: { getEnableSpring: () => boolean }; isInSight?: boolean;
    __amllLastBlur?: number;
  }) {
    // 非 spring 模式走原生逻辑
    if (!this.lyricPlayer?.getEnableSpring()) {
      return originalRebuildStyle.call(this);
    }

    const el = getLineElement(this);
    if (!el) return;

    // spring 模式下 transform 每帧必须更新，filter 仅 blur 值变化时更新
    const posY = this.lineTransforms?.posY.getCurrentPosition().toFixed(1) ?? "0";
    const scale = ((this.lineTransforms?.scale.getCurrentPosition() ?? 100) / 100).toFixed(4);
    el.style.transform = `translateY(${posY}px) scale(${scale})`;

    const blur = Math.min(5, this.blur);
    if (this.__amllLastBlur !== blur) {
      this.__amllLastBlur = blur;
      el.style.filter = `blur(${blur}px)`;
    }
  };

  patchedLineRebuildStylePrototypes.add(prototype);
};

// spring 模式：远离活跃区域的行强制 force=true，跳过弹簧闭包创建直接落位
// 非 spring 模式：完全不干预，让 CSS transition 处理过渡
const SET_TRANSFORM_FORCE_RADIUS = 12;
const patchLineSetTransformPrototype = (lineObject: InternalLyricLineObject | undefined) => {
  if (!lineObject) return;
  const prototype = Object.getPrototypeOf(lineObject) as InternalLyricLinePrototype | null;
  if (!prototype?.setTransform || patchedLineSetTransformPrototypes.has(prototype)) return;

  const originalSetTransform = prototype.setTransform;
  prototype.setTransform = function (
    this: InternalLyricLineObject,
    top: number,
    scale: number,
    opacity: number,
    blur: number,
    force: boolean,
    delay: number,
    mode: number,
  ) {
    const ownerPlayer = this.__amllOwnerPlayer;

    // 仅 spring 模式下的优化
    if (ownerPlayer?.getEnableSpring?.() !== false) {
      // calcLayout 期间，跳过远离活跃区域的行（用户滚动/seek 时不跳过）
      if (ownerPlayer?.__amllCalcLayoutActiveRange && ownerPlayer && !isUserScrolling(ownerPlayer) && !force) {
        const index = this.__amllIndex;
        if (typeof index === "number" && !ownerPlayer.__amllCalcLayoutActiveRange.has(index)) {
          return;
        }
      }

      // 非 calcLayout 期间，远离活跃区域的行也强制 force=true
      if (!force && ownerPlayer) {
        const index = this.__amllIndex;
        if (typeof index === "number") {
          const hotLines = getHotLines(ownerPlayer);
          const bufferedLines = getBufferedLines(ownerPlayer);
          const scrollToIndex = getScrollToIndex(ownerPlayer);
          let nearActive = false;
          for (const hi of hotLines) {
            if (Math.abs(hi - index) <= SET_TRANSFORM_FORCE_RADIUS) { nearActive = true; break; }
          }
          if (!nearActive) {
            for (const bi of bufferedLines) {
              if (Math.abs(bi - index) <= SET_TRANSFORM_FORCE_RADIUS) { nearActive = true; break; }
            }
          }
          if (!nearActive && typeof scrollToIndex === "number") {
            nearActive = Math.abs(scrollToIndex - index) <= SET_TRANSFORM_FORCE_RADIUS;
          }
          if (!nearActive) force = true;
        }
      }
    }

    return originalSetTransform.call(this, top, scale, opacity, blur, force, delay, mode);
  };

  patchedLineSetTransformPrototypes.add(prototype);
};

// applyAlphaToDom 去重：alpha 收敛后不再写入 CSS 自定义属性，减少每帧 DOM 写入
const patchLineApplyAlphaPrototype = (lineObject: InternalLyricLineObject | undefined) => {
  if (!lineObject) return;
  const prototype = Object.getPrototypeOf(lineObject) as (InternalLyricLinePrototype & {
    applyAlphaToDom?: (this: InternalLyricLineObject & {
      targetBrightAlpha?: number;
      currentBrightAlpha?: number;
      targetDarkAlpha?: number;
      currentDarkAlpha?: number;
      element?: HTMLElement;
    }, delta: number) => void;
  }) | null;
  if (!prototype?.applyAlphaToDom || patchedLineApplyAlphaPrototypes.has(prototype)) return;

  prototype.applyAlphaToDom = function (this: InternalLyricLineObject & {
    targetBrightAlpha?: number;
    currentBrightAlpha?: number;
    targetDarkAlpha?: number;
    currentDarkAlpha?: number;
    element?: HTMLElement;
  }, delta: number) {
    const dt = delta || .016;
    const ATTACK_SPEED = 50;
    const RELEASE_SPEED = 7;
    const getFactor = (speed: number) => 1 - Math.exp(-speed * dt);
    const brightFactor = getFactor(
      (this.targetBrightAlpha ?? 0) > (this.currentBrightAlpha ?? 0) ? ATTACK_SPEED : RELEASE_SPEED,
    );
    if (Math.abs((this.targetBrightAlpha ?? 0) - (this.currentBrightAlpha ?? 0)) < .001)
      this.currentBrightAlpha = this.targetBrightAlpha;
    else
      this.currentBrightAlpha = (this.currentBrightAlpha ?? 0) + ((this.targetBrightAlpha ?? 0) - (this.currentBrightAlpha ?? 0)) * brightFactor;
    const darkFactor = getFactor(
      (this.targetDarkAlpha ?? 0) > (this.currentDarkAlpha ?? 0) ? ATTACK_SPEED : RELEASE_SPEED,
    );
    if (Math.abs((this.targetDarkAlpha ?? 0) - (this.currentDarkAlpha ?? 0)) < .001)
      this.currentDarkAlpha = this.targetDarkAlpha;
    else
      this.currentDarkAlpha = (this.currentDarkAlpha ?? 0) + ((this.targetDarkAlpha ?? 0) - (this.currentDarkAlpha ?? 0)) * darkFactor;
    // 仅 alpha 值变化时写入 DOM，收敛后跳过
    const el = this.element;
    if (!el) return;
    if (this.__amllLastWrittenBrightAlpha !== this.currentBrightAlpha) {
      this.__amllLastWrittenBrightAlpha = this.currentBrightAlpha;
      el.style.setProperty("--bright-mask-alpha", (this.currentBrightAlpha ?? 0).toFixed(3));
    }
    if (this.__amllLastWrittenDarkAlpha !== this.currentDarkAlpha) {
      this.__amllLastWrittenDarkAlpha = this.currentDarkAlpha;
      el.style.setProperty("--dark-mask-alpha", (this.currentDarkAlpha ?? 0).toFixed(3));
    }
  };

  patchedLineApplyAlphaPrototypes.add(prototype);
};

// spring 模式核心优化：替换 LyricLine.update，跳过 show()→rebuildStyle() 间接调用
// 原流程：update → show() → rebuildStyle() → setAttribute/逐属性赋值（每帧 3+ 次 DOM 写入）
// 优化后：update → 直接写 transform + applyAlphaToDom（每帧 1-2 次 DOM 写入，alpha 去重后更少）
const patchLineUpdatePrototype = (lineObject: InternalLyricLineObject | undefined) => {
  if (!lineObject) return;
  const prototype = Object.getPrototypeOf(lineObject) as (InternalLyricLinePrototype & {
    update?: (this: InternalLyricLineObject & {
      lineTransforms?: {
        posY: { update: (delta: number) => void; getCurrentPosition: () => number };
        scale: { update: (delta: number) => void; getCurrentPosition: () => number };
      };
      isInSight?: boolean;
      __amllLastInSight?: boolean;
      __amllLastBlur?: number;
      blur?: number;
      lyricPlayer?: { getEnableSpring: () => boolean };
    }, delta: number) => void;
  }) | null;
  if (!prototype?.update || patchedLineUpdatePrototypes.has(prototype)) return;

  const originalUpdate = prototype.update;
  prototype.update = function (this: InternalLyricLineObject & {
    lineTransforms?: {
      posY: { update: (delta: number) => void; getCurrentPosition: () => number };
      scale: { update: (delta: number) => void; getCurrentPosition: () => number };
    };
    isInSight?: boolean;
    __amllLastInSight?: boolean;
    __amllLastBlur?: number;
    blur?: number;
    lyricPlayer?: { getEnableSpring: () => boolean };
    updateMaskAlphaTargets?: (scale: number) => void;
    applyAlphaToDom?: (delta: number) => void;
  }, delta: number) {
    // 非 spring 模式走原生逻辑
    if (this.lyricPlayer?.getEnableSpring() === false) {
      return originalUpdate.call(this, delta);
    }

    // spring 模式：直接更新弹簧 + 写 transform，跳过 show()→rebuildStyle()
    this.lineTransforms?.posY.update(delta);
    this.lineTransforms?.scale.update(delta);

    const el = getLineElement(this);
    if (!el) return;

    // isInSight 状态变化时才操作 DOM（show/hide）
    const inSight = this.isInSight ?? true;
    if (inSight !== this.__amllLastInSight) {
      this.__amllLastInSight = inSight;
      if (inSight) {
        this.show?.();
      } else {
        this.hide?.();
        return;
      }
    }

    // 直接写 transform，跳过 rebuildStyle 的字符串拼接和间接调用
    const posY = this.lineTransforms?.posY.getCurrentPosition().toFixed(1) ?? "0";
    const scale = ((this.lineTransforms?.scale.getCurrentPosition() ?? 100) / 100).toFixed(4);
    el.style.transform = `translateY(${posY}px) scale(${scale})`;

    // blur 仅变化时更新
    const blur = Math.min(5, this.blur ?? 0);
    if (this.__amllLastBlur !== blur) {
      this.__amllLastBlur = blur;
      el.style.filter = `blur(${blur}px)`;
    }

    // 遮罩 alpha 更新
    const currentScale = this.lineTransforms?.scale.getCurrentPosition() ?? 100;
    this.updateMaskAlphaTargets?.(currentScale / 100);
    this.applyAlphaToDom?.(delta);
  };

  patchedLineUpdatePrototypes.add(prototype);
};

const refreshLineIndexes = (player: InternalLyricPlayer) => {
  const lineObjects = getLineObjects(player);
  if (!Array.isArray(lineObjects)) return;

  const visibleLineIndices = (player.__visibleLineIndices ??= new Set<number>());
  visibleLineIndices.clear();
  lineObjects.forEach((lineObject, index) => {
    lineObject.__amllIndex = index;
    lineObject.__amllOwnerPlayer = player;
    if (getLineElement(lineObject)?.parentElement) visibleLineIndices.add(index);
  });
  player.__amllIndexedLineObjects = lineObjects;
  syncVisibleInactiveLineClasses(player);
};

const clearUserScrollTransition = (player: InternalLyricPlayer | undefined) => {
  if (!player) return;
  if (player.__amllScrollTransitionTimer) {
    clearTimeout(player.__amllScrollTransitionTimer);
    player.__amllScrollTransitionTimer = undefined;
  }
  player.element?.classList.remove(USER_SCROLLING_CLASS);
};

const cancelVisibleInactiveClassSync = (player: InternalLyricPlayer | undefined) => {
  if (!player || player.__amllClassSyncFrame === undefined) return;
  cancelAnimationFrame(player.__amllClassSyncFrame);
  player.__amllClassSyncFrame = undefined;
  player.__amllPendingClassSync = false;
};

const scheduleUserScrollTransitionClear = (player: InternalLyricPlayer) => {
  if (player.getEnableSpring?.() !== false) {
    clearUserScrollTransition(player);
    return;
  }
  if (player.__amllScrollTransitionTimer) clearTimeout(player.__amllScrollTransitionTimer);
  player.__amllScrollTransitionTimer = setTimeout(() => {
    player.__amllScrollTransitionTimer = undefined;
    if (isUserScrolling(player)) {
      scheduleUserScrollTransitionClear(player);
      return;
    }
    player.element?.classList.remove(USER_SCROLLING_CLASS);
    syncSeekTime(props.currentTime);
  }, SCROLL_TRANSITION_IDLE_DELAY);
};

const keepUserScrollTransitionInstant = (player: InternalLyricPlayer) => {
  if (player.getEnableSpring?.() !== false) {
    clearUserScrollTransition(player);
    return;
  }
  player.element?.classList.add(USER_SCROLLING_CLASS);
  scheduleUserScrollTransitionClear(player);
};

const patchPlayerScrollPrototype = (player: InternalLyricPlayer) => {
  const prototype = Object.getPrototypeOf(player) as InternalLyricPlayerPrototype | null;
  if (!prototype || patchedPlayerScrollPrototypes.has(prototype)) return;

  if (prototype.beginScrollHandler) {
    const originalBeginScrollHandler = prototype.beginScrollHandler;
    prototype.beginScrollHandler = function (this: InternalLyricPlayer) {
      const allowed = originalBeginScrollHandler.call(this);
      if (allowed) keepUserScrollTransitionInstant(this);
      return allowed;
    };
  }

  if (prototype.endScrollHandler) {
    const originalEndScrollHandler = prototype.endScrollHandler;
    prototype.endScrollHandler = function (this: InternalLyricPlayer) {
      const result = originalEndScrollHandler.call(this);
      scheduleUserScrollTransitionClear(this);
      return result;
    };
  }

  patchedPlayerScrollPrototypes.add(prototype);
};

const patchPlayerSpringPrototype = (player: InternalLyricPlayer) => {
  const prototype = Object.getPrototypeOf(player) as InternalLyricPlayerPrototype | null;
  if (!prototype || patchedPlayerSpringPrototypes.has(prototype)) return;

  // 0.5.0 移除了 updateDynamicSpringParams，改由 calcLayout 内的 computeLinePosYSpringParams 动态计算
  // setLinePosYSpringParams 不再 patch，0.5.0 会根据节奏动态调整参数，需全量更新所有行

  patchedPlayerSpringPrototypes.add(prototype);
};

// spring 模式：calcLayout 时标记活跃区域，让 setTransform patch 跳过远离活跃区域的行
// 非 spring 模式：不标记，所有行正常走 CSS transition
const CALC_LAYOUT_SKIP_RADIUS = 15;
const patchPlayerCalcLayoutPrototype = (player: InternalLyricPlayer) => {
  const prototype = Object.getPrototypeOf(player) as InternalLyricPlayerPrototype | null;
  if (!prototype?.calcLayout || patchedPlayerCalcLayoutPrototypes.has(prototype)) return;

  const originalCalcLayout = prototype.calcLayout;
  prototype.calcLayout = function (this: InternalLyricPlayer, sync?: boolean, force?: boolean) {
    // 非 spring 模式不标记活跃区域
    if (this.getEnableSpring?.() !== false) {
      const hotLines = getVisualHotLineIndices(this);
      const bufferedLines = getBufferedLines(this);
      const scrollToIndex = getScrollToIndex(this);
      const activeRange = new Set<number>();
      for (const idx of hotLines) {
        for (let j = Math.max(0, idx - CALC_LAYOUT_SKIP_RADIUS); j <= idx + CALC_LAYOUT_SKIP_RADIUS; j++) {
          activeRange.add(j);
        }
      }
      for (const idx of bufferedLines) {
        for (let j = Math.max(0, idx - CALC_LAYOUT_SKIP_RADIUS); j <= idx + CALC_LAYOUT_SKIP_RADIUS; j++) {
          activeRange.add(j);
        }
      }
      if (typeof scrollToIndex === "number") {
        for (let j = Math.max(0, scrollToIndex - CALC_LAYOUT_SKIP_RADIUS); j <= scrollToIndex + CALC_LAYOUT_SKIP_RADIUS; j++) {
          activeRange.add(j);
        }
      }
      this.__amllCalcLayoutActiveRange = activeRange;
    }
    const result = originalCalcLayout.call(this, sync, force);
    this.__amllCalcLayoutActiveRange = undefined;
    return result;
  };

  patchedPlayerCalcLayoutPrototypes.add(prototype);
};

// spring 模式：只更新活跃区域内的行，远离活跃区域的行已通过 force=true 落位，无需逐帧更新弹簧
// 非 spring 模式：保留原生 update（只更新 bottomLine + interludeDots，行由 CSS transition 驱动）
const patchPlayerUpdatePrototype = (player: InternalLyricPlayer) => {
  const prototype = Object.getPrototypeOf(player) as InternalLyricPlayerPrototype | null;
  if (!prototype?.update || patchedPlayerUpdatePrototypes.has(prototype)) return;

  const originalUpdate = prototype.update;
  prototype.update = function (this: InternalLyricPlayer, delta = 0) {
    // 非 spring 模式走原生逻辑
    if (this.getEnableSpring?.() === false) {
      return originalUpdate.call(this, delta);
    }

    if (!isInitialLayoutFinished(this)) return;

    this.bottomLine?.update?.(delta / 1000);
    this.interludeDots?.update?.(delta);
    if (this.supportMaskImage === false) {
      this.element?.style.setProperty("--amll-player-time", `${this.getCurrentTime?.() ?? 0}`);
    }
    if (this.isPageVisible === false) return;

    const lineObjects = getLineObjects(this);
    if (!Array.isArray(lineObjects) || lineObjects.length === 0) return;

    const deltaSeconds = delta / 1000;

    // 用户滚动时全量更新，保证滚动过程中所有可见行位置正确
    if (isUserScrolling(this)) {
      for (const lineObject of lineObjects) lineObject.update?.(deltaSeconds);
      return;
    }

    // 正常播放时只更新活跃区域内的行
    const updateIndices = (this.__amllReusedUpdateIndices ??= new Set<number>());
    updateIndices.clear();
    for (const index of getVisualHotLineIndices(this)) {
      addNearbyLineIndices(updateIndices, index, HOT_LINE_UPDATE_RADIUS, lineObjects.length);
    }
    for (const index of getBufferedLines(this)) {
      addNearbyLineIndices(updateIndices, index, BUFFERED_LINE_UPDATE_RADIUS, lineObjects.length);
    }
    addNearbyLineIndices(
      updateIndices,
      getScrollToIndex(this),
      LINE_UPDATE_INDEX_RADIUS,
      lineObjects.length,
    );

    for (const index of updateIndices) lineObjects[index]?.update?.(deltaSeconds);
  };

  patchedPlayerUpdatePrototypes.add(prototype);
};

const patchLyricPlayerInternals = (player: InternalLyricPlayer) => {
  player.__amllOptimizeForWebView = props.optimizeForWebView;
  patchPlayerScrollPrototype(player);
  patchPlayerSpringPrototype(player);
  patchPlayerCalcLayoutPrototype(player);
  patchPlayerUpdatePrototype(player);
  const lineObjects = getLineObjects(player);
  for (const lineObject of lineObjects ?? []) {
    patchLineVisibilityPrototype(lineObject);
    patchLineRebuildStylePrototype(lineObject);
    patchLineSetTransformPrototype(lineObject);
    patchLineApplyAlphaPrototype(lineObject);
    patchLineUpdatePrototype(lineObject);
  }
  if (player.__amllIndexedLineObjects !== lineObjects) {
    refreshLineIndexes(player);
  } else if (!player.__amllOptimizeForWebView) {
    syncVisibleInactiveLineClasses(player);
  }
};

const isValidPlaybackTime = (time: unknown): time is number =>
  typeof time === "number" && Number.isFinite(time);

const getPlayerLine = (
  player: InternalLyricPlayer,
  lineObjects: InternalLyricLineObject[],
  index: number,
) => lineObjects[index]?.getLine?.() ?? player.processedLines?.[index];

const isLineActive = (line: LyricLine | undefined, time: number) =>
  Boolean(line && isValidPlaybackTime(line.startTime) && line.startTime <= time && line.endTime > time);

const getVisualHotLineIndices = (player: InternalLyricPlayer) => {
  const hotLines = new Set(getHotLines(player));
  const lineObjects = getLineObjects(player);
  const currentTime = player.getCurrentTime?.() ?? player.timelineState?.currentTime ?? player.currentTime;
  const bufferedLines = getBufferedLines(player);

  for (const index of bufferedLines) hotLines.add(index);

  if (Array.isArray(lineObjects) && bufferedLines.size > 0) {
    const scrollToIndex = getScrollToIndex(player);
    const latestBufferedIndex = Math.max(...bufferedLines);
    if (
      typeof scrollToIndex === "number" &&
      Number.isFinite(scrollToIndex) &&
      Number.isFinite(latestBufferedIndex)
    ) {
      const startIndex = Math.max(0, Math.min(scrollToIndex, latestBufferedIndex));
      const endIndex = Math.min(lineObjects.length - 1, Math.max(scrollToIndex, latestBufferedIndex));
      for (let index = startIndex; index <= endIndex; index += 1) hotLines.add(index);
    }
  }

  if (!Array.isArray(lineObjects) || !isValidPlaybackTime(currentTime)) return hotLines;

  lineObjects.forEach((lineObject, index) => {
    const line = lineObject.getLine?.() ?? player.processedLines?.[index];
    if (!line?.isBG || hotLines.has(index)) return;
    if (isLineActive(line, currentTime)) hotLines.add(index);
  });

  return hotLines;
};

const getHotLineEndTime = (
  player: InternalLyricPlayer,
  lineObjects: InternalLyricLineObject[],
  index: number,
) => {
  const line = getPlayerLine(player, lineObjects, index);
  if (!line || line.isBG) return null;

  const nextLine = getPlayerLine(player, lineObjects, index + 1);
  if (nextLine?.isBG) {
    const nextMainLine = getPlayerLine(player, lineObjects, index + 2);
    return Math.min(
      Math.max(line.endTime, nextMainLine?.startTime ?? Number.MAX_VALUE),
      Math.max(line.endTime, nextLine.endTime),
    );
  }

  return line.endTime;
};

const getNextMainLineStartTime = (
  player: InternalLyricPlayer,
  lineObjects: InternalLyricLineObject[],
  index: number,
) => {
  for (let nextIndex = index + 1; nextIndex < lineObjects.length; nextIndex += 1) {
    const nextLine = getPlayerLine(player, lineObjects, nextIndex);
    if (!nextLine || nextLine.isBG) continue;
    return nextLine.startTime;
  }
  return null;
};

const getVisualHotLineEndTime = (
  player: InternalLyricPlayer,
  lineObjects: InternalLyricLineObject[],
  index: number,
) => {
  const lineEndTime = getHotLineEndTime(player, lineObjects, index);
  if (lineEndTime === null) return null;

  const nextStartTime = getNextMainLineStartTime(player, lineObjects, index);
  if (nextStartTime !== null && nextStartTime > lineEndTime) return nextStartTime;

  return lineEndTime;
};

const getNextPlaybackBoundary = (player: InternalLyricPlayer, time: number) => {
  const lineObjects = getLineObjects(player);
  if (!Array.isArray(lineObjects) || lineObjects.length === 0) return Number.POSITIVE_INFINITY;

  let boundary = Number.POSITIVE_INFINITY;
  const hotLines = getHotLines(player);
  for (const index of hotLines) {
    const endTime = getVisualHotLineEndTime(player, lineObjects, index);
    if (endTime !== null && endTime > time) boundary = Math.min(boundary, endTime);
  }

  lineObjects.forEach((lineObject, index) => {
    if (hotLines.has(index)) return;
    const line = lineObject.getLine?.();
    if (!line || line.isBG || !isValidPlaybackTime(line.startTime)) return;
    if (line.startTime > time) boundary = Math.min(boundary, line.startTime);
  });

  return boundary;
};

const isWithinFinishedHotLineHold = (player: InternalLyricPlayer, time: number) => {
  const lineObjects = getLineObjects(player);
  if (!Array.isArray(lineObjects) || lineObjects.length === 0) return false;

  for (const index of getHotLines(player)) {
    const lineEndTime = getHotLineEndTime(player, lineObjects, index);
    const visualEndTime = getVisualHotLineEndTime(player, lineObjects, index);
    if (lineEndTime === null || visualEndTime === null) continue;
    if (time >= lineEndTime && time < visualEndTime) return true;
  }
  return false;
};

const refreshPlaybackFastSyncWindow = (player: InternalLyricPlayer, time: number) => {
  player.__amllPlaybackFastSyncUntil = getNextPlaybackBoundary(player, time);
  player.__amllPlaybackFastSyncLastTime = time;
  player.__amllPlaybackFastSyncPlaying = props.playing;
};

const syncPlaybackClockOnly = (player: InternalLyricPlayer, time: number) => {
  syncPlaybackClockState(player, time);
  refreshPlaybackFastSyncWindow(player, time);
};

const trySyncPlaybackFast = (player: InternalLyricPlayer, time: number) => {
  // 非弹簧模式下必须每次调用 setCurrentTime 以触发 CSS 过渡动画
  if (player.getEnableSpring?.() === false) return false;
  const lastTime = player.__amllPlaybackFastSyncLastTime ?? getLastCurrentPlayerTime(player);
  const syncUntil = player.__amllPlaybackFastSyncUntil;
  if (!props.playing || player.__amllPlaybackFastSyncPlaying !== props.playing) return false;
  if (!isValidPlaybackTime(lastTime) || !isValidPlaybackTime(syncUntil)) return false;
  if (time < lastTime || time - lastTime > PLAYBACK_FAST_SYNC_MAX_DELTA) return false;
  if (time >= syncUntil) return false;

  syncPlaybackClockOnly(player, time);
  return true;
};

// 同步激活行的动画时间
const syncHotLineAnimations = (
  player: InternalLyricPlayer,
  time: number,
  previousHotLines?: Set<number>,
) => {
  const hotLines = getHotLines(player);
  const currentLyricLineObjects = getLineObjects(player);
  if (!Array.isArray(currentLyricLineObjects)) return;

  for (const id of hotLines) {
    const lineObject = currentLyricLineObjects[id];
    if (previousHotLines?.has(id) && hasActiveLineClass(lineObject)) continue;
    void currentLyricLineObjects[id]?.enable?.(time, props.playing);
  }
};

// 补回异常丢失的激活态
const syncMissingHotLineAnimations = (player: InternalLyricPlayer, time: number) => {
  const currentLyricLineObjects = getLineObjects(player);
  if (!Array.isArray(currentLyricLineObjects)) return;

  for (const id of getVisualHotLineIndices(player)) {
    const lineObject = currentLyricLineObjects[id];
    if (hasActiveLineClass(lineObject)) continue;
    void lineObject?.enable?.(time, props.playing);
  }
};

// 补齐新激活行的动画时间
const syncNewHotLineAnimations = (
  player: InternalLyricPlayer,
  previousHotLines: Set<number>,
  time: number,
) => syncHotLineAnimations(player, time, previousHotLines);

// 正常播放时同步时间
const syncPlaybackTime = (time: number) => {
  const player = getInternalPlayer();
  if (!player) return;

  patchLyricPlayerInternals(player);
  if (trySyncPlaybackFast(player, time)) {
    syncMissingHotLineAnimations(player, time);
    return;
  }
  if (isWithinFinishedHotLineHold(player, time)) {
    syncPlaybackClockOnly(player, time);
    syncMissingHotLineAnimations(player, time);
    if (!player.__amllOptimizeForWebView) syncVisibleInactiveLineClasses(player);
    return;
  }

  if (
    player.getEnableSpring?.() === false &&
    player.element?.classList.contains(USER_SCROLLING_CLASS)
  ) {
    // 用户滚动时暂停非弹簧过渡，避免和手势抢渲染
    syncPlaybackClockOnly(player, time);
    if (!player.__amllOptimizeForWebView) syncVisibleInactiveLineClasses(player);
    return;
  }

  const shouldSyncHotLineAnimations =
    !props.playing || player.__amllPlaybackFastSyncPlaying !== props.playing;
  const previousHotLines = new Set(getHotLines(player));
  player.setCurrentTime(time, false);
  syncHotLineClassesImmediate(player);
  if (shouldSyncHotLineAnimations) syncHotLineAnimations(player, time);
  else syncNewHotLineAnimations(player, previousHotLines, time);
  syncVisibleInactiveLineClasses(player);
  refreshPlaybackFastSyncWindow(player, time);
};

// 跳转或重载歌词时强制落位
const syncSeekTime = (time: number) => {
  const player = getInternalPlayer();
  if (!player) return;

  patchLyricPlayerInternals(player);
  clearUserScrollTransition(player);
  cancelVisibleInactiveClassSync(player);
  player.setCurrentTime(time, true);
  syncHotLineClassesImmediate(player);
  refreshLineIndexes(player);
  syncVisibleInactiveLineClasses(player);
  refreshPlaybackFastSyncWindow(player, time);
};

// 组件挂载时初始化
onMounted(() => {
  const wrapper = wrapperRef.value;
  if (wrapper) {
    playerRef.value = new CoreLyricPlayer();
    wrapper.appendChild(playerRef.value.getElement());
    playerRef.value.addEventListener("line-click", lineClickHandler);
    playerRef.value.addEventListener("line-contextmenu", lineContextMenuHandler);
  }
});

// 组件卸载时清理
onUnmounted(() => {
  const player = playerRef.value;
  if (player) {
    const internalPlayer = player as InternalLyricPlayer;
    clearUserScrollTransition(internalPlayer);
    cancelVisibleInactiveClassSync(internalPlayer);
    if (pendingCurrentTimeFrame !== undefined) cancelAnimationFrame(pendingCurrentTimeFrame);
    player.removeEventListener("line-click", lineClickHandler);
    player.removeEventListener("line-contextmenu", lineContextMenuHandler);
    player.dispose();
  }
});

// 动画帧更新（60fps 纯 rAF，在 120Hz 设备上帧间隔均匀）
const AMLL_FRAME_INTERVAL = 1000 / 60;
const AMLL_FRAME_EPSILON = 0.5;
watchEffect((onCleanup) => {
  if (props.disabled || !props.playing) return;

  let canceled = false;
  let frameId: number | undefined;
  let lastFrameAt = performance.now();

  const onFrame = (time: number) => {
    if (canceled) return;
    const delta = time - lastFrameAt;
    if (delta + AMLL_FRAME_EPSILON >= AMLL_FRAME_INTERVAL) {
      playerRef.value?.update(delta);
      lastFrameAt = time;
    }
    frameId = requestAnimationFrame(onFrame);
  };

  frameId = requestAnimationFrame(onFrame);
  onCleanup(() => {
    canceled = true;
    if (frameId !== undefined) cancelAnimationFrame(frameId);
  });
});

// 播放/暂停状态
watch(
  [() => props.playing, playerRef],
  ([playing, player]) => {
    if (!player) return;
    if (playing !== false) {
      player.resume();
      const internalPlayer = player as InternalLyricPlayer;
      patchLyricPlayerInternals(internalPlayer);
      if (isWithinFinishedHotLineHold(internalPlayer, props.currentTime)) {
        syncPlaybackClockOnly(internalPlayer, props.currentTime);
      } else {
        player.setCurrentTime(props.currentTime, false);
      }
      syncHotLineAnimations(internalPlayer, props.currentTime);
      refreshPlaybackFastSyncWindow(internalPlayer, props.currentTime);
    } else {
      player.pause();
    }
  },
  { immediate: true },
);

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
  const player = getInternalPlayer();
  if (player && player.getEnableSpring?.() !== false) clearUserScrollTransition(player);
});

// WebView 性能模式
watchEffect(() => {
  const player = getInternalPlayer();
  if (player) player.__amllOptimizeForWebView = props.optimizeForWebView;
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
watch(
  [() => props.lyricLines, playerRef],
  ([lines, player]) => {
    if (lines === undefined || !player) return;
    player.setLyricLines(lines);
    patchLyricPlayerInternals(player as InternalLyricPlayer);
    syncSeekTime(props.currentTime);
  },
  { immediate: true },
);

// 当前播放时间（同帧合并，避免 Capacitor Bridge 批量推送导致响应式风暴）
let pendingCurrentTime: number | undefined;
let pendingCurrentTimeFrame: number | undefined;
const flushCurrentTime = () => {
  const time = pendingCurrentTime;
  pendingCurrentTime = undefined;
  pendingCurrentTimeFrame = undefined;
  if (time === undefined) return;
  const player = getInternalPlayer();
  if (!player) return;
  const oldTime = getLastCurrentPlayerTime(player);
  const isSeek = oldTime !== undefined && Math.abs(time - oldTime) > 1000;
  if (isSeek) {
    syncSeekTime(time);
  } else {
    syncPlaybackTime(time);
  }
};

watch(
  () => props.currentTime,
  (time) => {
    if (time === undefined) return;
    const player = getInternalPlayer();
    if (!player) return;
    if (pendingCurrentTimeFrame !== undefined) {
      // 同帧已有待处理的更新，只保留最新值
      pendingCurrentTime = time;
    } else {
      // 首次更新，直接同步处理避免延迟一帧
      const oldTime = getLastCurrentPlayerTime(player);
      const isSeek = oldTime !== undefined && Math.abs(time - oldTime) > 1000;
      if (isSeek) {
        syncSeekTime(time);
      } else {
        syncPlaybackTime(time);
      }
      // 标记本帧已处理，后续同帧更新走 rAF 合并
      pendingCurrentTime = undefined;
      pendingCurrentTimeFrame = requestAnimationFrame(() => {
        pendingCurrentTimeFrame = undefined;
        if (pendingCurrentTime !== undefined) flushCurrentTime();
      });
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

<style scoped>
:deep(.amll-lyric-player.splayer-amll-user-scrolling > *) {
  transition: none !important;
}

:deep(.amll-lyric-player[class*="_disableSpring"] > [class*="_lyricBgLine"]) {
  transition: opacity var(--splayer-amll-visual-duration, 0.25s),
    scale var(--splayer-amll-transform-duration, 0.5s), filter 0.2s,
    background-color 0.25s, box-shadow 0.25s !important;
  transition-delay: 0ms !important;
}

:deep(.amll-lyric-player[class*="_disableSpring"] > [class*="_lyricBgLine"][class*="_active"]) {
  transition: opacity var(--splayer-amll-visual-duration, 0.5s)
      var(--splayer-amll-bg-active-delay, 0.25s),
    scale var(--splayer-amll-bg-scale-duration, 1.5s) cubic-bezier(0, 1, 0, 1)
      var(--splayer-amll-bg-active-delay, 0.25s),
    filter 0.2s, background-color 0.25s, box-shadow 0.25s !important;
}

:deep(.amll-lyric-player > [class*="_tmpDisableTransition"]),
:deep(.amll-lyric-player > [class*="_tmpDisableTransition"] > *),
:deep(
    .amll-lyric-player[class*="_disableSpring"]
      > [class*="_lyricBgLine"][class*="_tmpDisableTransition"]
  ) {
  transition: none !important;
}

:deep(.splayer-amll-visible-inactive) {
  opacity: 0.45 !important;
}

/* 非 hot 行的逐词 span 移除 will-change 和 backface-visibility，减少合成层数量 */
:deep(.amll-lyric-player > :not(.splayer-amll-hot) [class*="lyricMainLine"] > span),
:deep(.amll-lyric-player > :not(.splayer-amll-hot) [class*="emphasizeWrapper"]),
:deep(.amll-lyric-player > :not(.splayer-amll-hot) [class*="emphasize"] > span) {
  will-change: auto !important;
  backface-visibility: visible !important;
}

/* spring 模式：所有行移除 will-change 和 backface-visibility，JS 逐帧写 transform 时浏览器自动提升合成层 */
:deep(.amll-lyric-player:not([class*="_disableSpring"]) > [class*="_lyricLine"]) {
  will-change: auto !important;
  backface-visibility: visible !important;
}

/* spring 模式：词级 span 也移除，逐词动画由 Web Animations API 驱动，浏览器自动处理 */
:deep(.amll-lyric-player:not([class*="_disableSpring"]) [class*="lyricMainLine"] > span),
:deep(.amll-lyric-player:not([class*="_disableSpring"]) [class*="emphasizeWrapper"]),
:deep(.amll-lyric-player:not([class*="_disableSpring"]) [class*="emphasize"] > span) {
  will-change: auto !important;
  backface-visibility: visible !important;
}

/* spring 模式下 JS 逐帧驱动 transform/filter，禁用 CSS transition 避免冲突 */
:deep(.amll-lyric-player:not([class*="_disableSpring"]) > [class*="_lyricLine"]) {
  transition: opacity .25s, background-color .25s, box-shadow .25s !important;
}
</style>
