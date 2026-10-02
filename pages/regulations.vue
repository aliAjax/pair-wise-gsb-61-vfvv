<script setup lang="ts">
import { regulationCatalog } from '~/data/seed';
import { useCertificationStore } from '~/stores/certification';

const store = useCertificationStore();
const selectedCategory = ref('全部');
const selectedProjectId = ref('TA-2026-118');

const categories = computed(() => ['全部', ...Array.from(new Set(regulationCatalog.map((item) => item.category)))]);
const visible = computed(() =>
  selectedCategory.value === '全部'
    ? regulationCatalog
    : regulationCatalog.filter((item) => item.category === selectedCategory.value)
);
const selectedProject = computed(() => store.projectById(selectedProjectId.value));
const projectOptions = computed(() => store.projects.map((project) => ({ label: `${project.id} · ${project.name}`, value: project.id })));

// 法规覆盖只认审阅人接受或已完成补件凭据认可的证据。
const completedTokenIds = computed(() =>
  selectedProject.value ? store.completedTokenIds(selectedProject.value.id) : new Set<string>()
);
</script>

<template>
  <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
    <div>
      <h1 class="text-2xl font-semibold">法规项目树</h1>
      <p class="mt-1 text-sm text-slate-600">
        按安全、环保、能耗、软件和部件分类查看证据覆盖；覆盖认定只接受已完成凭据。
      </p>
    </div>
    <div class="min-w-[320px]">
      <UFormGroup label="查看认证项目">
        <USelect v-model="selectedProjectId" :options="projectOptions" />
      </UFormGroup>
    </div>
  </div>

  <div class="mb-5 flex flex-wrap gap-2">
    <UButton
      v-for="category in categories"
      :key="category"
      size="xs"
      :variant="selectedCategory === category ? 'solid' : 'soft'"
      :color="selectedCategory === category ? 'primary' : 'gray'"
      @click="selectedCategory = category"
    >
      {{ category }}
    </UButton>
  </div>

  <div class="mb-4 border border-teal-200 bg-teal-50 p-3 text-xs text-teal-900">
    法规覆盖口径：审阅人直接接受的证据，或挂在「已完成」补件凭据下的证据才计入；草稿、待核对、失败凭据下的证据暂不覆盖。
  </div>

  <RegulationTree
    v-if="selectedProject"
    :regulations="visible"
    :evidence="selectedProject.evidence"
    :completed-token-ids="completedTokenIds"
    strict
  />
  <div v-else class="border border-red-200 bg-red-50 p-6 text-red-900">未找到所选认证项目。</div>
</template>
