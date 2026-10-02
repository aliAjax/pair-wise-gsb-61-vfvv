<script setup lang="ts">
import type { ApprovalProject } from '~/types/certification';
import { useSupplementCredential } from '~/composables/useSupplementCredential';

const props = withDefaults(
  defineProps<{
    project: ApprovalProject;
    actor?: string;
  }>(),
  { actor: '远航汽车工程部' }
);

const projectRef = toRef(props, 'project');
const credential = useSupplementCredential(projectRef, props.actor);

const {
  token,
  history,
  pendingEvidence,
  selectedEvidenceIds,
  note,
  simulateFailure,
  submitting,
  busy,
  message,
  isStale,
  isFailed,
  lastCompleted,
  manifestDiffs,
  blockedSelections,
  start,
  rebase,
  submit
} = credential;

function isBlocked(evidenceId: string) {
  const item = props.project.evidence.find((evidence) => evidence.id === evidenceId);
  if (!item) return false;
  return item.status === 'accepted' || (item.status === 'submitted' && Boolean(item.submissionTokenId));
}
</script>

<template>
  <div class="border border-slate-200 bg-white">
    <div class="border-b border-slate-200 px-4 py-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="font-semibold">补件提交凭据</h2>
        <SupplementTokenBadge v-if="token" :status="token.status" />
      </div>
      <p class="mt-1 text-xs text-slate-500">
        每次补件先记住维护版本、软件版本和证据清单；基线被其他标签页改动后凭据停在待核对，已选证据与说明保留，核对后续办。
      </p>
    </div>

    <div class="space-y-4 p-4">
      <div
        v-if="message"
        :class="{
          'border-amber-200 bg-amber-50 text-amber-900': message.tone === 'warning',
          'border-red-200 bg-red-50 text-red-900': message.tone === 'error',
          'border-green-200 bg-green-50 text-green-900': message.tone === 'success'
        }"
        class="border p-3 text-sm"
      >
        {{ message.text }}
      </div>

      <div v-if="lastCompleted && token?.status !== 'completed'" class="border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        最后一个完整凭据：<span class="font-mono font-medium">{{ lastCompleted.id }}</span>
        （{{ lastCompleted.completedAt?.slice(0, 16).replace('T', ' ') }} 完成，
        推进 {{ lastCompleted.appliedEvidenceIds?.length ?? 0 }} 项）；
        新凭据将从该凭据接着处理，不重复提交已推进证据。
      </div>

      <div v-if="!token" class="space-y-3">
        <p class="text-sm text-slate-600">
          开始补件会创建一张可续办的提交凭据，固化当前基线
          <span class="font-medium">{{ project.maintenanceVersion }} / SW {{ project.softwareVersion }}</span>
          和 {{ project.evidence.length }} 项证据清单。
        </p>
        <UButton color="primary" :loading="busy" @click="start">开始补件（创建凭据）</UButton>
      </div>

      <template v-else>
        <div class="grid gap-3 text-sm sm:grid-cols-3">
          <div class="border border-slate-200 p-3">
            <p class="text-xs text-slate-500">凭据编号</p>
            <p class="mt-1 font-mono text-sm font-medium">{{ token.id }}</p>
          </div>
          <div class="border border-slate-200 p-3">
            <p class="text-xs text-slate-500">凭据记住的基线</p>
            <p class="mt-1 font-medium">{{ token.baseline.maintenanceVersion }} / SW {{ token.baseline.softwareVersion }}</p>
          </div>
          <div class="border border-slate-200 p-3">
            <p class="text-xs text-slate-500">项目当前基线</p>
            <p class="mt-1 font-medium" :class="isStale ? 'text-red-700' : 'text-slate-800'">
              {{ project.maintenanceVersion }} / SW {{ project.softwareVersion }}
            </p>
          </div>
        </div>

        <div v-if="isFailed" class="border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          <p class="font-semibold">{{ token.lastError ?? '上次提交失败。' }}</p>
          <p class="mt-1">证据状态未被推进；勾选与说明已随凭据保留，直接重试即可，从最后一个完整凭据接着处理。</p>
        </div>

        <div v-if="isStale" class="space-y-3 border border-amber-300 bg-amber-50 p-4">
          <p class="text-sm font-semibold text-amber-950">凭据已停在待核对：另一个标签页改动了版本基线</p>
          <p class="text-sm text-amber-900">
            旧凭据基线 {{ token.baseline.maintenanceVersion }} / SW {{ token.baseline.softwareVersion }}
            → 当前 {{ project.maintenanceVersion }} / SW {{ project.softwareVersion }}。
            已选 {{ selectedEvidenceIds.length }} 项证据和补件说明已保留，核对清单变化后续办：
          </p>
          <ul v-if="manifestDiffs.length" class="list-inside list-disc space-y-1 text-sm text-amber-900">
            <li v-for="diff in manifestDiffs" :key="diff.id">{{ diff.text }}</li>
          </ul>
          <p v-else class="text-sm text-amber-900">证据清单内容未变化，可直接按新基线续办。</p>
          <UButton color="amber" variant="solid" :loading="busy" @click="rebase">核对无误，按新基线续办</UButton>
        </div>

        <div class="space-y-2">
          <p class="text-sm font-medium">选择待补件证据（凭据清单）</p>
          <label
            v-for="item in pendingEvidence"
            :key="item.id"
            class="flex gap-3 border border-slate-200 p-3"
            :class="isBlocked(item.id) ? 'bg-slate-50 opacity-70' : ''"
          >
            <input
              v-model="selectedEvidenceIds"
              type="checkbox"
              :value="item.id"
              :disabled="isStale || isBlocked(item.id)"
              class="mt-1"
            />
            <span class="min-w-0 flex-1">
              <span class="flex flex-wrap items-center justify-between gap-2">
                <span class="text-sm font-medium">{{ item.name }}</span>
                <span class="flex items-center gap-2">
                  <UBadge v-if="isBlocked(item.id)" color="green" variant="soft">已被接受/提交，跳过</UBadge>
                  <StatusBadge :status="item.status" />
                </span>
              </span>
              <span class="mt-1 block text-xs text-slate-500">
                {{ item.id }} · {{ item.regulationId }} · 文件 {{ item.version }} · 当前 SW {{ item.softwareVersion }}
              </span>
            </span>
          </label>

          <p v-if="blockedSelections.length" class="border-l-2 border-amber-500 pl-3 text-xs text-slate-600">
            已选的 {{ blockedSelections.map((item) => item.name).join('、') }}
            已被他人接受或由其他凭据提交，本次会跳过且不覆盖其结果。
          </p>

          <p v-if="!pendingEvidence.length" class="py-6 text-center text-sm text-slate-500">当前没有待补件证据。</p>
        </div>

        <UFormGroup label="补件说明（自动保存到凭据）">
          <UTextarea
            v-model="note"
            :rows="3"
            :disabled="isStale"
            placeholder="说明新增测试、配置覆盖和版本核对结论"
          />
        </UFormGroup>

        <label class="flex items-center gap-2 text-xs text-slate-500">
          <input v-model="simulateFailure" type="checkbox" :disabled="submitting" />
          模拟本次提交失败（用于验证失败恢复：证据不推进，凭据保留可重试）
        </label>

        <div class="flex flex-wrap items-center gap-3">
          <UButton
            color="primary"
            :loading="submitting"
            :disabled="isStale || !pendingEvidence.length"
            @click="submit"
          >
            {{ isFailed ? '重试提交（继续使用本凭据）' : '用此凭据提交补件' }}
          </UButton>
          <span class="text-xs text-slate-500">重复提交不会再次推进证据，也不会覆盖别人刚接受的结果。</span>
        </div>
      </template>

      <div v-if="history.length" class="border-t border-slate-200 pt-4">
        <p class="mb-2 text-sm font-medium">凭据记录（法规覆盖与审计导出只认已完成凭据）</p>
        <ul class="space-y-2">
          <li
            v-for="item in history"
            :key="item.id"
            class="flex flex-wrap items-center justify-between gap-2 border border-slate-200 px-3 py-2 text-sm"
          >
            <span class="flex items-center gap-2">
              <span class="font-mono text-xs">{{ item.id }}</span>
              <SupplementTokenBadge :status="item.status" />
              <span v-if="item.previousCompletedTokenId" class="text-xs text-slate-400">
                续自 {{ item.previousCompletedTokenId }}
              </span>
            </span>
            <span class="text-xs text-slate-500">
              {{ item.baseline.maintenanceVersion }} / SW {{ item.baseline.softwareVersion }} ·
              {{ item.selectedEvidenceIds.length }} 项勾选
              <span v-if="item.status === 'completed'">
                · 推进 {{ item.appliedEvidenceIds?.length ?? 0 }} / 跳过 {{ item.skippedEvidenceIds?.length ?? 0 }}
              </span>
              · {{ item.updatedAt.slice(0, 16).replace('T', ' ') }}
            </span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
