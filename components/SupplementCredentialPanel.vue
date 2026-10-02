<script setup lang="ts">
import type { SupplementCredential } from '~/composables/useSupplementCredential';
import type { ApprovalProject } from '~/types/certification';

const props = defineProps<{
  project: ApprovalProject;
  credential: SupplementCredential;
  compact?: boolean;
}>();

const statusMeta: Record<string, { label: string; color: 'gray' | 'green' | 'amber' | 'teal' }> = {
  draft: { label: '草拟中', color: 'gray' },
  ready: { label: '已记住基线 · 可提交', color: 'teal' },
  pending_check: { label: '待核对 · 凭据已失效', color: 'amber' },
  complete: { label: '已完成', color: 'green' },
  none: { label: '尚未发起', color: 'gray' }
};

const token = computed(() => props.credential.token.value);
const committing = computed(() => props.credential.committing.value);
const canSubmit = computed(() => props.credential.canSubmit.value);
const baselineChanged = computed(() => props.credential.baselineChanged.value);
</script>

<template>
  <div
    v-if="token"
    class="border p-4 text-sm"
    :class="{
      'border-amber-300 bg-amber-50': token.status === 'pending_check',
      'border-teal-300 bg-teal-50': token.status === 'ready',
      'border-slate-200 bg-slate-50': token.status === 'draft',
      'border-green-300 bg-green-50': token.status === 'complete'
    }"
  >
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="font-semibold">
        提交凭据
        <span class="ml-1 font-mono text-xs text-slate-500">{{ token.id }}</span>
      </p>
      <UBadge :color="statusMeta[token.status]?.color ?? 'gray'" variant="soft">
        {{ statusMeta[token.status]?.label ?? token.status }}
      </UBadge>
    </div>

    <dl class="mt-3 grid gap-2 text-xs sm:grid-cols-2">
      <div>
        <dt class="text-slate-500">凭据记住的基线</dt>
        <dd class="mt-0.5 font-medium">
          {{ token.baselineMaintenanceVersion }} / SW {{ token.baselineSoftwareVersion }}
        </dd>
      </div>
      <div>
        <dt class="text-slate-500">当前项目基线</dt>
        <dd class="mt-0.5 font-medium" :class="baselineChanged ? 'text-amber-800' : ''">
          {{ project.maintenanceVersion }} / SW {{ project.softwareVersion }}
          <span v-if="baselineChanged">（已变化）</span>
        </dd>
      </div>
      <div class="sm:col-span-2">
        <dt class="text-slate-500">凭据记住的证据清单</dt>
        <dd class="mt-0.5">
          {{ token.evidenceManifest.length }} 项 · 已选 {{ token.selectedEvidenceIds.length }} 项 · 已落账 {{ token.applied.length }} 项
        </dd>
      </div>
    </dl>

    <div v-if="token.status === 'pending_check'" class="mt-3 border-l-2 border-amber-500 pl-3 text-amber-900">
      <p class="font-medium">停在待核对：已选证据和补件说明已保留</p>
      <p class="mt-1 text-xs">{{ token.pendingReason }}</p>
      <UButton size="xs" color="amber" variant="solid" class="mt-2" @click="credential.recheck()">
        核对当前基线后续办
      </UButton>
    </div>

    <p v-if="token.lastError" class="mt-3 border-l-2 border-red-500 pl-3 text-xs text-red-800">
      {{ token.lastError }}
    </p>

    <div v-if="token.applied.length && !compact" class="mt-3">
      <p class="text-xs font-medium text-slate-600">已落账项（失败恢复时从下一项继续，不会重复推进）</p>
      <ul class="mt-1 list-inside list-disc text-xs text-slate-600">
        <li v-for="change in token.applied" :key="change.evidenceId">
          {{ change.name }}：{{ change.fromStatus }} → {{ change.toStatus }}（SW {{ change.softwareVersion }}）
        </li>
      </ul>
    </div>

    <div class="mt-3 flex flex-wrap gap-2">
      <UButton
        size="xs"
        color="primary"
        :loading="committing"
        :disabled="!canSubmit"
        @click="credential.commit()"
      >
        {{ committing ? '提交中…' : '使用该凭据提交补件' }}
      </UButton>
      <UButton size="xs" color="gray" variant="ghost" :disabled="token.status === 'complete'" @click="credential.discard()">
        放弃凭据
      </UButton>
      <UButton v-if="!compact" size="xs" color="red" variant="ghost" @click="credential.armFailureInjection()">
        模拟下一次提交失败
      </UButton>
    </div>
  </div>
</template>
