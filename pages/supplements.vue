<script setup lang="ts">
import { validateSupplementCommit } from '~/services/validators';
import { useSupplementCredential } from '~/composables/useSupplementCredential';
import { useCertificationStore } from '~/stores/certification';
import { supplementableStatuses } from '~/types/certification';

const store = useCertificationStore();
const selectedProjectId = ref('');
const message = ref('');
const error = ref('');

const projectOptions = computed(() =>
  store.projects
    .filter((project) => project.evidence.some((evidence) => supplementableStatuses.includes(evidence.status)))
    .map((project) => ({
      label: `${project.id} · ${project.name}`,
      value: project.id
    }))
);

const current = computed(() => store.projects.find((project) => project.id === selectedProjectId.value));

// 切换项目时每个项目的凭据由 store 持久化；组合式逻辑跟随当前项目
const credential = useSupplementCredential(current as Ref<ReturnType<typeof store.projectById> | undefined>, {
  actor: () => current.value?.applicant ?? '申请主体'
});

const pendingEvidence = computed(
  () => current.value?.evidence.filter((item) => supplementableStatuses.includes(item.status)) ?? []
);

const lockedReason = (evidenceId: string) => {
  if (credential.lastAppliedIds.value.has(evidenceId)) return '已由当前凭据落账';
  return '';
};

async function submit() {
  message.value = '';
  error.value = '';
  if (!current.value) {
    error.value = '请选择需要补件的认证项目';
    return;
  }
  if (!credential.token.value) {
    error.value = '请先勾选待补件证据并填写说明，建立可续办的提交凭据';
    return;
  }
  if (credential.tokenStatus.value === 'pending_check') {
    error.value = `凭据已失效，停在待核对：${credential.pendingReason.value}。请核对基线后续办，已选证据和说明已保留。`;
    return;
  }
  const errors = validateSupplementCommit(current.value, credential.token.value);
  if (errors.length) {
    error.value = errors.join('；');
    return;
  }
  const outcome = await credential.commit();
  if (!outcome) return;
  if (outcome.status === 'complete') {
    message.value = `凭据提交完成：${outcome.applied.length} 项证据已更新至基线并重新提交${
      outcome.skipped.length ? `，${outcome.skipped.length} 项已被他人处理，未重复推进` : ''
    }。`;
  } else if (outcome.status === 'pending_check') {
    error.value = `提交被拦截：${outcome.pendingReason}。已选证据与说明保留，可核对后续办。`;
  } else if (outcome.error) {
    error.value = outcome.error;
  }
  if (credential.errorMessage.value) error.value = credential.errorMessage.value;
}

watch(selectedProjectId, () => {
  message.value = '';
  error.value = '';
});

onMounted(() => {
  store.hydrate();
  if (!selectedProjectId.value && projectOptions.value[0]) selectedProjectId.value = projectOptions.value[0].value;
});
</script>

<template>
  <div class="mb-6">
    <h1 class="text-2xl font-semibold">批量补件工作区</h1>
    <p class="mt-1 text-sm text-slate-600">
      每次补件都是可续办的提交凭据：先记住维护版本、软件版本和证据清单；另一标签页改动基线后凭据立即失效并停在待核对，已选证据和说明继续保留。
    </p>
  </div>

  <div v-if="message" class="mb-4 border border-green-200 bg-green-50 p-3 text-sm text-green-900">{{ message }}</div>
  <div v-if="error" class="mb-4 border border-red-200 bg-red-50 p-3 text-sm text-red-900">{{ error }}</div>

  <div class="grid gap-6 xl:grid-cols-[minmax(280px,1fr)_minmax(0,2fr)]">
    <section class="space-y-4">
      <div class="border border-slate-200 bg-white p-5">
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
            <p class="metric-value mt-1 text-2xl font-semibold">{{ pendingEvidence.length }}</p>
          </div>
        </div>
      </div>

      <SupplementCredentialPanel
        v-if="current && credential.token.value"
        :project="current"
        :credential="credential"
      />
    </section>

    <section class="border border-slate-200 bg-white">
      <div class="border-b border-slate-200 px-4 py-3">
        <h2 class="font-semibold">选择待补件证据</h2>
        <p class="mt-1 text-xs text-slate-500">
          勾选与说明会立即保存在凭据草稿中；提交只推进仍处于待补件状态的证据，重复提交同一凭据不会再次推进。
        </p>
      </div>
      <form class="p-4" @submit.prevent="submit">
        <div class="space-y-3">
          <label v-for="item in pendingEvidence" :key="item.id" class="flex gap-3 border border-slate-200 p-4">
            <input
              v-model="credential.selectedEvidence.value"
              type="checkbox"
              :value="item.id"
              :disabled="!!lockedReason(item.id)"
              class="mt-1"
            />
            <span class="min-w-0 flex-1">
              <span class="flex flex-wrap items-center justify-between gap-2">
                <strong class="text-sm">{{ item.name }}</strong>
                <span class="flex items-center gap-2">
                  <span v-if="lockedReason(item.id)" class="text-xs text-slate-500">{{ lockedReason(item.id) }}</span>
                  <StatusBadge :status="item.status" />
                </span>
              </span>
              <span class="mt-2 block text-sm text-slate-600">{{ item.note }}</span>
              <span class="mt-2 block text-xs text-slate-500">
                {{ item.regulationId }} · 文件 {{ item.version }} · 软件 {{ item.softwareVersion }} · {{ item.configurations.join('、') }}
              </span>
            </span>
          </label>
          <p v-if="!pendingEvidence.length" class="py-10 text-center text-sm text-slate-500">
            没有待补件证据；其他标签页可能已处理完毕。
          </p>
        </div>

        <div class="mt-5">
          <UFormGroup label="补件说明（凭据保存，失败或待核对后继续保留）">
            <UTextarea v-model="credential.note.value" :rows="4" placeholder="填写新增测试、说明文件、版本核对和配置覆盖结论" />
          </UFormGroup>
        </div>
        <div class="mt-4 flex flex-wrap gap-3">
          <UButton type="submit" color="primary" :loading="credential.committing.value" :disabled="!credential.canSubmit.value">
            提交补件凭据
          </UButton>
          <UButton
            type="button"
            color="amber"
            variant="soft"
            v-if="credential.tokenStatus.value === 'pending_check'"
            @click="credential.recheck()"
          >
            核对基线后续办
          </UButton>
        </div>
        <p v-if="credential.tokenStatus.value === 'pending_check'" class="mt-2 text-xs text-amber-800">
          凭据已停在待核对：{{ credential.pendingReason.value }}
        </p>
      </form>
    </section>
  </div>
</template>
