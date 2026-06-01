<template>
  <div class="media-source-selector">
    <n-spin :show="loading">
      <n-empty v-if="!loading && sources.length === 0" description="暂无活跃媒体源" />
      <n-list v-else hoverable clickable>
        <n-list-item
          v-for="source in sources"
          :key="source.packageName"
          :class="{ active: selectedPackage === source.packageName }"
          @click="selectSource(source)"
        >
          <n-thing>
            <template #header>
              <n-flex align="center" :wrap="false">
                <n-text strong>{{ source.appName }}</n-text>
                <n-tag v-if="source.isPlaying" size="small" type="success"> 播放中 </n-tag>
              </n-flex>
            </template>
            <template #description>
              <n-text depth="3" class="meta">
                {{ source.title || "未知歌曲" }}
                <template v-if="source.artist"> - {{ source.artist }} </template>
              </n-text>
            </template>
          </n-thing>
        </n-list-item>
      </n-list>
    </n-spin>
    <n-flex justify="end" class="actions">
      <n-button size="small" secondary @click="clearTarget"> 不限制 </n-button>
      <n-button size="small" secondary type="primary" :disabled="!selectedPackage" @click="confirm">
        确定
      </n-button>
    </n-flex>
  </div>
</template>

<script setup lang="ts">
import { AndroidNativePlayback } from "@/plugins/androidNativePlayback";
import { useSettingStore } from "@/stores";
import type { AndroidNativeMediaSource } from "@/plugins/androidNativePlayback";

const settingStore = useSettingStore();
const sources = ref<AndroidNativeMediaSource[]>([]);
const loading = ref(false);
const selectedPackage = ref(settingStore.androidMediaSourceTargetPackage);

const loadSources = async () => {
  loading.value = true;
  try {
    const result = await AndroidNativePlayback.getActiveMediaSources();
    sources.value = result.sources;
  } catch (error) {
    window.$message.error(`获取媒体源失败：${error}`);
  } finally {
    loading.value = false;
  }
};

const selectSource = (source: AndroidNativeMediaSource) => {
  selectedPackage.value = source.packageName;
};

const clearTarget = () => {
  selectedPackage.value = "";
  confirm();
};

const confirm = () => {
  settingStore.androidMediaSourceTargetPackage = selectedPackage.value;
  if (selectedPackage.value && !settingStore.androidMediaSourceListenerEnabled) {
    settingStore.androidMediaSourceListenerEnabled = true;
  }
  window.$message.success(selectedPackage.value ? `已选择监听：${selectedPackage.value}` : "已取消限制");
};

onMounted(() => {
  void loadSources();
});
</script>

<style lang="scss" scoped>
.media-source-selector {
  min-height: 200px;

  .active {
    background-color: var(--n-item-color-hover);
  }

  .meta {
    font-size: 12px;
  }

  .actions {
    margin-top: 16px;
  }
}
</style>
