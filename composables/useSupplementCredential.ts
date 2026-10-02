import { computed, ref, watch, type Ref } from 'vue';
import { certificationApi } from '~/services/certification-api';
import {
  onTokensChanged,
  readTokens,
  sameBaseline
} from '~/services/supplement-ledger';
import { useCertificationStore } from '~/stores/certification';
import type { ApprovalProject, EvidenceItem, SupplementToken } from '~/types/certification';

export type SupplementPanelMessage =
  | { tone: 'success' | 'error' | 'warning'; text: string }
  | null;

const submitableStatuses: EvidenceItem['status'][] = ['missing', 'rejected', 'resubmit'];

export function useSupplementCredential(project: Ref<ApprovalProject | undefined>, actor: string) {
  const store = useCertificationStore();
  const token = ref<SupplementToken | null>(null);
  const history = ref<SupplementToken[]>([]);
  const submitting = ref(false);
  const busy = ref(false);
  const message = ref<SupplementPanelMessage>(null);

  // 表单状态是凭据草稿的镜像；失效时不清空，核对后原样带回。
  const selectedEvidenceIds = ref<string[]>([]);
  const note = ref('');
  const simulateFailure = ref(false);

  function syncFromLedger() {
    if (!project.value) return;
    const all = readTokens().filter((item) => item.projectId === project.value!.id);
    all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    history.value = all;
    const active = all.find((item) => item.status !== 'completed') ?? null;
    token.value = active;
    if (active) {
      selectedEvidenceIds.value = [...active.selectedEvidenceIds];
      note.value = active.note;
    }
  }

  let stopListen: (() => void) | undefined;
  onMounted(() => {
    syncFromLedger();
    // 凭据变化（提交完成等）后项目数据也已原子写入，顺带刷新 store。
    stopListen = onTokensChanged(() => {
      store.reloadFromStorage();
      syncFromLedger();
    });
    window.addEventListener('storage', onStorage);
  });
  onBeforeUnmount(() => {
    stopListen?.();
    window.removeEventListener('storage', onStorage);
  });

  function onStorage() {
    syncFromLedger();
  }

  watch(
    () => project.value?.id,
    () => {
      token.value = null;
      selectedEvidenceIds.value = [];
      note.value = '';
      message.value = null;
      syncFromLedger();
    }
  );

  const pendingEvidence = computed(
    () =>
      project.value?.evidence.filter((item) => submitableStatuses.includes(item.status)) ?? []
  );

  const baselineMatches = computed(
    () => Boolean(token.value && project.value && sameBaseline(token.value.baseline, {
      maintenanceVersion: project.value.maintenanceVersion,
      softwareVersion: project.value.softwareVersion
    }))
  );

  const isStale = computed(() => token.value?.status === 'stale' || Boolean(token.value && !baselineMatches.value && token.value.status !== 'completed'));

  const isFailed = computed(() => token.value?.status === 'failed');
  const lastCompleted = computed(() => history.value.find((item) => item.status === 'completed') ?? null);

  /** 凭据创建后清单发生的变化（证据被他人接受、状态流转、版本更新）。 */
  const manifestDiffs = computed(() => {
    if (!token.value) return [] as { id: string; text: string }[];
    const current = new Map(project.value?.evidence.map((item) => [item.id, item]) ?? []);
    const diffs: { id: string; text: string }[] = [];
    for (const entry of token.value.manifest) {
      const live = current.get(entry.id);
      if (!live) {
        diffs.push({ id: entry.id, text: `${entry.name} 已从证据清单移除` });
      } else if (live.status !== entry.status) {
        diffs.push({ id: entry.id, text: `${entry.name} 状态由「${entry.status}」变为「${live.status}」` });
      } else if (live.softwareVersion !== entry.softwareVersion) {
        diffs.push({ id: entry.id, text: `${entry.name} 软件版本由 ${entry.softwareVersion} 变为 ${live.softwareVersion}` });
      }
    }
    return diffs;
  });

  /** 已选项中已无法再由本凭据推进的证据（他人已接受 / 已被提交）。 */
  const blockedSelections = computed(() => {
    if (!project.value) return [] as EvidenceItem[];
    return project.value.evidence.filter(
      (item) =>
        selectedEvidenceIds.value.includes(item.id) &&
        (item.status === 'accepted' ||
          (item.status === 'submitted' && item.submissionTokenId !== token.value?.id))
    );
  });

  const actionableCount = computed(
    () =>
      pendingEvidence.value.filter(
        (item) => item.status !== 'accepted' && !(item.status === 'submitted' && item.submissionTokenId)
      ).length
  );

  /* 自动保存（去抖）；已完成/待核对时不写入。 */
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  watch([selectedEvidenceIds, note], () => {
    if (!token.value || token.value.status === 'completed' || token.value.status === 'stale') return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await certificationApi.saveSupplementDraft(project.value!.id, token.value!.id, {
          selectedEvidenceIds: selectedEvidenceIds.value,
          note: note.value
        });
      } catch {
        // 自动保存失败不打断录入，下次提交仍以前端状态为准并即时返回错误。
      }
    }, 350);
  }, { deep: true });

  async function start() {
    if (!project.value) return;
    message.value = null;
    busy.value = true;
    try {
      const created = await certificationApi.createSupplementToken(project.value.id);
      token.value = created;
      selectedEvidenceIds.value = [...created.selectedEvidenceIds];
      note.value = created.note;
      syncFromLedger();
      message.value = {
        tone: 'success',
        text: created.previousCompletedTokenId
          ? `已从最后一个完整凭据 ${created.previousCompletedTokenId} 续办，新凭据 ${created.id} 已记住当前基线与证据清单。`
          : `凭据 ${created.id} 已创建，记住了维护版本、软件版本和证据清单；勾选与说明会自动保存。`
      };
    } catch (error) {
      message.value = { tone: 'error', text: errorText(error, '创建凭据失败') };
    } finally {
      busy.value = false;
    }
  }

  /** 待核对：以新基线和最新清单开续办凭据，已选证据和说明继续保留。 */
  async function rebase() {
    if (!project.value || !token.value) return;
    message.value = null;
    busy.value = true;
    try {
      const next = await certificationApi.rebaseSupplementToken(project.value.id, token.value.id);
      message.value = {
        tone: 'warning',
        text: `已按新基线 ${next.baseline.maintenanceVersion} / SW ${next.baseline.softwareVersion} 核对并续办为凭据 ${next.id}，请确认勾选项后重新提交。`
      };
      syncFromLedger();
    } catch (error) {
      message.value = { tone: 'error', text: errorText(error, '核对续办失败') };
    } finally {
      busy.value = false;
    }
  }

  async function submit() {
    if (!project.value || !token.value) return;
    message.value = null;
    if (!selectedEvidenceIds.value.length) {
      message.value = { tone: 'error', text: '请至少勾选一项待补件证据。' };
      return;
    }
    if (note.value.trim().length < 6) {
      message.value = { tone: 'error', text: '补件说明至少 6 个字符。' };
      return;
    }
    if (blockedSelections.value.length) {
      message.value = {
        tone: 'warning',
        text: `勾选项中 ${blockedSelections.value.map((item) => item.name).join('、')} 已被他人接受或提交，将自动跳过，不覆盖其结果。`
      };
    }
    submitting.value = true;
    try {
      // 先确保最新草稿落盘，再提交凭据（凭据是幂等键）。
      await certificationApi.saveSupplementDraft(project.value.id, token.value.id, {
        selectedEvidenceIds: selectedEvidenceIds.value,
        note: note.value
      });
      const result = await certificationApi.submitSupplementToken(project.value.id, token.value.id, {
        actor,
        simulateFailure: simulateFailure.value
      });
      simulateFailure.value = false;
      syncFromLedger();
      message.value = {
        tone: result.skipped.length ? 'warning' : 'success',
        text: `凭据 ${result.token.id} 已完成：推进 ${result.applied.length} 项证据${
          result.skipped.length
            ? `；跳过 ${result.skipped.length} 项他人已接受/已提交证据（${result.skipped
                .map((item) => item.name)
                .join('、')}）`
            : ''
        }。重复提交该凭据不会再次推进证据。`
      };
    } catch (error) {
      const data = (error as { data?: { code?: string; message?: string } })?.data;
      syncFromLedger();
      if (data?.code === 'stale_baseline' || token.value?.status === 'stale') {
        message.value = {
          tone: 'warning',
          text: '另一个标签页改动了版本基线，旧凭据已停在待核对；已选证据和说明均保留，核对后即可续办。'
        };
      } else {
        message.value = {
          tone: 'error',
          text: errorText(error, '提交失败：凭据与已填内容已保留，可直接重试，从最后一个完整凭据接着处理。')
        };
      }
    } finally {
      submitting.value = false;
    }
  }

  return {
    token,
    history,
    pendingEvidence,
    selectedEvidenceIds,
    note,
    simulateFailure,
    submitting,
    busy,
    message,
    baselineMatches,
    isStale,
    isFailed,
    lastCompleted,
    manifestDiffs,
    blockedSelections,
    actionableCount,
    start,
    rebase,
    submit
  };
}

function errorText(error: unknown, fallback: string) {
  const data = (error as { data?: { message?: string } })?.data;
  return data?.message ?? (error instanceof Error ? error.message : fallback);
}
