import { ref, watch, onBeforeUnmount, type Ref } from "vue";
import { useCacheManager, type CacheResourceType } from "@/core/resource/CacheManager";
import { isCapacitorAndroid } from "@/utils/env";
import { useSettingStore } from "@/stores";

/** 封面缓存 type；其他类型不进入此 helper。 */
export type CoverCacheType = Extract<CacheResourceType, "covers" | "list-covers">;

/** url → 仅 ASCII 的安全 key（取末段路径，附加 hash 防同名冲突）。 */
const buildKey = (url: string): string => {
  // 简单 hash：dj2b 算法，碰撞概率极低且 deterministic
  let h = 5381;
  for (let i = 0; i < url.length; i++) h = ((h << 5) + h + url.charCodeAt(i)) | 0;
  const hashHex = (h >>> 0).toString(16);
  // path tail 提供可读性（调试时方便看出是哪首歌的封面）
  let tail = "";
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").filter(Boolean).pop() || "";
    tail = seg.replace(/[^A-Za-z0-9._-]/g, "_").slice(-32);
  } catch {
    /* not a valid URL: 走 hash 兜底 */
  }
  return tail ? `${tail}_${hashHex}` : hashHex;
};

/**
 * 内存级 blob URL LRU：上限 200 张；超出时弹出最旧条目并真正 revokeObjectURL，
 * 否则 Blob 字节在 V8 堆里永久驻留（无限滚动 500 张列表 = 25-100 MB 泄漏）。
 *
 * <p>淘汰后再次进入视口会走一次 IPC + Blob 重建（≈5ms/张），用户体感无感。
 */
const MEMORY_HIT_LIMIT = 200;
const memoryHit = new Map<string, string>(); // url → blob URL，LRU（Map 保留插入顺序）

const memoryHitPut = (url: string, blobUrl: string): void => {
  // 已存在：先删除让重新插入到末尾（标记为最近使用）
  if (memoryHit.has(url)) memoryHit.delete(url);
  memoryHit.set(url, blobUrl);
  // 超限：删除最旧条目（Map.keys() 第一个）并 revoke
  while (memoryHit.size > MEMORY_HIT_LIMIT) {
    const oldestUrl = memoryHit.keys().next().value;
    if (oldestUrl === undefined) break;
    const oldestBlob = memoryHit.get(oldestUrl);
    memoryHit.delete(oldestUrl);
    if (oldestBlob) URL.revokeObjectURL(oldestBlob);
  }
};

const memoryHitGet = (url: string): string | undefined => {
  const v = memoryHit.get(url);
  if (v !== undefined) {
    // LRU touch：删除后重新 set，挪到 Map 末尾
    memoryHit.delete(url);
    memoryHit.set(url, v);
  }
  return v;
};

/** url → 解析中的 Promise，仅活到 cm.get 完成，去重首次解析并发。 */
const inFlight = new Map<string, Promise<string | undefined>>();
/** url → 后台下载 Promise，活到 fetch + cm.set 写盘完成；防止 #4 同 url 重复网络请求。 */
const downloadInFlight = new Map<string, Promise<void>>();

/**
 * 解析 url：命中本地缓存返 blob URL；未命中返 undefined（调用方应回退到原 url，
 * 同时本 helper 会在后台异步下载并写入缓存，下次进入直接命中）。
 */
const resolveCachedCover = async (
  url: string,
  type: CoverCacheType,
): Promise<string | undefined> => {
  if (!url || !url.startsWith("http")) return undefined;
  const cm = useCacheManager();
  const key = buildKey(url);
  // 内存级 hit 直接返（带 LRU touch）
  const hit = memoryHitGet(url);
  if (hit) return hit;
  // 并发 dedup
  const pending = inFlight.get(url);
  if (pending) return pending;

  const task = (async (): Promise<string | undefined> => {
    try {
      const r = await cm.get(type, key);
      if (r.success && r.data) {
        // Blob 构造在 TS 5.x 对 Uint8Array.buffer (ArrayBufferLike) 推断过严，断言为 ArrayBuffer 兜底
        const ab = r.data.buffer.slice(
          r.data.byteOffset,
          r.data.byteOffset + r.data.byteLength,
        ) as ArrayBuffer;
        const blob = new Blob([ab]);
        const blobUrl = URL.createObjectURL(blob);
        memoryHitPut(url, blobUrl);
        return blobUrl;
      }
    } catch {
      /* miss：走未命中分支 */
    }
    // 未命中：后台异步下载并写入；不阻塞返回，让调用方先用原 url 显示
    void downloadAndCache(url, key, type);
    return undefined;
  })();

  inFlight.set(url, task);
  try {
    return await task;
  } finally {
    inFlight.delete(url);
  }
};

/**
 * 后台抓取并写入缓存（fire-and-forget）。同 url 期间已有下载在跑则直接复用，
 * 防止 resolveCachedCover 在 cm.get miss 后多次触发同一 url 的网络请求（#4 修复）。
 */
const downloadAndCache = (url: string, key: string, type: CoverCacheType): Promise<void> => {
  const existing = downloadInFlight.get(url);
  if (existing) return existing;

  const job = (async () => {
    try {
      const settingStore = useSettingStore();
      if (!settingStore.cacheEnabled) return;
      const resp = await fetch(url);
      if (!resp.ok) return;
      const buf = await resp.arrayBuffer();
      if (buf.byteLength === 0) return;
      const cm = useCacheManager();
      await cm.set(type, key, new Uint8Array(buf));
    } catch (e) {
      // 网络失败不致命：下次访问仍可能命中或重试
      console.warn("[useCoverCache] download failed:", url, e);
    } finally {
      downloadInFlight.delete(url);
    }
  })();

  downloadInFlight.set(url, job);
  // 30s 兜底超时清理：防止 fetch 永久 hang 卡住 inFlight
  setTimeout(() => {
    if (downloadInFlight.get(url) === job) downloadInFlight.delete(url);
  }, 30_000);
  return job;
};

/**
 * 预下载封面到本地缓存：供 SongManager.prefetchNextSong 等场景主动调用。
 *
 * <p>已在缓存命中或正在下载时直接跳过；并发安全（同 url 只发一次请求）。
 * 与 resolveCachedCover 共享 inFlight / memoryHit map，去重彻底。
 *
 * @param url 远端封面 url（http/https）
 * @param type 默认 "covers"；列表场景传 "list-covers"
 */
export const prefetchCoverToCache = async (
  url: string | undefined,
  type: CoverCacheType = "covers",
): Promise<void> => {
  if (!url || !url.startsWith("http")) return;
  if (!isCapacitorAndroid) return;
  // 复用 resolveCachedCover：命中直接返，未命中触发后台下载
  await resolveCachedCover(url, type);
};

/**
 * 把远端封面 url 映射为「优先本地、回退远端」的反应式 src。
 *
 * - 仅 Android 启用；其他平台直接透传原 url（项目仅安卓运行，但保留兜底）
 * - 卸载时释放 blob URL，避免内存泄漏
 *
 * @param srcRef 原始 url ref（来自 props.src 等）
 * @param type 默认 "covers"；列表场景传 "list-covers"
 * @returns 处理后的 src ref
 */
export const useCoverCache = (
  srcRef: Ref<string | undefined>,
  type: CoverCacheType = "covers",
): Ref<string | undefined> => {
  const resolved = ref<string | undefined>(srcRef.value);
  const ownedBlobUrls: string[] = [];

  watch(
    srcRef,
    async (url) => {
      if (!url) {
        resolved.value = undefined;
        return;
      }
      // 非 http(s) 直接透传：本地路径 / data URI / blob URL / capacitor://
      if (!url.startsWith("http")) {
        resolved.value = url;
        return;
      }
      if (!isCapacitorAndroid) {
        resolved.value = url;
        return;
      }
      // 先用原始 url 显示，避免等待 IPC（命中时立即升级）
      resolved.value = url;
      const cached = await resolveCachedCover(url, type);
      if (cached && srcRef.value === url) {
        resolved.value = cached;
        if (cached.startsWith("blob:") && !ownedBlobUrls.includes(cached)) {
          ownedBlobUrls.push(cached);
        }
      }
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    // 不在此处 revoke：同一 url 的 blob URL 可能被多个组件共享（如 ArtistList 卡片 + 背板），
    // 本组件卸载若 revoke 会让其他组件 <img> 破图。释放统一交给 LRU 淘汰（memoryHitPut 超限时）。
    // 这里仅清自有引用数组，不影响 LRU。
    ownedBlobUrls.length = 0;
  });

  return resolved;
};
