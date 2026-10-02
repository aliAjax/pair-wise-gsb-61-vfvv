<script setup lang="ts">
import type { EvidenceStatus, ProjectInput, ProjectStatus } from '~/types/certification';
import { supplementableStatuses } from '~/types/certification';
import { validateProjectInput, validateSubmission, validateSupplementCommit } from '~/services/validators';
import { useSupplementCredential } from '~/composables/useSupplementCredential';
import { useCertificationStore } from '~/stores/certification';

const route = useRoute();
const store = useCertificationStore();
const id = String(route.params.id);
const project = computed(() => store.projectById(id));
const activeTab = ref(0);
const message = ref('');
const error = ref('');

const editor = reactive<ProjectInput>({
  name: '',
  modelCode: '',
  vehicleType: '',
  configuration: '',
  maintenanceVersion: '',
  softwareVersion: '',
  applicant: '',
  agency: '',
  certificateExpiry: ''
});

watch(
  project,
  (value) => {
    if (!value) return;
    Object.assign(editor, {
      name: value.name,
      modelCode: value.modelCode,
      vehicleType: value.vehicleType,
      configuration: value.configuration,
      maintenanceVersion: value.maintenanceVersion,
      softwareVersion: value.softwareVersion,
      applicant: value.applicant,
      agency: value.agency,
      certificateExpiry: value.certificateExpiry
    });
  },
  { immediate: true }
);

const transitionStatus = ref<ProjectStatus>('under_review');
const transitionReason = ref('');
const editReason = ref('');

const supplementCredential = useSupplementCredential(project, { actor: () => project.value?.applicant ?? '申请主体' });

const supplementableEvidence = computed(() =>
  project.value ? project.value.evidence.filter((evidence) => supplementableStatuses.includes(evidence.status)) : []
);

const tabs = [
  { label: '证据文件', icon: 'i-heroicons-document-text' },
  { label: '法规项目', icon: 'i-heroicons-list-bullet' },
  { label: '版本与影响', icon: 'i-heroicons-arrows-right-left' },
  { label: '审计记录', icon: 'i-heroicons-clock' }
];

const transitionOptions = computed(() => {
  const current = project.value?.status;
  if (current === 'draft') return [{ label: '提交认证机构', value: 'submitted' }];
  if (current === 'submitted') return [{ label: '开始审阅', value: 'under_review' }];
  if (current === 'under_review') {
    return [
      { label: '要求补件', value: 'supplement_required' },
      { label: '批准', value: 'approved' },
      { label: '拒绝', value: 'rejected' }
    ];
  }
  if (current === 'supplement_required') return [{ label: '重新提交补件', value: 'submitted' }];
  return [{ label: '重新打开审阅', value: 'under_review' }];
});

const blockingIssues = computed(() => (project.value ? validateSubmission(project.value) : []));

function saveEditor() {
  message.value = '';
  error.value = '';
  const errors = validateProjectInput(editor);
  if (Object.keys(errors).length) {
    error.value = Object.values(errors)[0] ?? '项目资料校验失败';
    return;
  }
  if (!editReason.value.trim()) {
    error.value = '请填写本次变更原因';
    return;
  }
  store.updateProject(id, { ...editor }, editReason.value);
  editReason.value = '';
  message.value = '项目资料与版本影响已保存。';
}

function transition() {
  if (!project.value) return;
  message.value = '';
  error.value = '';
  if (!transitionReason.value.trim()) {
    error.value = '请填写审批流转依据';
    return;
  }
  if (transitionStatus.value === 'approved' && blockingIssues.value.length) {
    error.value = `存在阻断项，不能批准：${blockingIssues.value.join('；')}`;
    return;
  }
  store.transition(id, transitionStatus.value, project.value.reviewer === '待分派' ? '认证机构审阅人' : project.value.reviewer, transitionReason.value);
  transitionReason.value = '';
  message.value = '审批状态已更新。';
}

function updateEvidence(evidenceId: string, status: EvidenceStatus) {
  if (!project.value) return;
  store.updateEvidence(id, evidenceId, status, `审阅人将证据标记为${status}`);
  message.value = '证据审阅状态已更新。';
}

async function submitSupplement() {
  message.value = '';
  error.value = '';
  if (!project.value) return;
  const token = supplementCredential.token.value;
  if (!token) {
    error.value = '请先勾选待补件证据并填写说明，建立可续办的提交凭据';
    return;
  }
  if (token.status === 'pending_check') {
    error.value = `凭据已失效，停在待核对：${token.pendingReason}。请核对基线后续办，已选证据和说明已保留。`;
    return;
  }
  const errors = validateSupplementCommit(project.value, token);
  if (errors.length) {
    error.value = errors.join('；');
    return;
  }
  const outcome = await supplementCredential.commit();
  if (!outcome) return;
  if (outcome.status === 'complete') {
    message.value = `凭据 ${token.id} 提交完成：${outcome.applied.length} 项证据更新至当前基线并重新提交${
      outcome.skipped.length ? `，${outcome.skipped.length} 项已被他人处理未覆盖` : ''
    }。`;
  } else if (outcome.status === 'pending_check') {
    error.value = `提交被拦截：${outcome.pendingReason}。已选证据与说明保留，可核对后续办。`;
  } else if (outcome.error) {
    error.value = outcome.error;
  }
  if (supplementCredential.errorMessage.value) error.value = supplementCredential.errorMessage.value;
}
</script>

<template>
  <div v-if="!project" class="border border-red-200 bg-red-50 p-6 text-red-900">
    未找到认证项目 {{ id }}。
  </div>

  <template v-else>
    <div class="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <NuxtLink to="/" class="text-sm text-teal-700 hover:underline">返回认证项目</NuxtLink>
        <div class="mt-3 flex flex-wrap items-center gap-3">
          <h1 class="text-2xl font-semibold">{{ project.id }}</h1>
          <StatusBadge :status="project.status" />
        </div>
        <p class="mt-2 text-lg font-medium">{{ project.name }}</p>
        <p class="mt-1 text-sm text-slate-500">
          {{ project.modelCode }} · {{ project.vehicleType }} · {{ project.configuration }} · {{ project.maintenanceVersion }} / SW {{ project.softwareVersion }}
        </p>
      </div>
      <div class="min-w-[240px] border border-slate-200 bg-white p-4">
        <div class="flex items-center justify-between text-sm">
          <span class="text-slate-500">证据完整度</span>
          <span class="metric-value font-semibold">{{ project.progress }}%</span>
        </div>
        <UProgress class="mt-2" :value="project.progress" size="sm" />
        <p class="mt-2 text-xs text-slate-500">证书到期：{{ project.certificateExpiry }}</p>
      </div>
    </div>

    <div v-if="message" class="mb-4 border border-green-200 bg-green-50 p-3 text-sm text-green-900">{{ message }}</div>
    <div v-if="error" class="mb-4 border border-red-200 bg-red-50 p-3 text-sm text-red-900">{{ error }}</div>
    <div v-if="blockingIssues.length" class="mb-5 border border-amber-200 bg-amber-50 p-4">
      <p class="text-sm font-semibold text-amber-950">批准前阻断项</p>
      <ul class="mt-2 list-inside list-disc space-y-1 text-sm text-amber-900">
        <li v-for="issue in blockingIssues" :key="issue">{{ issue }}</li>
      </ul>
    </div>

    <section class="mb-6 grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
      <div class="border border-slate-200 bg-white p-5">
        <div class="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 class="font-semibold">项目与版本基线</h2>
            <p class="mt-1 text-xs text-slate-500">变更会生成新版本并标记受影响配置。</p>
          </div>
        </div>
        <form class="grid gap-4 md:grid-cols-2 xl:grid-cols-3" @submit.prevent="saveEditor">
          <UFormGroup label="项目名称"><UInput v-model="editor.name" /></UFormGroup>
          <UFormGroup label="车型代码"><UInput v-model="editor.modelCode" /></UFormGroup>
          <UFormGroup label="配置"><UInput v-model="editor.configuration" /></UFormGroup>
          <UFormGroup label="维护版本"><UInput v-model="editor.maintenanceVersion" /></UFormGroup>
          <UFormGroup label="软件版本"><UInput v-model="editor.softwareVersion" /></UFormGroup>
          <UFormGroup label="证书有效期"><UInput v-model="editor.certificateExpiry" type="date" /></UFormGroup>
          <UFormGroup label="申请主体"><UInput v-model="editor.applicant" /></UFormGroup>
          <UFormGroup label="认证机构"><UInput v-model="editor.agency" /></UFormGroup>
          <UFormGroup label="变更原因"><UInput v-model="editReason" placeholder="说明变更和影响范围" /></UFormGroup>
          <div class="md:col-span-2 xl:col-span-3">
            <UButton type="submit" color="primary">保存并生成版本</UButton>
          </div>
        </form>
      </div>

      <div class="border border-slate-200 bg-white p-5">
        <h2 class="font-semibold">审批流转</h2>
        <p class="mt-1 text-xs text-slate-500">批准前系统检查缺失证据、版本错配和配置覆盖。</p>
        <form class="mt-4 space-y-4" @submit.prevent="transition">
          <UFormGroup label="目标状态">
            <USelect v-model="transitionStatus" :options="transitionOptions" />
          </UFormGroup>
          <UFormGroup label="流转依据">
            <UTextarea v-model="transitionReason" :rows="3" placeholder="记录接受、拒绝或补件依据" />
          </UFormGroup>
          <UButton type="submit" color="primary" class="w-full justify-center">提交审批流转</UButton>
        </form>
      </div>
    </section>

    <UTabs v-model="activeTab" :items="tabs" class="mb-5" />

    <section v-if="activeTab === 0" class="border border-slate-200 bg-white">
      <div class="border-b border-slate-200 px-4 py-3">
        <h2 class="font-semibold">证据文件审阅</h2>
        <p class="mt-1 text-xs text-slate-500">逐项接受、拒绝或要求重新抽样。</p>
      </div>
      <EvidenceTable :evidence="project.evidence" editable @update="updateEvidence" />
    </section>

    <section v-else-if="activeTab === 1">
      <div class="mb-4">
        <h2 class="font-semibold">法规项目覆盖</h2>
        <p class="mt-1 text-sm text-slate-500">按法规项展开证据、配置覆盖和阻断问题。</p>
      </div>
      <RegulationTree :regulations="project.regulations" :evidence="project.evidence" />
    </section>

    <section v-else-if="activeTab === 2" class="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
      <div class="border border-slate-200 bg-white">
        <div class="border-b border-slate-200 px-4 py-3">
          <h2 class="font-semibold">版本差异</h2>
        </div>
        <div class="divide-y divide-slate-200">
          <article v-for="version in project.versions" :key="version.id" class="p-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p class="font-medium">{{ version.label }} · {{ version.author }}</p>
                <p class="mt-1 text-xs text-slate-500">{{ version.createdAt.slice(0, 16).replace('T', ' ') }}</p>
              </div>
              <UBadge color="gray" variant="soft">{{ version.impactedConfigurations.join('、') }}</UBadge>
            </div>
            <p class="mt-3 text-sm">{{ version.summary }}</p>
            <ul class="mt-2 list-inside list-disc text-sm text-slate-600">
              <li v-for="change in version.changes" :key="change">{{ change }}</li>
            </ul>
          </article>
        </div>
      </div>

      <div class="space-y-4">
        <div class="border border-slate-200 bg-white p-5">
          <h2 class="font-semibold">批量补件凭据</h2>
          <p class="mt-1 text-xs text-slate-500">
            勾选后凭据立即记住维护版本、软件版本和证据清单；其他标签页改动基线后，凭据立即失效并停在待核对，已选证据与说明保留。
          </p>
          <form class="mt-4 space-y-4" @submit.prevent="submitSupplement">
            <label
              v-for="item in supplementableEvidence"
              :key="item.id"
              class="flex gap-3 border border-slate-200 p-3"
            >
              <input v-model="supplementCredential.selectedEvidence.value" type="checkbox" :value="item.id" class="mt-1" />
              <span>
                <span class="block text-sm font-medium">{{ item.name }}</span>
                <span class="mt-1 block text-xs text-slate-500">{{ item.id }} · 当前 SW {{ item.softwareVersion }}</span>
              </span>
            </label>
            <p v-if="!supplementableEvidence.length" class="text-sm text-slate-500">
              当前没有待补件证据；可能已被另一个标签页处理。
            </p>
            <UFormGroup label="补件说明（凭据保存，可续办）">
              <UTextarea v-model="supplementCredential.note.value" :rows="3" placeholder="说明已完成的测试、配置覆盖和版本更新" />
            </UFormGroup>
            <div class="flex flex-wrap gap-2">
              <UButton
                type="submit"
                color="primary"
                class="w-full justify-center sm:w-auto"
                :loading="supplementCredential.committing.value"
                :disabled="!supplementCredential.canSubmit.value"
              >
                提交补件凭据
              </UButton>
              <UButton
                v-if="supplementCredential.tokenStatus.value === 'pending_check'"
                type="button"
                color="amber"
                variant="soft"
                @click="supplementCredential.recheck()"
              >
                核对基线后续办
              </UButton>
            </div>
            <p v-if="supplementCredential.tokenStatus.value === 'pending_check'" class="text-xs text-amber-800">
              凭据已停在待核对：{{ supplementCredential.pendingReason.value }}
            </p>
          </form>
        </div>

        <SupplementCredentialPanel
          v-if="supplementCredential.token.value"
          :project="project"
          :credential="supplementCredential"
        />

        <div class="border border-slate-200 bg-white p-5">
          <h2 class="font-semibold">凭据历史</h2>
          <p class="mt-1 text-xs text-slate-500">只有已完成凭据产生的补件才计入法规覆盖与审计导出。</p>
          <ul v-if="project.supplementTokens.length" class="mt-3 space-y-2 text-sm">
            <li v-for="tokenItem in project.supplementTokens" :key="tokenItem.id" class="border border-slate-200 p-3">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <span class="font-mono text-xs">{{ tokenItem.id }}</span>
                <UBadge
                  :color="tokenItem.status === 'complete' ? 'green' : tokenItem.status === 'pending_check' ? 'amber' : 'gray'"
                  variant="soft"
                >
                  {{ { draft: '草拟中', ready: '可提交', pending_check: '待核对', complete: '已完成' }[tokenItem.status] }}
                </UBadge>
              </div>
              <p class="mt-1 text-xs text-slate-500">
                记住基线 {{ tokenItem.baselineMaintenanceVersion }} / SW {{ tokenItem.baselineSoftwareVersion }}
                · 已选 {{ tokenItem.selectedEvidenceIds.length }} 项 · 已落账 {{ tokenItem.applied.length }} 项
              </p>
            </li>
          </ul>
          <p v-else class="mt-3 text-xs text-slate-500">尚无补件凭据。</p>
        </div>
      </div>
    </section>

    <section v-else class="border border-slate-200 bg-white p-5">
      <h2 class="font-semibold">项目审计记录</h2>
      <div class="mt-5 space-y-5">
        <article v-for="entry in project.audit" :key="entry.id" class="audit-item">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-sm font-medium">{{ entry.action }} · {{ entry.actor }}</p>
            <span class="text-xs text-slate-500">{{ entry.createdAt.slice(0, 16).replace('T', ' ') }}</span>
          </div>
          <p class="mt-1 text-sm text-slate-600">{{ entry.detail }}</p>
        </article>
      </div>
    </section>
  </template>
</template>
