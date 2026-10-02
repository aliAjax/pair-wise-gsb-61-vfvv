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
// 法规覆盖只认已完成凭据：未完成凭据的暂存证据不计入覆盖
const effectiveEvidence = computed(() =>
  selectedProject.value ? store.effectiveEvidence(selectedProject.value) : []
);
const incompleteTokenEvidence = computed(() =>
  selectedProject.value
    ? selectedProject.value.evidence.filter(
        (item) => item.supplementTokenId && !store.tokenIsComplete(selectedProject.value!.id, item.supplementTokenId)
      )
    : []
);
const projectOptions = computed(() => store.projects.map((project) => ({ label: `${project.id} · ${project.name}`, value: project.id })));
</script>

<template>
  <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
    <div>
      <h1 class="text-2xl font-semibold">法规项目树</h1>
      <p class="mt-1 text-sm text-slate-600">
        按安全、环保、能耗、软件和部件分类查看证据覆盖与配置完整性；覆盖只认已完成补件凭据。
      </p>
    </div>
    <div class="min-w-[320px]">
      <UFormGroup label="查看认证项目">
        <USelect v-model="selectedProjectId" :options="projectOptions" />
      </UFormGroup>
    </div>
  </div>

  <div v-if="incompleteTokenEvidence.length" class="mb-4 border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
    {{ incompleteTokenEvidence.length }} 项证据来自尚未完成的补件凭据，暂不计入下方法规覆盖；凭据完成或恢复续办后才生效。
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

  <RegulationTree
    v-if="selectedProject"
    :regulations="visible"
    :evidence="effectiveEvidence"
    :pending-evidence="incompleteTokenEvidence"
  />
  <div v-else class="border border-red-200 bg-red-50 p-6 text-red-900">未找到所选认证项目。</div>
</template>
