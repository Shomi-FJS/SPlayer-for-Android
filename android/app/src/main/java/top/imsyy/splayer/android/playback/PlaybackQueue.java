package top.imsyy.splayer.android.playback;

import androidx.annotation.Nullable;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Java 端自治的滑动窗口播放队列。WebView 冻结时仍能自主切歌。
 *
 * <p>JS 端推 ±N 首窗口（{@code updateQueueContext}），Java 端窗口耗尽时 emit
 * {@code requestUrls} 让 JS 补。不线程安全，依赖 PlaybackManager 的 synchronized。
 *
 * <p>详见 .scratch/native-queue-design.md。
 */
public final class PlaybackQueue {
  /** 当前窗口（已按 shuffleMode 排过序） */
  private List<Track> windowTracks = Collections.emptyList();
  /** 当前正在播的曲目在 windowTracks 中的索引；-1 表示队列空 */
  private int windowCurrentIndex = -1;
  /** 循环模式：跨歌曲行为由此决定 */
  private RepeatMode repeatMode = RepeatMode.OFF;
  /** 全局是否还有上一首 / 下一首（窗口外信息，由 JS 端计算后传入） */
  private boolean hasPreviousOutsideWindow = false;
  private boolean hasNextOutsideWindow = false;
  /** personalFM 模式：单首推进，不预解析多首 */
  private boolean personalFmMode = false;

  public enum RepeatMode {
    OFF,
    ALL,
    ONE;

    public static RepeatMode fromString(@Nullable String value) {
      if (value == null) return OFF;
      switch (value) {
        case "all":
          return ALL;
        case "one":
          return ONE;
        default:
          return OFF;
      }
    }
  }

  /** 单首曲目元数据 + 已解析 URL（null 表示解析失败/超时，Java 播到时跳过）。 */
  public static final class Track {
    /** 网易云 songId。必须 long：2024+ 部分 ID 超过 Integer.MAX_VALUE，int 会溢出为负。 */
    public long songId;
    public long durationMs;
    public boolean canLike;
    public boolean liked;
    public String title = "";
    public String artist = "";
    public String album = "";
    public String coverUrl = "";
    /** 已解析的播放 URL；null 表示该歌曲不可播 */
    @Nullable public String url;
    /** 该曲目在 JS 端 playList 中的实际索引，回调时让 JS 直接定位 */
    public int playListIndex = -1;

    public Track copy() {
      Track c = new Track();
      c.songId = songId;
      c.durationMs = durationMs;
      c.canLike = canLike;
      c.liked = liked;
      c.title = title;
      c.artist = artist;
      c.album = album;
      c.coverUrl = coverUrl;
      c.url = url;
      c.playListIndex = playListIndex;
      return c;
    }

    public boolean playable() {
      return url != null && !url.isEmpty();
    }
  }

  /** 替换整个窗口（来自 JS 端 updateQueueContext）。 */
  public synchronized void replace(
      List<Track> tracks,
      int currentIndex,
      RepeatMode mode,
      boolean prevOutside,
      boolean nextOutside,
      boolean personalFm) {
    // 拷贝传入列表防御性隔离，避免外部 mutation 影响内部状态
    if (tracks == null || tracks.isEmpty()) {
      windowTracks = Collections.emptyList();
      windowCurrentIndex = -1;
    } else {
      List<Track> copy = new ArrayList<>(tracks.size());
      for (Track t : tracks) {
        if (t != null) copy.add(t.copy());
      }
      windowTracks = copy;
      // -1 透传：表示 JS 端尚未确定 current（如列表瞬时清空），不强制视为 0；
      // 否则 favorite/同步等会作用在错误的"窗口首曲"上。
      if (currentIndex < 0) {
        windowCurrentIndex = -1;
      } else if (currentIndex >= copy.size()) {
        windowCurrentIndex = copy.size() - 1;
      } else {
        windowCurrentIndex = currentIndex;
      }
    }
    repeatMode = mode == null ? RepeatMode.OFF : mode;
    hasPreviousOutsideWindow = prevOutside;
    hasNextOutsideWindow = nextOutside;
    personalFmMode = personalFm;
  }

  /** 当前曲目（可能为 null：队列空 / index 越界）。 */
  @Nullable
  public synchronized Track current() {
    if (windowCurrentIndex < 0 || windowCurrentIndex >= windowTracks.size()) return null;
    return windowTracks.get(windowCurrentIndex);
  }

  /**
   * 推进到下一首；自动跳过 url==null。返回 null = 窗口耗尽，需 emit requestUrls。
   *
   * @param respectRepeatOne ENDED 调用传 true（响应单曲循环），用户 NEXT 传 false
   */
  @Nullable
  public synchronized Track advance(boolean respectRepeatOne) {
    if (windowTracks.isEmpty()) return null;

    // 单曲循环：保持当前 index 不变
    if (respectRepeatOne && repeatMode == RepeatMode.ONE) {
      return current();
    }

    // 顺序前进，跳过 url==null
    int probe = windowCurrentIndex + 1;
    while (probe < windowTracks.size()) {
      Track t = windowTracks.get(probe);
      if (t.playable()) {
        windowCurrentIndex = probe;
        return t;
      }
      probe++;
    }

    // 窗口边界：列表全部循环时回到首位（前提是窗口完整覆盖全局列表 =
    // 既无左侧又无右侧外部歌曲，才能在 Java 端做 wrap）。否则需 JS 推新窗口。
    if (repeatMode == RepeatMode.ALL && !hasPreviousOutsideWindow && !hasNextOutsideWindow) {
      // 从头扫描第一个可播曲目
      for (int i = 0; i < windowTracks.size(); i++) {
        Track t = windowTracks.get(i);
        if (t.playable()) {
          windowCurrentIndex = i;
          return t;
        }
      }
    }

    // 窗口耗尽：调用方 emit requestUrls 或 ENDED
    return null;
  }

  /** 退回到上一首。同样跳过 url==null。返回 null 表示窗口前缘耗尽。 */
  @Nullable
  public synchronized Track back() {
    if (windowTracks.isEmpty()) return null;
    int probe = windowCurrentIndex - 1;
    while (probe >= 0) {
      Track t = windowTracks.get(probe);
      if (t.playable()) {
        windowCurrentIndex = probe;
        return t;
      }
      probe--;
    }
    return null;
  }

  /** 当前 index 距窗口右边缘的剩余可播首数，<= edgeThreshold 时调用方应 emit requestUrls。 */
  public synchronized int playableTracksAhead() {
    if (windowTracks.isEmpty() || windowCurrentIndex < 0) return 0;
    int count = 0;
    for (int i = windowCurrentIndex + 1; i < windowTracks.size(); i++) {
      if (windowTracks.get(i).playable()) count++;
    }
    return count;
  }

  /** 当前 index 距窗口左边缘的剩余可播首数。 */
  public synchronized int playableTracksBehind() {
    if (windowTracks.isEmpty() || windowCurrentIndex <= 0) return 0;
    int count = 0;
    for (int i = windowCurrentIndex - 1; i >= 0; i--) {
      if (windowTracks.get(i).playable()) count++;
    }
    return count;
  }

  public synchronized boolean hasPreviousOutsideWindow() {
    return hasPreviousOutsideWindow;
  }

  public synchronized boolean hasNextOutsideWindow() {
    return hasNextOutsideWindow;
  }

  /**
   * 推进下一首，不跳过 url==null。供 UrlResolver 接管解析使用：解析失败再调 advanceRaw 跳过。
   */
  @Nullable
  public synchronized Track advanceRaw(boolean respectRepeatOne) {
    if (windowTracks.isEmpty()) return null;
    if (respectRepeatOne && repeatMode == RepeatMode.ONE) {
      return current();
    }
    int probe = windowCurrentIndex + 1;
    if (probe < windowTracks.size()) {
      windowCurrentIndex = probe;
      return windowTracks.get(probe);
    }
    // 窗口右缘：仅当窗口完整覆盖全局列表（前后均无外部歌曲）时，ALL 模式才可在窗口内 wrap。
    // 若 hasNextOutsideWindow=true，必须返 null 让上层 emit requestUrls 取后续歌曲，
    // 否则会跳过窗口外所有曲目错误回到 windowTracks[0]。
    if (repeatMode == RepeatMode.ALL
        && !hasPreviousOutsideWindow
        && !hasNextOutsideWindow
        && !windowTracks.isEmpty()) {
      windowCurrentIndex = 0;
      return windowTracks.get(0);
    }
    return null;
  }

  /** 后退一首（不跳过 url==null）。窗口前缘耗尽返回 null。 */
  @Nullable
  public synchronized Track backRaw() {
    if (windowTracks.isEmpty()) return null;
    int probe = windowCurrentIndex - 1;
    if (probe >= 0) {
      windowCurrentIndex = probe;
      return windowTracks.get(probe);
    }
    return null;
  }

  /** 从当前 index 之后取 N 首 url==null 的曲目；UrlResolver 据此后台批量预解析。 */
  public synchronized List<Track> peekUpcomingUnresolved(int count) {
    List<Track> out = new ArrayList<>(count);
    if (windowTracks.isEmpty() || windowCurrentIndex < 0) return out;
    for (int i = windowCurrentIndex + 1; i < windowTracks.size() && out.size() < count; i++) {
      Track t = windowTracks.get(i);
      if (t.url == null) out.add(t);
    }
    return out;
  }

  /** 用 songId 在窗口里查找 Track 并就地写回 url（UrlResolver 解析完成回调用）。 */
  public synchronized boolean updateTrackUrl(long songId, @Nullable String url) {
    if (url == null || url.isEmpty()) return false;
    for (Track t : windowTracks) {
      if (t.songId == songId) {
        t.url = url;
        return true;
      }
    }
    return false;
  }

  public synchronized boolean isPersonalFm() {
    return personalFmMode;
  }

  public synchronized RepeatMode getRepeatMode() {
    return repeatMode;
  }

  public synchronized boolean isEmpty() {
    return windowTracks.isEmpty();
  }

  /** 用于 JS 切歌指令对齐：JS 切到某个 playListIndex 时，Java 在窗口内查找匹配并更新 index。 */
  public synchronized boolean syncCurrentByPlayListIndex(int playListIndex) {
    if (playListIndex < 0) return false;
    for (int i = 0; i < windowTracks.size(); i++) {
      if (windowTracks.get(i).playListIndex == playListIndex) {
        windowCurrentIndex = i;
        return true;
      }
    }
    return false;
  }

}
