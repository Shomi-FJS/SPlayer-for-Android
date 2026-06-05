<template>
  <div id="app-layout">
    <Transition name="fade">
      <div
        v-if="
          (statusStore.themeBackgroundMode === 'image' ||
            statusStore.themeBackgroundMode === 'video') &&
          statusStore.backgroundImageUrl
        "
        :key="statusStore.backgroundImageUrl"
        class="background-container"
      >
        <div
          v-if="statusStore.themeBackgroundMode === 'image'"
          class="background-image"
          :style="{
            backgroundImage: `url(${statusStore.backgroundImageUrl})`,
            transform: `scale(${statusStore.backgroundConfig.scale})`,
            filter: `blur(${statusStore.backgroundConfig.blur}px)`,
          }"
        />
        <video
          v-else-if="statusStore.themeBackgroundMode === 'video'"
          class="background-image"
          :src="statusStore.backgroundImageUrl"
          autoplay
          loop
          muted
          :style="{
            objectFit: 'cover',
            transform: `scale(${statusStore.backgroundConfig.scale})`,
            filter: `blur(${statusStore.backgroundConfig.blur}px)`,
          }"
        />
        <div
          class="background-mask"
          :style="{
            backgroundColor: `rgba(0, 0, 0, ${backgroundMaskOpacity})`,
          }"
        />
      </div>
    </Transition>

    <div
      id="main"
      :class="{
        'pad-layout': isPad,
        'phone-layout': isPhone,
        'show-player': musicStore.isHasPlayer && statusStore.showPlayBar,
        'show-full-player': statusStore.showFullPlayer,
      }"
    >
      <n-layout v-if="isPad" id="pad-main" has-sider>
        <n-layout-sider
          id="main-sider"
          :style="{
            height:
              musicStore.isHasPlayer && statusStore.showPlayBar
                ? 'calc(var(--page-zoom-100dvh, 100dvh) - 80px)'
                : 'var(--page-zoom-100dvh, 100dvh)',
            ...padSiderBg,
          }"
          :content-style="{
            overflow: 'hidden',
            height: '100%',
            padding: '0',
          }"
          :native-scrollbar="false"
          :collapsed="statusStore.menuCollapsed"
          :collapsed-width="64"
          :width="240"
          collapse-mode="width"
          show-trigger="bar"
          bordered
          @collapse="statusStore.menuCollapsed = true"
          @expand="statusStore.menuCollapsed = false"
        >
          <Sider />
        </n-layout-sider>

        <n-layout id="main-layout" :style="padLayoutBg">
          <Nav id="main-header" />
          <n-layout
            ref="contentRef"
            id="main-content"
            :native-scrollbar="false"
            :style="{ '--layout-height': contentHeight }"
            :content-style="{
              display: 'grid',
              gridTemplateRows: '1fr',
              minHeight: '100%',
              boxSizing: 'border-box',
              padding: '0 24px',
            }"
            position="absolute"
            embedded
          >
            <RouterView v-slot="{ Component }">
              <Transition :name="`router-${settingStore.routeAnimation}`" mode="out-in">
                <KeepAlive v-if="settingStore.useKeepAlive" :max="20" :exclude="['layout']">
                  <component :is="Component" class="router-view" />
                </KeepAlive>
                <component v-else :is="Component" class="router-view" />
              </Transition>
            </RouterView>
            <n-back-top :right="40" :bottom="120">
              <SvgIcon :size="22" name="Up" />
            </n-back-top>
          </n-layout>
        </n-layout>
      </n-layout>

      <div v-else id="main-phone-layout" :style="phoneLayoutBg">
        <Nav id="main-header" />
        <main ref="contentRef" id="main-phone-content">
          <RouterView v-slot="{ Component }">
            <Transition :name="`router-${settingStore.routeAnimation}`" mode="out-in">
              <KeepAlive v-if="settingStore.useKeepAlive" :max="20" :exclude="['layout']">
                <component :is="Component" class="router-view" />
              </KeepAlive>
              <component v-else :is="Component" class="router-view" />
            </Transition>
          </RouterView>
          <n-back-top :right="16" :bottom="phoneBackTopBottom">
            <SvgIcon :size="22" name="Up" />
          </n-back-top>
        </main>
      </div>
    </div>

    <Transition name="fade">
      <nav
        v-if="isPhone && !statusStore.showFullPlayer"
        class="mobile-bottom-nav"
        :style="mobileNavBg"
      >
        <LiquidGlassNavBar
          :model-value="activePhoneNav"
          :items="liquidGlassNavItems"
          :active-color="'var(--primary-hex)'"
          :always-show-glass="statusStore.isCustomBackground"
          @update:model-value="onLiquidGlassNavChange"
        />
      </nav>
    </Transition>

    <!-- 真懒加载：用户首次打开播放队列时才挂载，挂载后保持常驻避免 Drawer 动画重置 -->
    <SongPlayList v-if="hasMountedPlayList" />
    <MainPlayer />
    <PlayerProvider>
      <FullPlayer />
    </PlayerProvider>
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent } from "vue";
import { useMusicStore, useStatusStore, useSettingStore, useDataStore } from "@/stores";
import { useBlobURLManager } from "@/core/resource/BlobURLManager";
import { isElectron } from "@/utils/env";
import { useDevice } from "@/composables/useDevice";
import { useInit } from "@/composables/useInit";
import MainPlayer from "@/components/Player/MainPlayer.vue";
import FullPlayer from "@/components/Player/FullPlayer.vue";
import PlayerProvider from "@/components/Global/PlayerProvider.vue";
import LiquidGlassNavBar from "@/components/UI/LiquidGlassNavBar.vue";

// 播放队列（n-drawer）首次打开才挂载，配合 defineAsyncComponent 异步拉取 chunk；
// 挂载后保持常驻，避免每次开关重置 n-drawer 入场动画。
const SongPlayList = defineAsyncComponent(() => import("@/components/List/SongPlayList.vue"));
const hasMountedPlayList = ref(false);

const musicStore = useMusicStore();
const statusStore = useStatusStore();
// 监听首次打开播放队列，触发懒加载
watch(
  () => statusStore.playListShow,
  (show) => {
    if (show) hasMountedPlayList.value = true;
  },
  { immediate: true },
);
const settingStore = useSettingStore();
const dataStore = useDataStore();
const route = useRoute();
const router = useRouter();

const blobURLManager = useBlobURLManager();
const { isPad, isPhone } = useDevice();

const phoneNavItems = [
  { key: "home", label: "推荐", icon: "Home", routeName: "home" },
  { key: "discover", label: "发现", icon: "Discover", routeName: "discover" },
  { key: "like", label: "收藏", icon: "Star", routeName: "like" },
  { key: "history", label: "最近", icon: "History", routeName: "history" },
] as const;

// 液态玻璃导航项（适配 LiquidGlassNavBar 的接口）
const liquidGlassNavItems = phoneNavItems.map((item) => ({
  id: item.key,
  label: item.label,
  icon: item.icon,
}));

// 液态玻璃导航切换
const onLiquidGlassNavChange = (id: string) => {
  const item = phoneNavItems.find((it) => it.key === id);
  if (item) navigatePhoneNav(item.routeName);
};

const activePhoneNav = computed(() => {
  const routeName = String(route.name || "");

  if (routeName.startsWith("discover")) return "discover";
  if (routeName.startsWith("like")) return "like";
  if (routeName.startsWith("history")) return "history";
  if (routeName === "home") return "home";

  return "home";
});

const contentRef = ref<HTMLElement | null>(null);
const { height: contentHeight } = useElementSize(contentRef);

const backgroundMaskOpacity = computed(() =>
  Math.min(Math.max(statusStore.backgroundConfig.maskOpacity, 0), 80) / 100,
);

// 布局层透明度
const imageLayoutVars = computed(() => {
  const f = Math.min(Math.max(statusStore.backgroundConfig.maskOpacity, 0), 80) / 80;
  return {
    bgTop: 0.02 + f * 0.20,
    bgBottom: 0.01 + f * 0.14,
    surface: 0.02 + f * 0.22,
    nav: 0.04 + f * 0.24,
  };
});

// 页面磨砂效果
const frostedBlur = computed(() => {
  const blur = Math.min(Math.max(statusStore.backgroundConfig.frostedBlur, 0), 20);
  return blur > 0 ? `blur(${blur}px)` : "none";
});

const frostedBlurVar = "--custom-background-frosted-blur";
const applyFrostedBlurVar = () => {
  if (statusStore.isCustomBackground) {
    document.documentElement.style.setProperty(frostedBlurVar, frostedBlur.value);
  } else {
    document.documentElement.style.removeProperty(frostedBlurVar);
  }
};
watch(() => [statusStore.isCustomBackground, frostedBlur.value], applyFrostedBlurVar, {
  immediate: true,
});
onUnmounted(() => document.documentElement.style.removeProperty(frostedBlurVar));

// 手机布局背景
const phoneLayoutBg = computed(() => {
  if (!statusStore.isCustomBackground) return {};
  const { bgTop, bgBottom } = imageLayoutVars.value;
  return {
    background: `linear-gradient(180deg, rgba(var(--background), ${bgTop}), rgba(var(--background), ${bgBottom}))`,
  };
});

// 底部导航背景
const mobileNavBg = computed(() => {
  if (!statusStore.isCustomBackground) return {};
  const { nav } = imageLayoutVars.value;
  return {
    "--mobile-nav-background": `rgba(var(--surface-container), ${nav})`,
    "--mobile-nav-backdrop-filter": `${frostedBlur.value} saturate(1.35)`,
  };
});

// Pad 主布局背景
const padLayoutBg = computed(() => {
  if (!statusStore.isCustomBackground) return {};
  const { bgTop, bgBottom } = imageLayoutVars.value;
  return {
    background: `linear-gradient(180deg, rgba(var(--background), ${bgTop}), rgba(var(--background), ${bgBottom}))`,
  };
});

// Pad 侧栏背景
const padSiderBg = computed(() => {
  if (!statusStore.isCustomBackground) return {};
  const { surface } = imageLayoutVars.value;
  return {
    backgroundColor: `rgba(var(--surface-container), ${surface})`,
    backdropFilter: frostedBlur.value,
    WebkitBackdropFilter: frostedBlur.value,
  };
});

// 回到顶部偏移
const phoneBackTopBottom = computed(() => {
  const navHeight = 56;
  const playerHeight = 64;
  const playerGap = 8;
  const hasPlayer = musicStore.isHasPlayer && statusStore.showPlayBar;
  // 底栏上方
  const base = navHeight + 16;
  return hasPlayer ? base + playerHeight + playerGap : base;
});

const loadBackgroundImage = async () => {
  if (statusStore.backgroundImageUrl) return;
  if (statusStore.themeBackgroundMode === "image" || statusStore.themeBackgroundMode === "video") {
    const blob = await dataStore.getBackgroundImage();
    if (blob) {
      const arrayBuffer = await blob.arrayBuffer();
      statusStore.backgroundImageUrl = blobURLManager.createBlobURL(
        arrayBuffer,
        blob.type,
        "background-image",
      );
    }
  }
};

watchEffect(() => {
  statusStore.mainContentHeight = contentHeight.value;
});

const navigatePhoneNav = (routeName: (typeof phoneNavItems)[number]["routeName"]) => {
  if (route.name === routeName) return;
  router.push({ name: routeName });
};

useInit();

// 横竖屏切换后强制刷新布局：触发 resize 事件帮助依赖视口尺寸的组件重新计算
const handleOrientationChange = () => {
  // 触发多次 resize 事件以覆盖不同时机：立即、动画中、完成后
  const fire = () => window.dispatchEvent(new Event("resize"));
  fire();
  requestAnimationFrame(fire);
  setTimeout(fire, 150);
  setTimeout(fire, 400);
};

// matchMedia 在部分设备上比 orientationchange 事件更可靠
const orientationMql = window.matchMedia("(orientation: portrait)");

onMounted(() => {
  loadBackgroundImage();
  window.addEventListener("orientationchange", handleOrientationChange);
  // 首次挂载也尝试一次（nav 可能尚未渲染，wait nextTick 更稳）
  orientationMql.addEventListener?.("change", handleOrientationChange);
  if (!isElectron) {
    window.addEventListener("beforeunload", (event) => {
      event.preventDefault();
      blobURLManager.revokeAllBlobURLs();
      event.returnValue = "";
    });
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("orientationchange", handleOrientationChange);
  orientationMql.removeEventListener?.("change", handleOrientationChange);
});
</script>

<style lang="scss" scoped>
#app-layout {
  --safe-area-top: max(env(safe-area-inset-top), 0px);
  --safe-area-bottom: max(env(safe-area-inset-bottom), var(--android-fullscreen-safe-bottom, 0px));
  --app-header-height: calc(72px + var(--safe-area-top));
  --phone-nav-height: 56px;
  --phone-nav-float-gap: 8px;
  --phone-nav-total-height: calc(var(--phone-nav-height) + var(--phone-nav-float-gap) * 2 + var(--safe-area-bottom));
  --phone-player-height: 64px;
  --phone-player-gap: 8px;
  --phone-content-gap: 12px;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
}

.background-container {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: -1;
  pointer-events: none;
  overflow: hidden;

  .background-image {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;
    transform-origin: center center;
  }

  .background-mask {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  }
}

#main {
  flex: 1;
  height: 100%;
  transition:
    transform 0.3s var(--n-bezier),
    opacity 0.3s var(--n-bezier);

  .router-view {
    position: relative;
    min-height: 100%;

    &.n-result {
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
  }

  &.show-full-player {
    opacity: 0;
    transform: scale(0.9);

    #main-header {
      -webkit-app-region: no-drag;
    }
  }
}

#pad-main {
  height: 100%;

  #main-layout {
    background: linear-gradient(
      180deg,
      rgba(var(--background), 0.86),
      rgba(var(--background), 0.78)
    );
  }

  #main-content {
    top: var(--app-header-height);
    background-color: transparent;
    transition: bottom 0.3s;
  }
}

#main.show-player {
  #pad-main {
    #main-content {
      // 同步纳入底部安全区，避免内容被加高后的播放栏挡住
      bottom: calc(80px + var(--safe-area-bottom));
    }
  }
}

#main-phone-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 100%;
  background: linear-gradient(180deg, rgba(var(--background), 0.94), rgba(var(--background), 0.9));
}

:global(html.image) {
  #main-header {
    position: relative;
    z-index: 2;
    background-color: rgba(var(--surface-container), 0.08);
    backdrop-filter: var(--custom-background-frosted-blur, none);
    -webkit-backdrop-filter: var(--custom-background-frosted-blur, none);
  }
}

#main-phone-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 14px calc(var(--phone-nav-total-height) + 8px);
  box-sizing: border-box;
}

#main.show-player {
  #main-phone-content {
    /* 播放栏现在浮于底栏之上：底栏 + 间距 + 播放栏 + 一点冗余 */
    padding-bottom: calc(
      var(--phone-nav-total-height) + var(--phone-player-gap) + var(--phone-player-height) + 12px
    );
  }
}

.mobile-bottom-nav {
  position: fixed;
  left: 12px;
  right: 12px;
  bottom: calc(8px + var(--safe-area-bottom));
  z-index: 9;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.3s var(--n-bezier);
}
</style>
