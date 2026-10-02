<script setup lang="ts">
import { useCertificationStore } from '~/stores/certification';

const store = useCertificationStore();
const selectedProjectId = ref('');

const projectOptions = computed(() =>
  store.projects.map((project) => ({
    label: `${project.id} · ${project.name}`,
    value: project.id
  }))
);

const current = computed(() => store.projects.find((project) => project.id === selectedProjectId.value));
const pendingCount = computed(
  () =>
    current.value?.evidence.filter((item) => ['rejected', 'resubmit', 'missing'].includes(item.status)).length ??
    0
);

onMounted(() => {
  store.hydrate();
  if (!selectedProjectId.value && projectOptions.value[0]) {
    selectedProjectId.value = projectOptions.value[0].value;
  }
});
</script>

<template>
  <div class="mb-6">
    <h1 class="text-2xl font-semibold">批量补件工作区</h1>
    <p class="mt-1 text-sm text-slate-600">
      每次补件都是可续办的提交凭据：先记住基线与证据清单，提交失败可恢复，重复提交幂等。
    </p>
  </div>

  <div class="grid gap-6 xl:grid-cols-[minmax(280px,1fr)_minmax(0,2fr)]">
    <section class="h-fit border border-slate-200 bg-white p-5">
      <UFormGroup label="认证项目">
        <USelect v-model="selectedProjectId" :options="projectOptions" />
      </UFormGroup>
      <div v-if="current" class="mt-5 space-y-3 text-sm">
        <div>
          <p class="text-slate-500">车型配置</p>
          <p class="mt-1 font-medium">{{ current.modelCode }} · {{ current.configuration }}</p>
        </div>
        <div>
          <p class="text-slate-500">当前版本基线</p>
          <p class="mt-1 font-medium">{{ current.maintenanceVersion }} / SW {{ current.softwareVersion }}</p>
        </div>
        <div>
          <p class="text-slate-500">待补件数量</p>
          <p class="metric-value mt-1 text-2xl font-semibold">{{ pendingCount }}</p>
        </div>
      </div>
    </section>

    <SupplementPanel v-if="current" :project="current" :actor="current.applicant" />
    <section v-else class="border border-slate-200 bg-white p-6 text-sm text-slate-500">请选择认证项目。</section>
  </div>
</template>
