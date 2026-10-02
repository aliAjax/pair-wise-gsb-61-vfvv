import { storeToRefs } from 'pinia';
import type { ApprovalProject, CommitOutcome, SupplementToken } from '~/types/certification';
import { useCertificationStore } from '~/stores/certification';

export interface SupplementCredential {
  token: Ref<SupplementToken | null>;
  tokenStatus: ComputedRef<SupplementToken['status'] | 'none'>;
  selectedEvidence: Ref<string[]>;
  note: Ref<string>;
  pendingReason: ComputedRef<string>;
  canRecheck: ComputedRef<boolean>;
  canSubmit: ComputedRef<boolean>;
  selectedItems: ComputedRef<SupplementToken['evidenceManifest']>;
  lastAppliedIds: ComputedRef<Set<string>>;
  commit: () => Promise<CommitOutcome | null>;
  recheck: () => void;
  discard: () => void;
  armFailureInjection: () => void;
  baselineChanged: ComputedRef<boolean>;
  committing: Ref<boolean>;
  resultMessage: Ref<string>;
  errorMessage: Ref<string>;
}

/**
 * 可续办的补件提交凭据工作流：
 * - 选择证据 / 填写说明即建立 draft 凭据并自动保存
 * - 核对后记住维护版本、软件版本和证据清单（ready）
 * - 基线被任何标签页改动后立即停在 pending_check，选择与说明保留
 * - 提交失败后凭据与已落账项保留，从最后一个完整凭据之后继续
 */
export function useSupplementCredential(
  projectRef: Ref<ApprovalProject | undefined>,
  options?: { actor?: () => string }
): SupplementCredential {
  const store = useCertificationStore();
  const { committingTokenId } = storeToRefs(store);

  const selectedEvidence = ref<string[]>([]);
  const note = ref('');
  const committing = ref(false);
  const resultMessage = ref('');
  const errorMessage = ref('');
  /** 完成后保留刚结束的凭据编号，便于展示结果，直到开始新一轮 */
  const finishedTokenId = ref<string | null>(null);

  const token = computed(() => {
    const project = projectRef.value;
    if (!project) return null;
    return store.openTokenForProject(project.id) ?? project.supplementTokens.find((t) => t.id === finishedTokenId.value) ?? null;
  });

  const tokenStatus = computed(() => token.value?.status ?? 'none');
  const pendingReason = computed(() => token.value?.pendingReason ?? '');
  const baselineChanged = computed(() => {
    const project = projectRef.value;
    const current = token.value;
    if (!project || !current) return false;
    return (
      current.baselineMaintenanceVersion !== project.maintenanceVersion ||
      current.baselineSoftwareVersion !== project.softwareVersion
    );
  });

  const canRecheck = computed(() => token.value?.status === 'pending_check' || token.value?.status === 'draft');
  const canSubmit = computed(() => token.value?.status === 'ready' && !committing.value);
  const selectedItems = computed(() => token.value?.evidenceManifest.filter((item) => token.value?.selectedEvidenceIds.includes(item.evidenceId)) ?? []);
  const lastAppliedIds = computed(() => new Set(token.value?.applied.map((change) => change.evidenceId) ?? []));

  let syncing = false;
  // 凭据（含从持久化恢复的未完成凭据）→ 表单：已选证据和说明继续保留
  watch(
    token,
    (value) => {
      if (!value) {
        syncing = true;
        selectedEvidence.value = [];
        note.value = '';
        syncing = false;
        return;
      }
      syncing = true;
      selectedEvidence.value = [...value.selectedEvidenceIds];
      note.value = value.note;
      syncing = false;
    },
    { immediate: true }
  );

  // 切换项目时重置完成态引用
  watch(
    () => projectRef.value?.id,
    () => {
      finishedTokenId.value = null;
      resultMessage.value = '';
      errorMessage.value = '';
    }
  );

  // 表单 → 凭据草稿自动保存
  watch([selectedEvidence, note], () => {
    if (syncing) return;
    const project = projectRef.value;
    if (!project) return;
    const actor = options?.actor?.() ?? project.applicant;
    if (token.value && token.value.status !== 'complete') {
      store.updateSupplementDraft(token.value.id, selectedEvidence.value, note.value);
    } else if (selectedEvidence.value.length || note.value.trim()) {
      const id = store.openSupplementToken(project.id, actor, selectedEvidence.value, note.value);
      // 首次建立即记住当前基线；之后基线再变就会失效
      store.armSupplementToken(id);
    }
  });

  function recheck() {
    if (!token.value) return;
    resultMessage.value = '';
    errorMessage.value = '';
    store.armSupplementToken(token.value.id);
  }

  function discard() {
    if (!token.value) return;
    store.abandonSupplementToken(token.value.id);
    finishedTokenId.value = null;
    resultMessage.value = '';
    errorMessage.value = '';
    selectedEvidence.value = [];
    note.value = '';
  }

  function armFailureInjection() {
    store.armFailureInjection();
    errorMessage.value = '已设置：下一次提交将模拟网络失败，凭据会保留以便续办。';
  }

  async function commit() {
    const project = projectRef.value;
    const current = token.value;
    if (!project || !current) return null;
    committing.value = true;
    resultMessage.value = '';
    errorMessage.value = '';
    try {
      // 提交前确保草稿内容已落盘
      store.updateSupplementDraft(current.id, selectedEvidence.value, note.value);
      const outcome = await store.commitSupplementToken(current.id);
      if (outcome.status === 'complete') {
        finishedTokenId.value = current.id;
        const skipped = outcome.skipped.length ? `；跳过 ${outcome.skipped.length} 项已被他人处理的证据` : '';
        resultMessage.value = `凭据 ${current.id} 提交完成：推进 ${outcome.applied.length} 项证据${skipped}。`;
        selectedEvidence.value = [];
        note.value = '';
      } else if (outcome.status === 'pending_check') {
        errorMessage.value = `凭据已失效，停在待核对：${outcome.pendingReason ?? '基线已变动'}。已选证据和说明已保留，核对后续办。`;
      } else if (outcome.error) {
        errorMessage.value = outcome.error;
      } else if (outcome.pendingReason) {
        errorMessage.value = outcome.pendingReason;
      }
      return outcome;
    } finally {
      committing.value = false;
    }
  }

  return {
    token,
    tokenStatus,
    selectedEvidence,
    note,
    pendingReason,
    canRecheck,
    canSubmit,
    selectedItems,
    lastAppliedIds,
    commit,
    recheck,
    discard,
    armFailureInjection,
    baselineChanged,
    committing,
    resultMessage,
    errorMessage
  };
}
