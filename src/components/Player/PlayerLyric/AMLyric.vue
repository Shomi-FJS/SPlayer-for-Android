<template>
  <Transition name="fade" mode="out-in">
    <div
      :key="amLyricsData?.[0]?.words?.length"
      :class="[
        'lyric-am',
        {
          pure: statusStore.pureLyricMode,
          duet: hasDuet,
          'align-right': settingStore.lyricAlignRight,
          android: isCapacitorAndroid,
        },
      ]"
      :style="{
        '--amll-lp-color': 'rgb(var(--main-cover-color, 239 239 239))',
        '--amll-lp-hover-bg-color': statusStore.playerMetaShow
          ? 'rgba(var(--main-cover-color), 0.08)'
          : 'transparent',
        '--amll-lyric-left-padding': settingStore.lyricAlignRight
          ? ''
          : `${settingStore.lyricHorizontalOffset}px`,
        '--amll-lyric-right-padding': settingStore.lyricAlignRight
          ? `${settingStore.lyricHorizontalOffset}px`
          : '',
      }"
    >
      <div v-if="statusStore.lyricLoading" class="lyric-loading">歌词正在加载中...</div>
      <LyricPlayer
        v-else
        ref="lyricPlayerRef"
        :lyricLines="amLyricsData"
        :currentTime="currentTime"
        :playing="statusStore.playStatus"
        :enableSpring="settingStore.useAMSpring"
        :enableScale="settingStore.useAMSpring"
        :optimizeForWebView="isAndroidSpringMode"
        :alignPosition="effectiveLyricsScrollOffset"
        :alignAnchor="effectiveLyricsScrollOffset > 0.4 ? 'center' : 'top'"
        :enableBlur="settingStore.lyricsBlur"
        :hidePassedLines="settingStore.hidePassedLines"
        :wordFadeWidth="settingStore.wordFadeWidth"
        :style="lyricPlayerStyle"
        class="am-lyric"
        @line-click="jumpSeek"
      />
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { LyricLineMouseEvent, type LyricLine } from "@applemusic-like-lyrics/core";
import { useMusicStore, useSettingStore, useStatusStore } from "@/stores";
import { getLyricLanguage } from "@/utils/format";
import { usePlayerController } from "@/core/player/PlayerController";
import { cloneDeep } from "lodash-es";
import { isCapacitorAndroid } from "@/utils/env";
import { lyricLangFontStyle } from "@/utils/lyric/lyricFontConfig";
import { getFontSize } from "@/utils/style";

const props = defineProps({
  currentTime: {
    type: Number,
    default: 0,
  },
});

const musicStore = useMusicStore();
const statusStore = useStatusStore();
const settingStore = useSettingStore();
const player = usePlayerController();

const lyricPlayerRef = ref<any | null>(null);

const effectiveLyricsScrollOffset = computed(() =>
  isCapacitorAndroid
    ? Math.max(0, settingStore.lyricsScrollOffset - 0.08)
    : settingStore.lyricsScrollOffset,
);

const isAndroidSpringMode = computed(() => isCapacitorAndroid && settingStore.useAMSpring);

// 当前歌词
const amLyricsData = computed(() => {
  const { songLyric } = musicStore;
  if (!songLyric) return [];
  // 优先使用逐字歌词(YRC/TTML)
  const useYrc = songLyric.yrcData?.length && settingStore.showWordLyrics;
  const lyrics = useYrc ? songLyric.yrcData : songLyric.lrcData;
  // 简单检查歌词有效性
  if (!Array.isArray(lyrics) || lyrics.length === 0) return [];
  // 此处cloneDeep 删除会暴毙 不要动
  const clonedLyrics = cloneDeep(lyrics) as LyricLine[];
  // 处理歌词内容
  const { showTran, showRoma, showWordsRoma, swapTranRoma, lyricAlignRight } = settingStore;
  clonedLyrics.forEach((line) => {
    // 处理显隐
    if (!showTran) line.translatedLyric = "";
    if (!showRoma) line.romanLyric = "";
    if (!showWordsRoma) line.words?.forEach((word) => (word.romanWord = ""));
    // 调换翻译与音译位置
    if (swapTranRoma) {
      const temp = line.translatedLyric;
      line.translatedLyric = line.romanLyric;
      line.romanLyric = temp;
    }
    // 处理对唱方向反转
    if (lyricAlignRight) {
      line.isDuet = !line.isDuet;
    }
  });
  return clonedLyrics;
});

// 是否有对唱行
const hasDuet = computed(() => amLyricsData.value?.some((line) => line.isDuet) ?? false);

const isValidLyricTime = (time: unknown): time is number =>
  typeof time === "number" && Number.isFinite(time) && time >= 0;

const clampTransitionDuration = (duration: number, min: number, max: number) =>
  Math.round(Math.min(max, Math.max(min, duration)));

const mainLineStartTimes = computed(() =>
  amLyricsData.value
    .filter((line) => !line.isBG && isValidLyricTime(line.startTime))
    .map((line) => line.startTime)
    .sort((previousTime, nextTime) => previousTime - nextTime),
);

const medianMainLineInterval = computed(() => {
  const intervals = mainLineStartTimes.value
    .slice(1)
    .map((startTime, index) => startTime - mainLineStartTimes.value[index])
    .filter((duration) => duration > 0);
  if (intervals.length === 0) return 1000;

  const sortedIntervals = [...intervals].sort((previousDuration, nextDuration) =>
    previousDuration - nextDuration,
  );
  return sortedIntervals[Math.floor(sortedIntervals.length / 2)];
});

const currentMainLineInterval = computed(() => {
  const startTimes = mainLineStartTimes.value;
  if (startTimes.length < 2) return medianMainLineInterval.value;

  let currentIndex = -1;
  for (let index = startTimes.length - 1; index >= 0; index -= 1) {
    if (startTimes[index] > props.currentTime) continue;
    currentIndex = index;
    break;
  }
  if (currentIndex < 0 || currentIndex >= startTimes.length - 1) return medianMainLineInterval.value;

  const interval = startTimes[currentIndex + 1] - startTimes[currentIndex];
  return interval > 0 ? interval : medianMainLineInterval.value;
});

const nonSpringTransitionStyle = computed(() => {
  const lineInterval = currentMainLineInterval.value;
  const transformDuration = clampTransitionDuration(lineInterval * 0.38, 160, 430);
  const visualDuration = clampTransitionDuration(transformDuration * 0.75, 130, 330);
  const bgActiveDelay = clampTransitionDuration(lineInterval * 0.16, 70, 250);
  const bgScaleDuration = clampTransitionDuration(lineInterval * 0.85, 420, 1500);

  return {
    "--splayer-amll-transform-duration": `${transformDuration}ms`,
    "--splayer-amll-visual-duration": `${visualDuration}ms`,
    "--splayer-amll-bg-active-delay": `${bgActiveDelay}ms`,
    "--splayer-amll-bg-scale-duration": `${bgScaleDuration}ms`,
  };
});

const lyricPlayerStyle = computed(() => ({
  "--display-count-down-show": settingStore.countDownShow ? "flex" : "none",
  "--amll-lp-font-size": getFontSize(
    settingStore.lyricFontSize,
    settingStore.lyricFontSizeMode,
  ),
  "font-weight": settingStore.lyricFontWeight,
  "font-family": settingStore.LyricFont !== "follow" ? settingStore.LyricFont : "",
  ...nonSpringTransitionStyle.value,
  ...lyricLangFontStyle(settingStore),
}));

// 获取原始歌词行的真实发声时间
const getLineSeekTime = (line?: LyricLine) => {
  const firstWordStartTime = line?.words?.find(
    (word) => word.word?.trim() && isValidLyricTime(word.startTime),
  )?.startTime;

  if (isValidLyricTime(firstWordStartTime)) return firstWordStartTime;
  if (isValidLyricTime(line?.startTime)) return line.startTime;
  return null;
};

// 进度跳转
const jumpSeek = (event: LyricLineMouseEvent) => {
  const originalLine = amLyricsData.value[event.lineIndex];
  const eventLine = event.line.getLine();
  const time = getLineSeekTime(originalLine) ?? getLineSeekTime(eventLine);
  if (time === null) return;

  const offsetMs = statusStore.getSongOffset(musicStore.playSong?.id);
  player.setSeek(time - offsetMs);
  player.play();
};

// 处理歌词语言
const processLyricLanguage = (player = lyricPlayerRef.value) => {
  const lyricLineObjects = player?.lyricPlayer?.currentLyricLineObjects;
  if (!Array.isArray(lyricLineObjects) || lyricLineObjects.length === 0) {
    return;
  }
  // 遍历歌词行
  for (let e of lyricLineObjects) {
    // 获取歌词行内容 (合并逐字歌词为一句)
    const content = e.lyricLine.words.map((word: any) => word.word).join("");
    // 跳过空行
    if (!content) continue;
    // 获取歌词语言
    const lang = getLyricLanguage(content);
    // 为主歌词设置 lang 属性 (firstChild 获取主歌词 不为翻译和音译设置属性)
    e.element.firstChild.setAttribute("lang", lang);
  }
};

// 切换歌曲时处理歌词语言
watch(amLyricsData, (data) => {
  if (data) nextTick(() => processLyricLanguage());
});
watch(lyricPlayerRef, (player) => {
  if (player) nextTick(() => processLyricLanguage(player));
});
</script>

<style lang="scss" scoped>
.lyric-am {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  isolation: isolate;

  &.android {
    :deep(.amll-lyric-player) {
      mix-blend-mode: normal;
    }
  }

  :deep(.am-lyric) {
    width: 100%;
    height: 100%;
    position: absolute;
    left: 0;
    top: 0;
    padding-left: var(--amll-lyric-left-padding, 10px);
    padding-right: 80px;
    div {
      div[class^="_interludeDots"] {
        display: var(--display-count-down-show);
      }
    }
    @media (max-width: 990px) {
      padding: 0;
      margin-left: 0;
      .amll-lyric-player {
        > div {
          padding-left: 20px;
          padding-right: 20px;
        }
      }
    }
  }

  &.align-right {
    :deep(.am-lyric) {
      padding-left: 80px;
      padding-right: var(--amll-lyric-right-padding, 10px);

      @media (max-width: 990px) {
        padding: 0;
        margin-right: -20px;
      }
      @media (max-width: 500px) {
        margin-right: 0;
      }
    }
  }
  &.pure {
    &:not(.duet) {
      text-align: center;

      :deep(.am-lyric) div {
        transform-origin: center;
      }
    }

    :deep(.am-lyric) {
      margin: 0;
      padding: 0 80px;
    }
  }

  :deep(.am-lyric div[class*="lyricMainLine"] span) {
    text-align: start;
  }

  :lang(ja) {
    font-family: var(--ja-font-family);
  }
  :lang(en) {
    font-family: var(--en-font-family);
  }
  :lang(ko) {
    font-family: var(--ko-font-family);
  }

  // 非弹簧模式过渡优化：更平滑的缓动曲线和 GPU 合成提示
  :deep(.amll-lyric-player[class*="disableSpring"]) {
    > * {
      transition:
        filter var(--splayer-amll-visual-duration, 0.3s) cubic-bezier(0.25, 0.1, 0.25, 1),
        transform var(--splayer-amll-transform-duration, 0.38s)
          cubic-bezier(0.25, 0.1, 0.25, 1),
        opacity var(--splayer-amll-visual-duration, 0.3s) cubic-bezier(0.25, 0.1, 0.25, 1),
        background-color 0.25s,
        box-shadow 0.25s;
      will-change: transform, opacity;
      backface-visibility: hidden;
    }
  }
}

.lyric-loading {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--amll-lp-color, #efefef);
  font-size: 22px;
}
</style>
