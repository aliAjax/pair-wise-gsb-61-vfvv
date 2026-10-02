<script setup lang="ts">
import { useCertificationStore } from '~/stores/certification';
import { credentialEvidence } from '~/services/validators';

const store = useCertificationStore();
const selectedProject = ref('all');
const projectOptions = computed(() => [
  { label: '全部项目', value: 'all' },
  ...store.projects.map((project) => ({ label: `${project.id} · ${project.name}`, value: project.id }))
]);

const scopedProjects = computed(() =>
  store.projects.filter((project) => selectedProject.value === 'all' || project.id === selectedProject.value)
);

/** 导出与补件认定只认已完成凭据：构建 tokenId -> token 的查找表。 */
const tokenMap = computed(() => new Map(store.tokens.map((token) => [token.id, token])));
const completedTokenIdsFor = (projectId: string) => store.completedTokenIds(projectId);

interface TimelineRow {
  id: string;
  projectId: string;
  projectName: string;
  actor: string;
  action: string;
  detail: string;
  createdAt: string;
  supplementTokenId?: string;
  credentialCompleted: boolean;
}

const entries = computed<TimelineRow[]>(() =>
  scopedProjects.value
    .flatMap((project) =>
      project.audit.map((entry) => {
        const token = entry.supplementTokenId ? tokenMap.value.get(entry.supplementTokenId) : undefined;
        return {
          ...entry,
          projectId: project.id,
          projectName: project.name,
          credentialCompleted: token?.status === 'completed'
        };
      })
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
);

/** 只导出已完成凭据认可的审计轨迹和证据。 */
function exportAudit() {
  const projects = scopedProjects.value.map((project) => {
    const completedIds = completedTokenIdsFor(project.id);
    return {
      id: project.id,
      status: project.status,
      maintenanceVersion: project.maintenanceVersion,
      softwareVersion: project.softwareVersion,
      versions: project.versions,
      // 证据：审阅人直接接受 + 已完成凭据补件
      evidence: credentialEvidence(project, completedIds),
      // 审计：补件相关记录只保留由已完成凭据产生的；其他流转记录保留
      audit: project.audit.filter(
        (entry) => !entry.supplementTokenId || completedIds.has(entry.supplementTokenId)
      ),
      completedSupplementTokens: store.tokens.filter(
        (token) => token.projectId === project.id && token.status === 'completed'
      )
    };
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    scope: selectedProject.value,
    credentialPolicy: '仅包含审阅人接受或已完成补件凭据认可的证据与审计记录',
    projects
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
        补件凭据贯穿状态流转；导出的提交包只包含已完成凭据认可的证据与记录。
      </p>
    </div>
    <div class="flex flex-wrap items-end gap-3">
      <div class="min-w-[300px]">
        <UFormGroup label="审计范围">
          <USelect v-model="selectedProject" :options="projectOptions" />
        </UFormGroup>
      </div>
      <UButton color="primary" @click="exportAudit">导出提交包（只含已完成凭据）</UButton>
    </div>
  </div>

  <section class="border border-slate-200 bg-white">
    <div class="border-b border-slate-200 px-4 py-3">
      <h2 class="font-semibold">审批时间线</h2>
      <p class="mt-1 text-xs text-slate-500">共 {{ entries.length }} 条记录；未完成凭据的补件记录会明确标记。</p>
    </div>
    <div class="space-y-5 p-5">
      <article v-for="entry in entries" :key="entry.id" class="audit-item">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="flex flex-wrap items-center gap-2 text-sm font-medium">
            {{ entry.action }} · {{ entry.actor }}
            <UBadge v-if="entry.supplementTokenId" :color="entry.credentialCompleted ? 'green' : 'amber'" variant="soft">
              {{ entry.credentialCompleted ? `凭据已完成 ${entry.supplementTokenId}` : `凭据未完成 ${entry.supplementTokenId}（导出忽略）` }}
            </UBadge>
          </p>
          <span class="text-xs text-slate-500">{{ entry.createdAt.slice(0, 16).replace('T', ' ') }}</span>
        </div>
        <p class="mt-1 text-sm" :class="entry.supplementTokenId && !entry.credentialCompleted ? 'text-amber-800' : 'text-slate-600'">
          {{ entry.detail }}
        </p>
        <p class="mt-1 text-xs text-slate-500">{{ entry.projectId }} · {{ entry.projectName }}</p>
      </article>
      <p v-if="!entries.length" class="py-10 text-center text-sm text-slate-500">没有符合条件的审计记录。</p>
    </div>
  </section>
</template>
