import { AndroidNativePlayback } from "@/plugins/androidNativePlayback";
import { useMusicStore, useSettingStore, useStatusStore } from "@/stores";
import { isCapacitorAndroid } from "@/utils/env";
import { calculateLyricIndex } from "@/utils/calc";
import type { PluginListenerHandle } from "@capacitor/core";
import { onBeforeUnmount, ref, toRaw, watch } from "vue";
import type {
  AndroidNativeExternalAudioVisualizerChangedEvent,
  AndroidNativeMediaSourceChangedEvent,
} from "@/plugins/androidNativePlayback";
import { useAudioManager } from "@/core/player/AudioManager";
import { useLyricManager } from "@/core/player/LyricManager";

export const isExternalMediaSourceActive = ref(false);
export const ANDROID_MEDIA_SOURCE_DEFAULT_LYRIC_TIMEBASE_LEAD_MS = 0;
export const androidMediaSourceLyricTimebaseLead = ref(
  ANDROID_MEDIA_SOURCE_DEFAULT_LYRIC_TIMEBASE_LEAD_MS,
);
export const androidMediaSourceLatencyDeviceKey = ref("");
const MAX_CAPTURE_COVER_BASE64_LENGTH = 5 * 1024 * 1024;
const RESUME_POSITION_REFRESH_DELAY_MS = 180;
const POSITION_TICKER_STALE_THRESHOLD_MS = 1_000;

type PlaybackPositionSnapshot = Pick<
  AndroidNativeMediaSourceChangedEvent,
  "positionMs" | "speed" | "updateTimeMs"
>;

const clampAndroidMediaSourceLatency = (value: number) => {
  if (!Number.isFinite(value)) return ANDROID_MEDIA_SOURCE_DEFAULT_LYRIC_TIMEBASE_LEAD_MS;
  return Math.min(1_000, Math.max(-1_000, Math.round(value)));
};

export const setAndroidMediaSourceLatencyAdjustment = (latencyMs: number) => {
  if (!isExternalMediaSourceActive.value || !androidMediaSourceLatencyDeviceKey.value) return;
  const settingStore = useSettingStore();
  const learnedLatency = clampAndroidMediaSourceLatency(latencyMs);
  androidMediaSourceLyricTimebaseLead.value = learnedLatency;
  settingStore.androidMediaSourceLatencyProfiles = {
    ...(settingStore.androidMediaSourceLatencyProfiles ?? {}),
    [androidMediaSourceLatencyDeviceKey.value]: learnedLatency,
  };
};

let resetAndroidMediaSourceSession: (() => void) | null = null;

export const leaveAndroidMediaSourceMode = () => {
  resetAndroidMediaSourceSession?.();
  isExternalMediaSourceActive.value = false;
  androidMediaSourceLatencyDeviceKey.value = "";
  androidMediaSourceLyricTimebaseLead.value =
    ANDROID_MEDIA_SOURCE_DEFAULT_LYRIC_TIMEBASE_LEAD_MS;
  const settingStore = useSettingStore();
  settingStore.androidMediaSourceVisualizerEnabled = false;
};

const getExternalMediaSourceId = (mediaKey: string) => {
  let hash = 0;
  for (let i = 0; i < mediaKey.length; i++) {
    hash = (hash * 31 + mediaKey.charCodeAt(i)) % 1_000_000_000;
  }
  return -(Math.abs(hash) || 1);
};

export const useAndroidMediaSourceListener = () => {
  if (!isCapacitorAndroid) return;

  const settingStore = useSettingStore();
  const musicStore = useMusicStore();
  const statusStore = useStatusStore();
  settingStore.androidMediaSourceVisualizerEnabled = false;
  let sourceListener: PluginListenerHandle | null = null;
  let externalVisualizerListener: PluginListenerHandle | null = null;
  let syncing = false;
  let visualizerSyncing = false;
  let lastMediaKey = "";
  let lastCoverFingerprint = "";
  let lyricRequestId = 0;
  let positionTicker: ReturnType<typeof setInterval> | null = null;
  let resumeRefreshTimer: number | null = null;
  let basePositionMs = 0;
  let baseUpdateTimeMs = 0;
  let baseUpdatePerfMs = 0;
  let playbackSpeed = 1;
  let coverUrl = "";
  let lastLyricIndex = -1;
  let latencyProfileRequestId = 0;
  let positionRefreshRequestId = 0;
  let lastTickerPerfMs = 0;

  const removeSourceListener = async () => {
    if (!sourceListener) return;
    const listener = sourceListener;
    sourceListener = null;
    await listener.remove();
  };

  const removeExternalVisualizerListener = async () => {
    if (!externalVisualizerListener) return;
    const listener = externalVisualizerListener;
    externalVisualizerListener = null;
    await listener.remove();
  };

  const stopPositionTicker = () => {
    if (positionTicker) {
      clearInterval(positionTicker);
      positionTicker = null;
    }
    lastTickerPerfMs = 0;
  };

  const clearResumeRefreshTimer = () => {
    if (resumeRefreshTimer) {
      window.clearTimeout(resumeRefreshTimer);
      resumeRefreshTimer = null;
    }
  };

  const updateLyricIndex = (currentTime: number) => {
    const useYrc = !!(settingStore.showWordLyrics && musicStore.songLyric.yrcData?.length);
    const rawLyrics = useYrc
      ? toRaw(musicStore.songLyric.yrcData)
      : toRaw(musicStore.songLyric.lrcData);
    const lyricTime = currentTime + androidMediaSourceLyricTimebaseLead.value;
    const lyricIndex = calculateLyricIndex(lyricTime, rawLyrics, 0, 3, 0);
    if (lyricIndex !== lastLyricIndex) {
      lastLyricIndex = lyricIndex;
      statusStore.lyricIndex = lyricIndex;
    }
  };

  const resetLatencyProfile = () => {
    latencyProfileRequestId++;
    androidMediaSourceLatencyDeviceKey.value = "";
    androidMediaSourceLyricTimebaseLead.value =
      ANDROID_MEDIA_SOURCE_DEFAULT_LYRIC_TIMEBASE_LEAD_MS;
  };

  const refreshLatencyProfile = async () => {
    const requestId = ++latencyProfileRequestId;
    try {
      const profile = await AndroidNativePlayback.getMediaSourceLatencyProfile();
      if (requestId !== latencyProfileRequestId) return;
      const profiles = settingStore.androidMediaSourceLatencyProfiles ?? {};
      const savedLatency = profiles[profile.deviceKey];
      const latencyMs = clampAndroidMediaSourceLatency(
        Number.isFinite(savedLatency) ? savedLatency : profile.suggestedLatencyMs,
      );
      androidMediaSourceLatencyDeviceKey.value = profile.deviceKey;
      androidMediaSourceLyricTimebaseLead.value = latencyMs;
      updateLyricIndex(statusStore.currentTime);
    } catch {
      if (requestId !== latencyProfileRequestId) return;
      androidMediaSourceLyricTimebaseLead.value =
        ANDROID_MEDIA_SOURCE_DEFAULT_LYRIC_TIMEBASE_LEAD_MS;
    }
  };

  const getProjectedPosition = (includeElapsed = statusStore.playStatus) => {
    const elapsed = includeElapsed && baseUpdatePerfMs > 0
      ? Math.max(0, (performance.now() - baseUpdatePerfMs) * playbackSpeed)
      : 0;
    const dur = statusStore.duration;
    const rawPos = Math.max(0, Math.round(basePositionMs + elapsed));
    return dur > 0 ? Math.min(rawPos, dur) : rawPos;
  };

  const updateStatusPosition = (position: number) => {
    const dur = statusStore.duration;
    statusStore.currentTime = position;
    if (dur > 0) {
      statusStore.progress = (position / dur) * 100;
    }
    updateLyricIndex(position);
  };

  const applyPlaybackPositionSnapshot = (
    snapshot: PlaybackPositionSnapshot,
    shouldUpdateCurrentTime = true,
    minUpdateTimeMs = 0,
  ) => {
    const hasPosition = snapshot.positionMs !== undefined && Number.isFinite(snapshot.positionMs);
    const hasUpdateTime = snapshot.updateTimeMs !== undefined && Number.isFinite(snapshot.updateTimeMs);

    if (hasPosition) {
      basePositionMs = Math.max(0, Math.round(snapshot.positionMs as number));
    }

    if (hasPosition || hasUpdateTime) {
      const now = Date.now();
      const updateTimeMs = hasUpdateTime ? snapshot.updateTimeMs as number : now;
      baseUpdateTimeMs = updateTimeMs > 0 && updateTimeMs <= now && updateTimeMs >= minUpdateTimeMs
        ? updateTimeMs
        : now;
      baseUpdatePerfMs = performance.now() - Math.max(0, now - baseUpdateTimeMs);
    }

    if (snapshot.speed !== undefined) {
      playbackSpeed = Number.isFinite(snapshot.speed) && snapshot.speed > 0
        ? snapshot.speed
        : 1;
    }

    if (shouldUpdateCurrentTime && hasPosition) {
      updateStatusPosition(getProjectedPosition());
    }
  };

  const refreshCapturePosition = async (minUpdateTimeMs = 0) => {
    const requestId = ++positionRefreshRequestId;
    try {
      const position = await AndroidNativePlayback.getCapturePosition();
      if (requestId !== positionRefreshRequestId || !isExternalMediaSourceActive.value) return;
      if (position.positionMs === undefined) return;
      if (
        minUpdateTimeMs > 0
        && position.updateTimeMs !== undefined
        && position.updateTimeMs < minUpdateTimeMs
      ) {
        return;
      }
      applyPlaybackPositionSnapshot(position);
    } catch {
      // 忽略位置刷新失败
    }
  };

  const scheduleCapturePositionRefresh = (minUpdateTimeMs = 0) => {
    clearResumeRefreshTimer();
    const scheduledRequestId = positionRefreshRequestId;
    resumeRefreshTimer = window.setTimeout(() => {
      resumeRefreshTimer = null;
      if (scheduledRequestId !== positionRefreshRequestId) return;
      void refreshCapturePosition(minUpdateTimeMs);
    }, RESUME_POSITION_REFRESH_DELAY_MS);
  };

  const startPositionTicker = () => {
    stopPositionTicker();
    lastTickerPerfMs = performance.now();
    positionTicker = setInterval(() => {
      if (!isExternalMediaSourceActive.value || baseUpdatePerfMs === 0) return;
      const nowPerf = performance.now();
      if (nowPerf - lastTickerPerfMs > POSITION_TICKER_STALE_THRESHOLD_MS) {
        lastTickerPerfMs = nowPerf;
        void refreshCapturePosition();
        return;
      }
      lastTickerPerfMs = nowPerf;
      updateStatusPosition(getProjectedPosition());
    }, 250);
  };

  const setCoverFromBase64 = (b64?: string) => {
    if (coverUrl) {
      URL.revokeObjectURL(coverUrl);
      coverUrl = "";
    }
    if (!b64) return;
    if (b64.length > MAX_CAPTURE_COVER_BASE64_LENGTH) {
      console.warn("[MediaSource] 封面数据过大，已跳过");
      return;
    }
    try {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      coverUrl = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
      musicStore.playSong = { ...musicStore.playSong, cover: coverUrl, coverSize: undefined };
    } catch {
      // Base64 解码失败，忽略
    }
  };

  const handleSelectionLost = () => {
    positionRefreshRequestId++;
    clearResumeRefreshTimer();
    isExternalMediaSourceActive.value = false;
    lastMediaKey = "";
    lastCoverFingerprint = "";
    lastLyricIndex = -1;
    resetLatencyProfile();
    basePositionMs = 0;
    baseUpdateTimeMs = 0;
    baseUpdatePerfMs = 0;
    playbackSpeed = 1;
    stopPositionTicker();
    if (coverUrl) {
      URL.revokeObjectURL(coverUrl);
      coverUrl = "";
    }
  };

  resetAndroidMediaSourceSession = handleSelectionLost;

  const handleMetadataEvent = (event: AndroidNativeMediaSourceChangedEvent) => {
    const wasExternalActive = isExternalMediaSourceActive.value;
    isExternalMediaSourceActive.value = true;

    if (!wasExternalActive) {
      try {
        const audioManager = useAudioManager();
        if (!audioManager.paused) {
          audioManager.pause({ fadeOut: false });
        }
      } catch {
        // 忽略引擎暂停错误
      }
    }

    const title = event.title || "安卓媒体源";
    const artist = event.artist || event.packageName || "未知来源";
    const mediaKey = `${event.packageName || ""}|${title}|${artist}|${event.album || ""}`;
    const coverFingerprint = event.coverFingerprint || mediaKey;
    if (mediaKey !== lastMediaKey) {
      positionRefreshRequestId++;
      clearResumeRefreshTimer();
      const sourceId = getExternalMediaSourceId(mediaKey);
      lastMediaKey = mediaKey;
      lastCoverFingerprint = "";
      lastLyricIndex = -1;
      basePositionMs = 0;
      baseUpdateTimeMs = 0;
      baseUpdatePerfMs = 0;
      statusStore.resetSongOffset(sourceId);
      musicStore.setSongLyric({ lrcData: [], yrcData: [] }, true);
      musicStore.playSong = {
        ...musicStore.playSong,
        id: sourceId,
        name: title,
        artists: artist,
        album: event.album || "未知专辑",
        duration: event.durationMs || 0,
        cover: "",
        coverSize: undefined,
        type: "song",
      };
      statusStore.$patch((state) => {
        state.currentTime = 0;
        state.progress = 0;
        state.duration = event.durationMs || 0;
        state.songQuality = undefined;
        state.audioSource = "local";
        state.availableQualities = [];
        state.lyricIndex = -1;
        state.lyricLoading = !!(event.title || event.artist);
      });
      if (event.title || event.artist) {
        void fetchLyricsForMediaSource(title, artist, mediaKey);
      }
      void refreshLatencyProfile();
    }

    if (coverFingerprint !== lastCoverFingerprint) {
      lastCoverFingerprint = coverFingerprint;
      if (event.coverBase64) {
        setCoverFromBase64(event.coverBase64);
      } else {
        void fetchCaptureCover();
      }
    }

    if (event.durationMs && event.durationMs > 0) {
      statusStore.duration = event.durationMs;
    }

    statusStore.showPlayBar = true;
    statusStore.playLoading = false;
  };

  const handlePlaybackStateEvent = (event: AndroidNativeMediaSourceChangedEvent) => {
    const wasPlaying = statusStore.playStatus;
    const resumeWallMs = event.isPlaying === true && !wasPlaying ? Date.now() : 0;
    positionRefreshRequestId++;
    isExternalMediaSourceActive.value = true;

    if (event.isPlaying !== undefined) {
      statusStore.playStatus = event.isPlaying;
    }

    applyPlaybackPositionSnapshot(event, true, resumeWallMs);

    if (event.isPlaying === true) {
      if (!positionTicker) {
        startPositionTicker();
      }
      if (!wasPlaying) {
        scheduleCapturePositionRefresh(resumeWallMs);
      }
    } else if (event.isPlaying === false) {
      clearResumeRefreshTimer();
      stopPositionTicker();
    }

    statusStore.showPlayBar = true;
  };

  const handleEvent = (event: AndroidNativeMediaSourceChangedEvent) => {
    const target = settingStore.androidMediaSourceTargetPackage;
    if (target && event.packageName && event.packageName !== target) return;

    switch (event.eventType) {
      case "metadata":
        handleMetadataEvent(event);
        break;
      case "playbackState":
        handlePlaybackStateEvent(event);
        break;
      case "selectionLost":
        handleSelectionLost();
        break;
      case "selected":
        isExternalMediaSourceActive.value = true;
        void refreshLatencyProfile();
        break;
      case "sessionsChanged":
        break;
    }
  };

  const fetchLyricsForMediaSource = async (title: string, artist: string, mediaKey: string) => {
    const requestId = ++lyricRequestId;
    try {
      const lyricManager = useLyricManager();
      await lyricManager.searchAndLoadLyric(title, artist);
      if (requestId !== lyricRequestId || mediaKey !== lastMediaKey) return;
      lastLyricIndex = -1;
      updateLyricIndex(statusStore.currentTime);
    } catch (error) {
      console.warn("[MediaSource] 歌词查询失败:", error);
    }
  };

  const fetchCaptureCover = async () => {
    try {
      const result = await AndroidNativePlayback.getCaptureCover();
      if (result.coverBase64) {
        setCoverFromBase64(result.coverBase64);
      }
    } catch {
      // 静默失败，歌词搜索时已有兜底
    }
  };

  const _syncCurrentMediaSource = async () => {
    const result = await AndroidNativePlayback.getActiveMediaSources();
    const target = settingStore.androidMediaSourceTargetPackage;
    const source = target
      ? result.sources.find((item) => item.packageName === target)
      : result.sources.find((item) => item.isPlaying) || result.sources[0];
    if (!source) return;
    handleMetadataEvent({
      eventType: "metadata",
      ...source,
    });
    if (source.positionMs !== undefined) {
      handlePlaybackStateEvent({
        eventType: "playbackState",
        playbackState: source.playbackState,
        isPlaying: source.isPlaying,
        positionMs: source.positionMs,
        speed: 1,
        updateTimeMs: Date.now(),
      });
    }
  };

  const enableNativeListener = async () => {
    if (!sourceListener) {
      sourceListener = await AndroidNativePlayback.addListener(
        "mediaSourceChanged",
        (event: AndroidNativeMediaSourceChangedEvent) => {
          handleEvent(event);
        },
      );
    }
    const result = await AndroidNativePlayback.enableMediaSourceListener();
    if (!result.enabled || !result.granted) {
      await removeSourceListener();
      settingStore.androidMediaSourceListenerEnabled = false;
      window.$message.error("请在系统设置中允许 SPlayer 读取通知后重试");
      return;
    }
    await AndroidNativePlayback.setMediaSourceTargetPackage({
      packageName: settingStore.androidMediaSourceTargetPackage,
    });
    void refreshLatencyProfile();
  };

  const disableNativeListener = async () => {
    positionRefreshRequestId++;
    clearResumeRefreshTimer();
    settingStore.androidMediaSourceVisualizerEnabled = false;
    await AndroidNativePlayback.enableExternalAudioVisualizer({ enable: false });
    await removeSourceListener();
    await AndroidNativePlayback.disableMediaSourceListener();
    isExternalMediaSourceActive.value = false;
    lastMediaKey = "";
    lastCoverFingerprint = "";
    lastLyricIndex = -1;
    resetLatencyProfile();
    stopPositionTicker();
    if (coverUrl) {
      URL.revokeObjectURL(coverUrl);
      coverUrl = "";
    }
  };

  const enableExternalAudioVisualizer = async () => {
    if (!externalVisualizerListener) {
      externalVisualizerListener = await AndroidNativePlayback.addListener(
        "externalAudioVisualizerChanged",
        (event: AndroidNativeExternalAudioVisualizerChangedEvent) => {
          if (!event.enabled) {
            settingStore.androidMediaSourceVisualizerEnabled = false;
          }
        },
      );
    }
    const result = await AndroidNativePlayback.enableExternalAudioVisualizer({ enable: true });
    if (!result.granted) {
      settingStore.androidMediaSourceVisualizerEnabled = false;
      await removeExternalVisualizerListener();
      window.$message.warning("媒体源频谱未开启，可稍后从快捷菜单再试");
      return;
    }
    if (!settingStore.androidMediaSourceListenerEnabled) {
      settingStore.androidMediaSourceVisualizerEnabled = false;
      await disableExternalAudioVisualizer();
      return;
    }
    window.$message.success("媒体源频谱已开启");
  };

  const disableExternalAudioVisualizer = async () => {
    await AndroidNativePlayback.enableExternalAudioVisualizer({ enable: false });
    await removeExternalVisualizerListener();
  };

  const stop = watch(
    () => settingStore.androidMediaSourceListenerEnabled,
    async (enabled) => {
      if (syncing) return;
      syncing = true;
      try {
        if (enabled) {
          await enableNativeListener();
        } else {
          await disableNativeListener();
        }
      } catch (error) {
        await removeSourceListener();
        settingStore.androidMediaSourceListenerEnabled = false;
        settingStore.androidMediaSourceVisualizerEnabled = false;
        isExternalMediaSourceActive.value = false;
        positionRefreshRequestId++;
        clearResumeRefreshTimer();
        await disableExternalAudioVisualizer();
        stopPositionTicker();
        window.$message.error(`媒体源监听启动失败：${error}`);
      } finally {
        syncing = false;
      }
    },
    { immediate: true },
  );

  const stopTargetWatch = watch(
    () => settingStore.androidMediaSourceTargetPackage,
    async (packageName) => {
      if (!settingStore.androidMediaSourceListenerEnabled || syncing) return;
      positionRefreshRequestId++;
      clearResumeRefreshTimer();
      lastMediaKey = "";
      await AndroidNativePlayback.setMediaSourceTargetPackage({ packageName });
      void refreshLatencyProfile();
    },
  );

  const stopVisualizerWatch = watch(
    () => [
      settingStore.androidMediaSourceVisualizerEnabled,
      settingStore.androidMediaSourceListenerEnabled,
    ] as const,
    async ([enabled, listenerEnabled]) => {
      if (visualizerSyncing) return;
      visualizerSyncing = true;
      try {
        if (enabled && listenerEnabled) {
          await enableExternalAudioVisualizer();
        } else {
          await disableExternalAudioVisualizer();
          if (enabled && !listenerEnabled) {
            settingStore.androidMediaSourceVisualizerEnabled = false;
          }
        }
      } catch (error) {
        settingStore.androidMediaSourceVisualizerEnabled = false;
        window.$message.error(`媒体源频谱启动失败：${error}`);
      } finally {
        visualizerSyncing = false;
      }
    },
  );

  onBeforeUnmount(() => {
    if (resetAndroidMediaSourceSession === handleSelectionLost) {
      resetAndroidMediaSourceSession = null;
    }
    stop();
    stopTargetWatch();
    stopVisualizerWatch();
    positionRefreshRequestId++;
    clearResumeRefreshTimer();
    stopPositionTicker();
    void disableExternalAudioVisualizer();
    void removeExternalVisualizerListener();
    if (coverUrl) {
      URL.revokeObjectURL(coverUrl);
      coverUrl = "";
    }
    void removeSourceListener();
  });
};
