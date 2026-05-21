package top.imsyy.splayer.android.cache;

import android.content.Context;
import android.net.Uri;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.media3.database.StandaloneDatabaseProvider;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.cache.CacheDataSink;
import androidx.media3.datasource.cache.CacheDataSource;
import androidx.media3.datasource.cache.CacheSpan;
import androidx.media3.datasource.cache.CacheWriter;
import androidx.media3.datasource.cache.NoOpCacheEvictor;
import androidx.media3.datasource.cache.SimpleCache;
import java.io.File;
import java.util.HashSet;
import java.util.NavigableSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * ExoPlayer SimpleCache 单例提供者。
 *
 * <p>关键设计：
 *
 * <ul>
 *   <li>使用 {@link NoOpCacheEvictor}：把驱逐权交给 {@link CacheStorage} 全局 LRU，避免双重逻辑。
 *   <li>cacheKey：从 NCM URL 中提取 songId / 文件名指纹，去掉 expire 签名等动态参数；
 *       同一首歌不同时间签出的 URL 仍可命中同一份缓存。
 *   <li>{@link DataSource.Factory} 链：HTTP upstream → CacheDataSource。
 * </ul>
 */
public final class AudioCacheProvider {

  /** NCM 音频文件名典型形式：xxxxx-{numericId}.mp3?...，提取 id 部分作为 cacheKey 主体。 */
  private static final Pattern NCM_FILE_PATTERN = Pattern.compile("/([A-Za-z0-9_-]+\\.(?:mp3|flac|m4a|ogg))");

  @SuppressWarnings("StaticFieldLeak")
  private static volatile SimpleCache simpleCache;

  private static final Object lock = new Object();

  private AudioCacheProvider() {}

  /** 懒初始化 SimpleCache 单例（同进程多次构造同目录会抛 IllegalStateException）。 */
  @NonNull
  public static SimpleCache getOrCreate(@NonNull Context appContext) {
    SimpleCache cache = simpleCache;
    if (cache != null) return cache;
    synchronized (lock) {
      if (simpleCache != null) return simpleCache;
      CacheStorage storage = CacheStorage.getInstance(appContext);
      simpleCache =
          new SimpleCache(
              storage.getAudioCacheDir(),
              new NoOpCacheEvictor(),
              new StandaloneDatabaseProvider(appContext));
      return simpleCache;
    }
  }

  /**
   * 偷看已初始化的 SimpleCache 实例；未初始化返 null，不触发初始化。<br>
   * 供 {@link CacheStorage#getTypeBytes} 在 SimpleCache 已就绪时走 O(1) 读取，否则回退扫盘。
   */
  @Nullable
  public static SimpleCache peekSimpleCache() {
    return simpleCache;
  }

  /** 释放（应用退出 / 测试场景）；正常运行不调用，单例随进程生命周期。 */
  public static void release() {
    synchronized (lock) {
      if (simpleCache != null) {
        simpleCache.release();
        simpleCache = null;
      }
    }
  }

  /**
   * 构造带缓存的 DataSource.Factory。
   *
   * <p>关键点 —— 必须显式设 {@link CacheDataSink}，否则 ExoPlayer 默认<strong>只读不写</strong>，
   * 已 prefetch 的字节会命中，但 prefetch 范围之外（如 512 KB 之后 / seek 跳过的段落）走 HTTP
   * upstream 拉取后不会落盘，导致"前半部分有、后半部分没"的缓存空洞。
   *
   * <p>{@link CacheDataSink#DEFAULT_FRAGMENT_SIZE} 是 5 MB；多数 NCM 歌曲单首 3-10 MB，
   * 显式设 {@link Long#MAX_VALUE} 强制单文件 chunk，避免 seek 时碎片化 + 减少 SimpleCache 元数据开销。
   *
   * <p>flags：
   * <ul>
   *   <li>{@link CacheDataSource#FLAG_IGNORE_CACHE_ON_ERROR}：上游失败时仍可读已缓存部分
   *   <li>{@link CacheDataSource#FLAG_BLOCK_ON_CACHE}：写入完成前阻塞读取，保证完整性
   * </ul>
   */
  @NonNull
  public static DataSource.Factory buildCachedDataSourceFactory(@NonNull Context appContext) {
    SimpleCache cache = getOrCreate(appContext);

    DataSource.Factory upstreamFactory =
        new DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(15_000)
            .setUserAgent("SPlayer-Android/1.0");

    // 写入器：把 upstream 拉到的字节落到 SimpleCache。fragmentSize=MAX 让单首歌只产生 1 个文件
    CacheDataSink.Factory cacheSinkFactory =
        new CacheDataSink.Factory().setCache(cache).setFragmentSize(Long.MAX_VALUE);

    return new CacheDataSource.Factory()
        .setCache(cache)
        .setUpstreamDataSourceFactory(upstreamFactory)
        .setCacheWriteDataSinkFactory(cacheSinkFactory)
        .setCacheKeyFactory(spec -> resolveCacheKey(spec.uri))
        .setFlags(
            CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR
                | CacheDataSource.FLAG_BLOCK_ON_CACHE);
  }

  /** 已知的临时签名 / 过期参数：仅这些会被剔除以保证同曲目缓存命中。其余 query 参与 key 防碰撞。 */
  private static final java.util.Set<String> EPHEMERAL_QUERY_KEYS =
      new java.util.HashSet<>(
          java.util.Arrays.asList(
              "expire",
              "expires",
              "signature",
              "sign",
              "token",
              "auth_key",
              "_t",
              "timestamp",
              "ts"));

  /**
   * 从 URL 提取稳定 cacheKey。
   *
   * <p>API命中 {@link #NCM_FILE_PATTERN} 时走 {@code ncm:<id>}，最稳定。
   * <p>其他场景（Subsonic / 自部署流媒体 / 签名 URL）兜底用 {@code host + path + 排序后非临时 query}
   * 的 md5：仅剔除已知临时签名参数，保留区分歌曲的业务参数（如 ?id=xxx）防止 A/B 共用 key 播错歌。
   */
  @NonNull
  public static String resolveCacheKey(@NonNull Uri uri) {
    String scheme = uri.getScheme();
    if (scheme != null && scheme.startsWith("file")) {
      // 本地文件：直接用 path（不会进缓存，但 cacheKey 仍要求非空）
      return "local:" + uri.getPath();
    }
    String path = uri.getPath();
    if (path == null) path = "";
    Matcher m = NCM_FILE_PATTERN.matcher(path);
    if (m.find()) {
      return "ncm:" + m.group(1);
    }
    // 通用回退：host + path + 排序后的稳定 query（剔除签名/过期参数）
    StringBuilder sb = new StringBuilder();
    String host = uri.getHost();
    if (host != null) sb.append(host);
    sb.append(path);
    java.util.Set<String> qnames;
    try {
      qnames = uri.getQueryParameterNames();
    } catch (UnsupportedOperationException e) {
      qnames = java.util.Collections.emptySet();
    }
    if (!qnames.isEmpty()) {
      java.util.List<String> sortedKeys = new java.util.ArrayList<>(qnames);
      java.util.Collections.sort(sortedKeys);
      sb.append('?');
      boolean first = true;
      for (String qk : sortedKeys) {
        if (EPHEMERAL_QUERY_KEYS.contains(qk.toLowerCase(java.util.Locale.ROOT))) continue;
        String qv = uri.getQueryParameter(qk);
        if (qv == null) qv = "";
        if (!first) sb.append('&');
        sb.append(qk).append('=').append(qv);
        first = false;
      }
    }
    return CacheStorage.keyFromUrl(sb.toString());
  }

  // ========== prefetch ==========

  private static final String TAG = "AudioCachePrefetch";
  /** 默认预下载字节数：512 KB，足够 ExoPlayer 启播第一帧解码 + 内部缓冲。 */
  public static final long DEFAULT_PREFETCH_BYTES = 512L * 1024L;
  /** 单线程顺序执行：避免并发拉多首抢带宽，影响当前播放码流。 */
  private static volatile ExecutorService prefetchExecutor;
  /** 已在排队 / 进行中的 cacheKey 集合，幂等去重。 */
  private static final Set<String> inFlight = new HashSet<>();
  /** 当前 prefetch 任务的 cancel 标志：切歌时取消上一首的 prefetch，给新任务让带宽。 */
  @Nullable private static volatile AtomicBoolean currentCancelFlag;

  @NonNull
  private static ExecutorService getExecutor() {
    if (prefetchExecutor == null) {
      synchronized (AudioCacheProvider.class) {
        if (prefetchExecutor == null) {
          prefetchExecutor =
              Executors.newSingleThreadExecutor(
                  r -> {
                    Thread t = new Thread(r, "audio-cache-prefetch");
                    t.setDaemon(true);
                    t.setPriority(Thread.NORM_PRIORITY - 1);
                    return t;
                  });
        }
      }
    }
    return prefetchExecutor;
  }

  /**
   * 主动把 url 前 {@link #DEFAULT_PREFETCH_BYTES} 字节写入 SimpleCache。
   *
   * <p>用法：切歌成功后立即调用 {@code prefetchUrl(下一首 url)}。下次 ExoPlayer setMediaItem
   * 这条 url 时，CacheDataSource 立刻命中本地，跳过 OPEN→网络握手 100-500ms。
   *
   * <p>幂等：同 cacheKey 已在队列或已 ready 时直接 no-op。
   *
   * @param appContext app context
   * @param url 要预下载的 http(s) url；非 http 直接忽略
   */
  public static void prefetchUrl(@NonNull Context appContext, @Nullable String url) {
    prefetchUrlWithLength(appContext, url, DEFAULT_PREFETCH_BYTES, /* cancelPrev= */ true);
  }

  /**
   * 把 url 整首音频拉完写入 SimpleCache（length=EOF）。<br>
   * 用法：当用户播放某首歌 >10s 时，调用此方法把整首存档为"正式缓存"，
   * 为后续 automix（需要音频完整字节做 BPM / energy 分析）和离线播放铺路。
   *
   * <p>与短预载共用同一单线程池，按调用顺序排队；不取消已有任务（不抢带宽），
   * 排到自己时若用户已经切歌，TTL 索引也会让本任务的字节仍然有效（promoted=true）。
   */
  public static void prefetchUrlFull(@NonNull Context appContext, @Nullable String url) {
    // 幂等短路：已 promoted 跳过。全量下载的推进与最终 promote 标记都在 prefetchUrlWithLength 内负责。
    if (url == null || url.isEmpty()) return;
    Uri uri = Uri.parse(url);
    if (uri.getScheme() != null) {
      String cacheKey = resolveCacheKey(uri);
      if (AudioPrefetchTtlIndex.getInstance(appContext).isPromoted(cacheKey)) return;
    }
    // cancelPrev=false：完整下载不应抢占已经在跑的短预载
    prefetchUrlWithLength(appContext, url, /* length= */ Long.MAX_VALUE, /* cancelPrev= */ false);
  }

  /** 公共实现：length 控制下载字节数；cancelPrev 控制是否取消上一首未完成的任务。 */
  private static void prefetchUrlWithLength(
      @NonNull Context appContext, @Nullable String url, long length, boolean cancelPrev) {
    if (url == null || url.isEmpty()) return;
    Uri uri = Uri.parse(url);
    String scheme = uri.getScheme();
    if (scheme == null || (!scheme.equals("http") && !scheme.equals("https"))) return;

    final String cacheKey = resolveCacheKey(uri);
    final String inFlightKey = cacheKey + "|" + length; // 同 key 但不同 length 的请求不互斥
    synchronized (inFlight) {
      if (inFlight.contains(inFlightKey)) {
        return; // 已在排队 / 进行中
      }
      inFlight.add(inFlightKey);
    }

    final SimpleCache cache = getOrCreate(appContext);
    final AudioPrefetchTtlIndex ttlIndex = AudioPrefetchTtlIndex.getInstance(appContext);
    // 已完整命中（cachedBytes ≥ length 阈值）则跳过 IO；但仍刷新 TTL 索引让缓存"续期"
    long probeLength = length == Long.MAX_VALUE ? DEFAULT_PREFETCH_BYTES : length;
    long cachedBytes = cache.getCachedBytes(cacheKey, 0, probeLength);
    // 全量下载场景：还需要确认是否真的下完了（用 contentLength 判断更准但成本高，这里宽松判定）
    if (length != Long.MAX_VALUE && cachedBytes >= length) {
      ttlIndex.markAccess(cacheKey);
      synchronized (inFlight) {
        inFlight.remove(inFlightKey);
      }
      return;
    }

    // 取消上一首的 prefetch：给当前新任务腾带宽（仅短预载场景）
    AtomicBoolean cancelFlag = new AtomicBoolean(false);
    if (cancelPrev) {
      AtomicBoolean prevCancel = currentCancelFlag;
      if (prevCancel != null) prevCancel.set(true);
      currentCancelFlag = cancelFlag;
    }
    final AtomicBoolean cancelFlagFinal = cancelFlag;
    final long lengthFinal = length;

    getExecutor().execute(() -> {
      try {
        DataSource.Factory factory = buildCachedDataSourceFactory(appContext);
        DataSource ds = factory.createDataSource();
        DataSpec.Builder specBuilder =
            new DataSpec.Builder().setUri(uri).setKey(cacheKey).setPosition(0);
        if (lengthFinal != Long.MAX_VALUE) {
          specBuilder.setLength(lengthFinal);
        }
        DataSpec spec = specBuilder.build();
        CacheWriter writer =
            new CacheWriter(
                (CacheDataSource) ds,
                spec,
                /* temporaryBuffer= */ null,
                (requestLength, bytesCached, newBytesCached) -> {
                  // 取消信号：抛 InterruptedException 让 CacheWriter 退出
                  if (cancelFlagFinal.get()) Thread.currentThread().interrupt();
                });
        writer.cache();
        // 全量下载（length=MAX_VALUE）成功返回才标 promoted；CacheWriter 中途抛异常会走到 catch，不会 promote。
        // 这样 getPromotedAudioFile 看到 isPromoted=true 时，可认为文件完整；automix 不会读到截断字节。
        if (lengthFinal == Long.MAX_VALUE) {
          ttlIndex.promote(cacheKey);
        } else {
          ttlIndex.markAccess(cacheKey);
        }
        String lengthLabel = lengthFinal == Long.MAX_VALUE ? "FULL" : lengthFinal + " bytes";
        Log.d(TAG, "prefetch done: " + cacheKey + " (" + lengthLabel + ")");
      } catch (Throwable e) {
        // 网络失败 / 取消都走这里；不致命，下次播放走正常流程
        Log.d(TAG, "prefetch aborted: " + cacheKey + " - " + e.getMessage());
      } finally {
        synchronized (inFlight) {
          inFlight.remove(inFlightKey);
        }
      }
    });
  }

  /** 取消所有正在排队的 prefetch（应用关闭等场景）。 */
  public static void cancelAllPrefetch() {
    AtomicBoolean flag = currentCancelFlag;
    if (flag != null) flag.set(true);
    synchronized (inFlight) {
      inFlight.clear();
    }
  }

  /**
   * 安全清空 audio 缓存：走 {@link SimpleCache#removeResource} 让 SimpleCache 同步内部 ContentIndex，
   * 而非 deleteRecursive 物理删目录（后者会导致活跃 SimpleCache 实例索引/磁盘不一致，后续播放抛 IOException）。
   *
   * <p>同时清 promoted 索引，避免 isPromoted 命中已删 key。
   */
  public static void clearAll(@NonNull Context appContext) {
    cancelAllPrefetch();
    SimpleCache cache = simpleCache;
    if (cache != null) {
      // 取 keys 副本：cache.getKeys() 返回内部视图，迭代中 removeResource 会 ConcurrentModification
      Set<String> keys = new HashSet<>(cache.getKeys());
      for (String key : keys) {
        try {
          cache.removeResource(key);
        } catch (Throwable e) {
          Log.w(TAG, "removeResource failed: " + key, e);
        }
      }
    }
    AudioPrefetchTtlIndex.getInstance(appContext).clearAllPromoted();
  }

  /**
   * 让 audio 缓存收缩到 {@code maxAudioBytes}：按 mtime 升序删 key，promoted 排到最后保护。
   *
   * <p>由 CacheStorage.enforceLimit 在非 audio 删完仍超配额时调用，让 audio 真正参与全局 LRU。
   *
   * @return 释放的字节数；调用方可记日志 / 汇报
   */
  public static long enforceLimitTo(@NonNull Context appContext, long maxAudioBytes) {
    SimpleCache cache = simpleCache;
    if (cache == null) return 0L;
    long total = cache.getCacheSpace();
    if (total <= maxAudioBytes) return 0L;

    AudioPrefetchTtlIndex idx = AudioPrefetchTtlIndex.getInstance(appContext);
    Set<String> keys;
    try {
      keys = new HashSet<>(cache.getKeys());
    } catch (Throwable e) {
      return 0L;
    }

    // 收集 (key, lastMtime, totalBytes, isPromoted)
    final class KeyMeta {
      final String key;
      final long mtime;
      final long bytes;
      final boolean promoted;

      KeyMeta(String k, long m, long b, boolean p) {
        key = k;
        mtime = m;
        bytes = b;
        promoted = p;
      }
    }
    java.util.List<KeyMeta> metas = new java.util.ArrayList<>();
    for (String key : keys) {
      NavigableSet<CacheSpan> spans;
      try {
        spans = cache.getCachedSpans(key);
      } catch (Throwable e) {
        continue;
      }
      if (spans == null || spans.isEmpty()) continue;
      long maxMtime = 0L, bytes = 0L;
      for (CacheSpan s : spans) {
        if (s.file != null) maxMtime = Math.max(maxMtime, s.file.lastModified());
        bytes += s.length;
      }
      metas.add(new KeyMeta(key, maxMtime, bytes, idx.isPromoted(key)));
    }
    // 排序：promoted 排最后（不轻易删）；同组按 mtime 升序
    metas.sort(
        (a, b) -> {
          if (a.promoted != b.promoted) return a.promoted ? 1 : -1;
          return Long.compare(a.mtime, b.mtime);
        });

    long current = total;
    long target = (long) (maxAudioBytes * 0.8);
    long freed = 0L;
    for (KeyMeta m : metas) {
      if (current <= target) break;
      try {
        cache.removeResource(m.key);
        // 同时清 TTL / promoted 索引（防孤儿条目）
        if (m.promoted) idx.unmarkPromoted(m.key);
        current -= m.bytes;
        freed += m.bytes;
      } catch (Throwable e) {
        Log.w(TAG, "evict failed: " + m.key, e);
      }
    }
    Log.i(TAG, "audio enforceLimit: 释放 " + freed + " 字节，回到 " + current + "/" + maxAudioBytes);
    return freed;
  }

  // ========== automix 支持 ==========

  /**
   * 给 automix 等需要直接读完整音频字节的场景：返回 SimpleCache 中某 url 对应的本地完整文件。
   *
   * <p>判定条件（必须全部满足）：
   * <ol>
   *   <li>该 url 已 promoted（用户播放 > 10s，并触发过 prefetchUrlFull）
   *   <li>SimpleCache 中存在 cacheKey 且字节连续（{@link CacheSpan#isCached}）
   *   <li>从 offset=0 开始（不是 seek 后的中段缓存）
   *   <li>只有一个 span（fragmentSize=MAX 保证）
   * </ol>
   *
   * <p>返回的 {@link File} 是真实物理文件路径，调用方可直接 fopen 做：
   * <ul>
   *   <li>BPM 检测（Aubio / Essentia）
   *   <li>波形分析 / 振幅包络
   *   <li>能量段落分割（用于自动 crossfade in/out 点选择）
   *   <li>淡入淡出 / EQ 等离线音频处理
   * </ul>
   *
   * <p>文件名是 SimpleCache 内部编码（{@code <cacheKey>.<index>.<id>.v3.exo}），<br>
   * 后缀 .exo 不是音频格式提示——文件内容是原始网络字节（mp3/flac/m4a 取决于 url），<br>
   * 用 ffmpeg / MediaExtractor 等需要自动识别格式或显式指定。
   *
   * @param appContext app context
   * @param url 原始 http(s) url（与播放时一致即可，签名 / expire 参数可不同）
   * @return 完整本地文件 File；未 promoted / 未下完 / SimpleCache 未就绪均返 null
   */
  @Nullable
  public static File getPromotedAudioFile(@NonNull Context appContext, @Nullable String url) {
    if (url == null || url.isEmpty()) return null;
    Uri uri;
    try {
      uri = Uri.parse(url);
    } catch (Throwable e) {
      return null;
    }
    String scheme = uri.getScheme();
    if (scheme == null || (!scheme.equals("http") && !scheme.equals("https"))) return null;

    String cacheKey = resolveCacheKey(uri);
    if (!AudioPrefetchTtlIndex.getInstance(appContext).isPromoted(cacheKey)) return null;

    SimpleCache cache = simpleCache;
    if (cache == null) return null;

    NavigableSet<CacheSpan> spans;
    try {
      spans = cache.getCachedSpans(cacheKey);
    } catch (Throwable e) {
      return null;
    }
    if (spans == null || spans.isEmpty()) return null;

    // fragmentSize=MAX 保证单 span；若意外有多 span 说明文件被切片，无法整段使用
    if (spans.size() > 1) return null;
    CacheSpan span = spans.first();
    if (span == null || span.position != 0L || !span.isCached || span.file == null) return null;
    if (!span.file.isFile()) return null;
    return span.file;
  }

  /**
   * 给 automix 探测：某 url 对应的本地缓存音频是否已就绪（promoted + 单 span 完整）。<br>
   * 等价于 {@link #getPromotedAudioFile} != null，但不分配 File 对象。
   */
  public static boolean isPromotedAudioReady(@NonNull Context appContext, @Nullable String url) {
    return getPromotedAudioFile(appContext, url) != null;
  }
}
