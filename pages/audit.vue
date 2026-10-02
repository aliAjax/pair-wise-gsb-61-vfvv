<script setup lang="ts">
import { useCertificationStore } from '~/stores/certification';

const store = useCertificationStore();
const selectedProject = ref('all');
const projectOptions = computed(() => [
  { label: '全部项目', value: 'all' },
  ...store.projects.map((project) => ({ label: `${project.id} · ${project.name}`, value: project.id }))
]);

function tokenStatusFor(projectId: string, tokenId?: string) {
  if (!tokenId) return null;
  return store.tokenIsComplete(projectId, tokenId) ? 'complete' : 'incomplete';
}

// 时间线展示全部轨迹，但补件条目标注其凭据是否完成
const entries = computed(() =>
  store.projects
    .filter((project) => selectedProject.value === 'all' || project.id === selectedProject.value)
    .flatMap((project) =>
      project.audit.map((entry) => ({
        ...entry,
        projectId: project.id,
        projectName: project.name,
        tokenState: tokenStatusFor(project.id, entry.supplementTokenId)
      }))
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
);

function exportAudit() {
  // 法规覆盖和审计导出只认已完成的凭据：未完成凭据的证据与审计条目不进入提交包
  const scopedProjects = store.projects.filter(
    (project) => selectedProject.value === 'all' || project.id === selectedProject.value
  );
  const payload = {
    generatedAt: new Date().toISOString(),
    scope: selectedProject.value,
    policy: '仅导出已完成补件凭据（complete）产生的证据与审计记录',
    projects: scopedProjects.map((project) => {
      const completedTokenIds = new Set(
        project.supplementTokens.filter((token) => token.status === 'complete').map((token) => token.id)
      );
      return {
        id: project.id,
        status: project.status,
        maintenanceVersion: project.maintenanceVersion,
        softwareVersion: project.softwareVersion,
        versions: project.versions,
        // 剔除挂在未完成凭据上的证据状态
        evidence: project.evidence.filter(
          (item) => !item.supplementTokenId || completedTokenIds.has(item.supplementTokenId)
        ),
        completedSupplementTokens: project.supplementTokens.filter((token) => token.status === 'complete'),
        audit: project.audit.filter(
          (entry) => !entry.supplementTokenId || completedTokenIds.has(entry.supplementTokenId)
        )
      };
    })
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'vehicle-type-approval-audit-package.json';
  anchor.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
    <div>
      <h1 class="text-2xl font-semibold">审计与提交包</h1>
      <p class="mt-1 text-sm text-slate-600">
        保留项目变更、证据审阅、状态流转和补件凭据的完整轨迹；导出只认已完成凭据。
      </p>
    </div>
    <div class="flex flex-wrap items-end gap-3">
      <div class="min-w-[300px]">
        <UFormGroup label="审计范围">
          <USelect v-model="selectedProject" :options="projectOptions" />
        </UFormGroup>
      </div>
      <UButton color="primary" @click="exportAudit">导出提交包</UButton>
    </div>
  </div>

  <section class="border border-slate-200 bg-white">
    <div class="border-b border-slate-200 px-4 py-3">
      <h2 class="font-semibold">审批时间线</h2>
      <p class="mt-1 text-xs text-slate-500">共 {{ entries.length }} 条记录；补件条目随凭据状态标注，未完成凭据不计入导出。</p>
    </div>
    <div class="space-y-5 p-5">
      <article v-for="entry in entries" :key="entry.id" class="audit-item">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="flex flex-wrap items-center gap-2 text-sm font-medium">
            {{ entry.action }} · {{ entry.actor }}
            <UBadge v-if="entry.tokenState === 'complete'" color="green" variant="soft">已完成凭据</UBadge>
            <UBadge v-else-if="entry.tokenState === 'incomplete'" color="amber" variant="soft">凭据未完成 · 不导出</UBadge>
          </p>
          <span class="text-xs text-slate-500">{{ entry.createdAt.slice(0, 16).replace('T', ' ') }}</span>
        </div>
        <p class="mt-1 text-sm text-slate-600">{{ entry.detail }}</p>
        <p class="mt-1 text-xs text-slate-500">{{ entry.projectId }} · {{ entry.projectName }}</p>
      </article>
      <p v-if="!entries.length" class="py-10 text-center text-sm text-slate-500">没有符合条件的审计记录。</p>
    </div>
  </section>
</template>
