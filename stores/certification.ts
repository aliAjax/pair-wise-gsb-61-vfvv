import { defineStore } from 'pinia';
import { seedProjects } from '~/data/seed';
import type {
  ApprovalProject,
  AuditEntry,
  CommitOutcome,
  EvidenceItem,
  EvidenceManifestEntry,
  ProjectInput,
  ProjectStatus,
  ProjectVersion,
  SupplementAppliedChange,
  SupplementToken
} from '~/types/certification';
import { supplementableStatuses } from '~/types/certification';

const STORAGE_KEY = 'vehicle-type-approval-projects-v2';
const LEGACY_STORAGE_KEY = 'vehicle-type-approval-projects-v1';

/** 提交模拟：网络延迟（毫秒），期间另一标签页可改动基线 */
const COMMIT_LATENCY_MS = 600;

function cloneSeed() {
  return structuredClone(seedProjects);
}

function makeId(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function audit(actor: string, action: string, detail: string, supplementTokenId?: string): AuditEntry {
  return {
    id: makeId('AUD'),
    actor,
    action,
    detail,
    createdAt: nowIso(),
    supplementTokenId
  };
}

/** 证据清单快照：凭据发起时逐项记住状态与版本 */
function buildManifest(project: ApprovalProject): EvidenceManifestEntry[] {
  return project.evidence.map((item) => ({
    evidenceId: item.id,
    name: item.name,
    status: item.status,
    version: item.version,
    softwareVersion: item.softwareVersion
  }));
}

/**
 * 基线指纹：维护版本 + 软件版本 + 证据清单的外部状态。
 * 凭据自己把证据推进到 submitted（带 supplementTokenId）属于凭据内部进度，不计入指纹；
 * 而缺失/被拒/待重交/已接受等状态或文件版本的任何变化（包括另一标签页审阅人操作）
 * 都意味着基线被外部改动，旧凭据应失效。
 */
export function baselineKey(project: ApprovalProject): string {
  const manifest = project.evidence
    .filter((item) => !(item.status === 'submitted' && item.supplementTokenId))
    .map((item) => `${item.id}:${item.status}:${item.version}:${item.softwareVersion}`)
    .sort()
    .join('|');
  return [project.maintenanceVersion, project.softwareVersion, manifest].join('##');
}

function tokenBaselineKey(token: SupplementToken): string {
  // 已由本凭据逐项落账的证据属于凭据内部进度，不参与基线指纹
  const appliedIds = new Set(token.applied.map((change) => change.evidenceId));
  const manifest = token.evidenceManifest
    .filter((item) => !appliedIds.has(item.evidenceId))
    .map((item) => `${item.evidenceId}:${item.status}:${item.version}:${item.softwareVersion}`)
    .sort()
    .join('|');
  return [token.baselineMaintenanceVersion, token.baselineSoftwareVersion, manifest].join('##');
}

function isTokenComplete(projects: ApprovalProject[], projectId: string, tokenId: string) {
  const project = projects.find((item) => item.id === projectId);
  return project?.supplementTokens.some((token) => token.id === tokenId && token.status === 'complete') ?? false;
}

interface StoredState {
  version: 2;
  projects: ApprovalProject[];
  savedAt: string;
}

function readStored(): StoredState | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredState;
      if (parsed.version === 2 && Array.isArray(parsed.projects)) {
        parsed.projects.forEach((project) => {
          project.supplementTokens ??= [];
          project.evidence.forEach((item) => {
            if (!('supplementTokenId' in item)) item.supplementTokenId = undefined;
          });
        });
        return parsed;
      }
    }
    // v1 结构迁移：旧数据直接是项目数组
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      const projects = JSON.parse(legacy) as ApprovalProject[];
      projects.forEach((project) => {
        project.supplementTokens = [];
        project.evidence.forEach((item) => (item.supplementTokenId = undefined));
      });
      const migrated: StoredState = { version: 2, projects, savedAt: nowIso() };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
  } catch {
    return null;
  }
  return null;
}

export const useCertificationStore = defineStore('certification', {
  state: () => ({
    projects: cloneSeed() as ApprovalProject[],
    hydrated: false,
    /** 下一次提交注入一次性失败（演示提交失败后恢复） */
    failNextCommit: false,
    /** 提交进行中的凭据编号（同一标签页防重复点击） */
    committingTokenId: '' as string | null
  }),

  getters: {
    projectById: (state) => (id: string) => state.projects.find((project) => project.id === id),

    agencies: (state) => Array.from(new Set(state.projects.map((project) => project.agency))).sort(),

    /** 项目最近一个未完成凭据（草稿或待核对），用于续办 */
    openTokenForProject: (state) => (projectId: string) => {
      const project = state.projects.find((item) => item.id === projectId);
      return (
        project?.supplementTokens.find(
          (token) => token.status === 'draft' || token.status === 'ready' || token.status === 'pending_check'
        ) ?? null
      );
    },

    /** 只看已完成凭据产生的补件证据；未完成凭据的暂存结果不生效 */
    effectiveEvidence: (state) => (project: ApprovalProject): EvidenceItem[] =>
      project.evidence.filter(
        (item) => !item.supplementTokenId || isTokenComplete(state.projects, project.id, item.supplementTokenId)
      ),

    /** 审计轨迹中对外（导出/覆盖认定）有效的条目：非补件条目 + 已完成凭据条目 */
    effectiveAudit: (state) => (project: ApprovalProject): AuditEntry[] =>
      project.audit.filter(
        (entry) => !entry.supplementTokenId || isTokenComplete(state.projects, project.id, entry.supplementTokenId)
      ),

    tokenIsComplete: (state) => (projectId: string, tokenId: string) =>
      isTokenComplete(state.projects, projectId, tokenId),

    expiringEvidence: (state) =>
      state.projects.flatMap((project) =>
        project.evidence
          .filter((item) => item.expiryDate)
          .map((item) => ({ project, evidence: item }))
          .filter(({ evidence }) => new Date(evidence.expiryDate!) <= new Date('2027-01-31'))
      )
  },

  actions: {
    hydrate() {
      if (this.hydrated) return;
      if (typeof localStorage === 'undefined') return;
      const stored = readStored();
      this.projects = stored ? stored.projects : cloneSeed();
      this.evaluateAllTokens();
      this.hydrated = true;
    },

    initCrossTabSync() {
      if (typeof window === 'undefined') return;
      window.addEventListener('storage', (event) => {
        if (event.key !== STORAGE_KEY || !event.newValue) return;
        try {
          const incoming = JSON.parse(event.newValue) as StoredState;
          if (incoming.version === 2) this.mergeIncoming(incoming);
        } catch {
          // 忽略无法解析的跨标签页写入
        }
      });
    },

    persist() {
      if (typeof localStorage === 'undefined') return;
      // 读—合并—写：以物理存储中其他标签页的最新数据为底，
      // 再叠加本标签页状态，避免整包覆盖丢掉别人刚写入的接受结果/凭据
      const onDisk = readStored();
      if (onDisk) this.mergeStateFrom(onDisk);
      const payload: StoredState = { version: 2, projects: this.projects, savedAt: nowIso() };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    },

    /**
     * 合并另一标签页的写入：项目、证据、审计、版本、凭据逐项按编号合并，
     * 以 updatedAt 较新者为准——不丢掉别人刚接受的结果。
     * revalidate=true 时顺带让基线已变的本标签页凭据失效。
     */
    mergeIncoming(incoming: StoredState, revalidate = true) {
      this.mergeStateFrom(incoming);
      if (revalidate) this.evaluateAllTokens();
    },

    /** 纯状态合并，不改变凭据状态（persist 读—合并—写时使用） */
    mergeStateFrom(incoming: StoredState) {
      incoming.projects.forEach((theirs) => {
        const ours = this.projects.find((item) => item.id === theirs.id);
        if (!ours) {
          this.projects.push(structuredClone(theirs));
          return;
        }
        // 顶层标量
        if (theirs.updatedAt >= ours.updatedAt) {
          ours.maintenanceVersion = theirs.maintenanceVersion;
          ours.softwareVersion = theirs.softwareVersion;
          ours.configuration = theirs.configuration;
          ours.status = theirs.status;
          ours.progress = theirs.progress;
          ours.updatedAt = theirs.updatedAt;
          ours.submittedAt = theirs.submittedAt ?? ours.submittedAt;
        }
        function mergeByStamp<T extends { id: string }>(
          local: T[],
          remote: T[],
          stampOf: (value: T) => string
        ) {
          remote.forEach((remoteItem) => {
            const localItem = local.find((item) => item.id === remoteItem.id);
            if (!localItem) local.push(structuredClone(remoteItem));
            else if (stampOf(remoteItem) >= stampOf(localItem)) Object.assign(localItem, structuredClone(remoteItem));
          });
        }
        mergeByStamp(ours.evidence, theirs.evidence, (item) => item.updatedAt);
        mergeByStamp(ours.versions, theirs.versions, (item) => item.createdAt);
        mergeByStamp(ours.audit, theirs.audit, (item) => item.createdAt);
        // 法规项没有时间戳，以最近一次写入的内容为准
        mergeByStamp(ours.regulations, theirs.regulations, () => incoming.savedAt);
        // 凭据：进度字段（已选/说明/已落账）取较新；但“失效停在待核对”是各标签页的本地决定，
        // 不能用对方的 pending_check 覆盖本方在途（ready/提交中）的凭据，否则会让别人的提交被误拦。
        theirs.supplementTokens.forEach((remoteToken) => {
          const localToken = ours.supplementTokens.find((item) => item.id === remoteToken.id);
          if (!localToken) {
            ours.supplementTokens.push(structuredClone(remoteToken));
            return;
          }
          if (remoteToken.updatedAt >= localToken.updatedAt) {
            localToken.selectedEvidenceIds = structuredClone(remoteToken.selectedEvidenceIds);
            localToken.note = remoteToken.note;
            localToken.applied = structuredClone(remoteToken.applied);
            localToken.lastError = remoteToken.lastError;
            localToken.baselineMaintenanceVersion = remoteToken.baselineMaintenanceVersion;
            localToken.baselineSoftwareVersion = remoteToken.baselineSoftwareVersion;
            localToken.evidenceManifest = structuredClone(remoteToken.evidenceManifest);
            localToken.completedAt = remoteToken.completedAt ?? localToken.completedAt;
          }
          const rank: Record<SupplementToken['status'], number> = {
            complete: 4,
            ready: 3,
            pending_check: 2,
            draft: 1
          };
          // 已完成是全局事实；其余状态取“进度更高者”，待核对由本标签页合并后自行判定
          if (remoteToken.status === 'complete' || rank[remoteToken.status] > rank[localToken.status]) {
            localToken.status = remoteToken.status;
          }
        });
      });
    },

    /** 核对本标签页全部凭据：版本基线不符即停在待核对 */
    evaluateAllTokens(reason = '项目版本基线已被改动，请重新核对维护版本、软件版本与证据清单', persistAfter = false) {
      let changed = false;
      this.projects.forEach((project) => {
        project.supplementTokens.forEach((token) => {
          if (token.status === 'complete') return;
          if (
            token.baselineMaintenanceVersion !== project.maintenanceVersion ||
            token.baselineSoftwareVersion !== project.softwareVersion
          ) {
            token.status = 'pending_check';
            token.pendingReason = reason;
            token.updatedAt = nowIso();
            changed = true;
          }
        });
      });
      if (changed && persistAfter) this.persist();
      return changed;
    },

    /**
     * 本地证据审阅动作（接受/拒绝/重抽）改变证据清单后，让同项目凭据停在待核对。
     * 这是比版本变更更细粒度的失效：凭据记住的证据清单不再是发起时那一份。
     */
    invalidateProjectTokens(projectId: string, reason: string, exceptTokenId?: string) {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project) return;
      const versionChanged = (token: SupplementToken) =>
        token.baselineMaintenanceVersion !== project.maintenanceVersion ||
        token.baselineSoftwareVersion !== project.softwareVersion;
      let changed = false;
      project.supplementTokens.forEach((token) => {
        if (token.id === exceptTokenId || token.status === 'complete') return;
        if (versionChanged(token) || tokenBaselineKey(token) !== baselineKey(project)) {
          token.status = 'pending_check';
          token.pendingReason = reason;
          token.updatedAt = nowIso();
          changed = true;
        }
      });
      if (changed) this.persist();
    },

    createProject(input: ProjectInput) {
      const createdAt = nowIso();
      const project: ApprovalProject = {
        id: `TA-${new Date().getFullYear()}-${String(this.projects.length + 121).padStart(3, '0')}`,
        ...input,
        status: 'draft',
        progress: 18,
        reviewer: '待分派',
        updatedAt: createdAt,
        regulations: [
          {
            id: 'REG-BRAKE',
            code: 'GB 21670',
            title: '乘用车制动系统技术要求',
            category: '安全',
            required: true,
            status: 'missing',
            coverage: 0,
            issues: ['尚未关联测试报告']
          },
          {
            id: 'REG-EMC',
            code: 'GB 34660',
            title: '道路车辆电磁兼容性要求',
            category: '环保',
            required: true,
            status: 'missing',
            coverage: 0,
            issues: ['尚未关联测试报告']
          }
        ],
        evidence: [],
        versions: [
          {
            id: makeId('VER'),
            label: `${input.maintenanceVersion} / ${input.softwareVersion}`,
            author: input.applicant,
            createdAt,
            summary: '创建认证证据包草稿。',
            changes: ['录入车型、配置和维护版本', '建立基础法规项'],
            impactedConfigurations: [input.configuration]
          }
        ],
        audit: [audit(input.applicant, '建立项目', '创建型式认证证据包草稿。')],
        supplementTokens: []
      };
      this.projects.unshift(project);
      this.persist();
      return project.id;
    },

    updateProject(id: string, input: ProjectInput, reason: string) {
      const project = this.projects.find((item) => item.id === id);
      if (!project) return false;
      const previous = {
        maintenanceVersion: project.maintenanceVersion,
        softwareVersion: project.softwareVersion,
        configuration: project.configuration
      };
      Object.assign(project, input, { updatedAt: nowIso() });

      const changed: string[] = [];
      if (previous.maintenanceVersion !== input.maintenanceVersion) changed.push('维护版本');
      if (previous.softwareVersion !== input.softwareVersion) changed.push('软件版本');
      if (previous.configuration !== input.configuration) changed.push('配置范围');

      if (changed.length) {
        const version: ProjectVersion = {
          id: makeId('VER'),
          label: `${input.maintenanceVersion} / ${input.softwareVersion}`,
          author: project.applicant,
          createdAt: nowIso(),
          summary: `更新${changed.join('、')}：${reason}`,
          changes: changed,
          impactedConfigurations: [input.configuration]
        };
        project.versions.unshift(version);
        project.audit.unshift(
          audit(project.applicant, '更新项目版本', `${changed.join('、')}；影响配置：${input.configuration}`)
        );
        // 基线改动：同项目所有未完成补件凭据立即失效
        this.invalidateProjectTokens(
          id,
          `项目基线已变更（${changed.join('、')}），原补件凭据失效，需核对后续办`,
        );
      } else {
        project.audit.unshift(audit(project.applicant, '更新项目资料', reason));
      }
      this.persist();
      return true;
    },

    transition(id: string, status: ProjectStatus, actor: string, reason: string) {
      const project = this.projects.find((item) => item.id === id);
      if (!project) return false;
      project.status = status;
      if (status === 'submitted') project.submittedAt = nowIso().slice(0, 10);
      if (status === 'approved') project.progress = 100;
      if (status === 'supplement_required') project.progress = Math.min(project.progress, 82);
      project.updatedAt = nowIso();
      project.audit.unshift(audit(actor, '审批状态流转', `${status}；${reason}`));
      this.persist();
      return true;
    },

    updateEvidence(projectId: string, evidenceId: string, status: EvidenceItem['status'], note: string) {
      const project = this.projects.find((item) => item.id === projectId);
      const evidence = project?.evidence.find((item) => item.id === evidenceId);
      if (!project || !evidence) return false;
      evidence.status = status;
      evidence.note = note || evidence.note;
      evidence.updatedAt = nowIso();
      evidence.supplementTokenId = undefined;
      project.updatedAt = evidence.updatedAt;
      project.audit.unshift(audit(project.reviewer, '更新证据状态', `${evidence.name}：${status}`));
      // 审阅人接受/拒绝也改变证据清单，旧凭据立即失效
      this.invalidateProjectTokens(projectId, `证据 ${evidence.name} 状态已更新，原补件凭据失效，需核对后续办`);
      this.persist();
      return true;
    },

    /**
     * 建立或续办补件凭据（draft）。只记住已选证据和说明，尚未记住基线。
     * 已存在未完成凭据时直接续写，不另开新凭据。
     */
    openSupplementToken(projectId: string, actor: string, selectedEvidenceIds: string[], note: string) {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project) throw new Error('项目不存在');
      let token = project.supplementTokens.find(
        (item) => item.status === 'draft' || item.status === 'ready' || item.status === 'pending_check'
      );
      const stamp = nowIso();
      if (!token) {
        token = {
          id: makeId('SUP'),
          projectId,
          actor,
          status: 'draft',
          createdAt: stamp,
          updatedAt: stamp,
          baselineMaintenanceVersion: project.maintenanceVersion,
          baselineSoftwareVersion: project.softwareVersion,
          evidenceManifest: buildManifest(project),
          pendingReason: '',
          selectedEvidenceIds: [],
          note: '',
          lastError: '',
          applied: []
        };
        project.supplementTokens.unshift(token);
      }
      token.selectedEvidenceIds = [...selectedEvidenceIds];
      token.note = note;
      token.updatedAt = stamp;
      this.persist();
      return token.id;
    },

    updateSupplementDraft(tokenId: string, selectedEvidenceIds: string[], note: string) {
      const token = this.projects.flatMap((project) => project.supplementTokens).find((item) => item.id === tokenId);
      if (!token || token.status === 'complete') return false;
      token.selectedEvidenceIds = [...selectedEvidenceIds];
      token.note = note;
      token.updatedAt = nowIso();
      this.persist();
      return true;
    },

    /**
     * 记住维护版本、软件版本和证据清单：draft/pending_check → ready。
     * 待核对凭据核对的是“当前”基线——记住的是续办时刻的新基线。
     */
    armSupplementToken(tokenId: string) {
      const project = this.projects.find((item) => item.supplementTokens.some((token) => token.id === tokenId));
      const token = project?.supplementTokens.find((item) => item.id === tokenId);
      if (!project || !token || token.status === 'complete') return false;
      token.baselineMaintenanceVersion = project.maintenanceVersion;
      token.baselineSoftwareVersion = project.softwareVersion;
      token.evidenceManifest = buildManifest(project);
      token.status = 'ready';
      token.pendingReason = '';
      token.lastError = '';
      token.updatedAt = nowIso();
      this.persist();
      return true;
    },

    abandonSupplementToken(tokenId: string) {
      const project = this.projects.find((item) => item.supplementTokens.some((token) => token.id === tokenId));
      const token = project?.supplementTokens.find((item) => item.id === tokenId);
      if (!project || !token || token.status === 'complete') return false;
      project.supplementTokens = project.supplementTokens.filter((item) => item.id !== tokenId);
      this.persist();
      return true;
    },

    armFailureInjection() {
      this.failNextCommit = true;
    },

    /**
     * 提交补件凭据。
     * - complete：幂等空操作，重复提交不能再次推进证据
     * - pending_check：基线已变，拒绝提交并停在待核对（已选证据和说明保留）
     * - draft：尚未记住基线，需先核对
     * - ready：以持久化中的最新数据为准逐项 CAS 推进；失败后凭 applied 续办
     */
    async commitSupplementToken(tokenId: string): Promise<CommitOutcome> {
      const findToken = () => {
        const project = this.projects.find((item) => item.supplementTokens.some((t) => t.id === tokenId));
        const token = project?.supplementTokens.find((item) => item.id === tokenId);
        return { project, token };
      };

      let initial = findToken();
      if (!initial.project || !initial.token) throw new Error('补件凭据不存在');

      // 幂等：已完成凭据重复提交不再推进任何证据
      if (initial.token.status === 'complete') {
        return { status: 'complete', applied: initial.token.applied, skipped: [] };
      }
      if (initial.token.status === 'pending_check') {
        return {
          status: 'pending_check',
          applied: initial.token.applied,
          skipped: [],
          pendingReason: initial.token.pendingReason
        };
      }
      if (initial.token.status === 'draft') {
        return {
          status: 'draft',
          applied: initial.token.applied,
          skipped: [],
          pendingReason: '请先核对并记住当前维护版本、软件版本与证据清单'
        };
      }
      if (this.committingTokenId && this.committingTokenId !== tokenId) {
        return {
          status: initial.token.status,
          applied: initial.token.applied,
          skipped: [],
          error: '另一个补件凭据正在提交，请等待其完成'
        };
      }

      this.committingTokenId = tokenId;
      try {
        // 模拟网络往返：这期间另一个标签页可能改动基线
        await new Promise((resolve) => setTimeout(resolve, COMMIT_LATENCY_MS));

        // 以持久化最新数据为准（合并其他标签页刚写入并被 storage 事件合并的结果）
        const stored = readStored();
        if (stored) this.mergeIncoming(stored);

        const current = findToken();
        const project = current.project!;
        const token = current.token!;

        if (token.status === 'complete') {
          return { status: 'complete', applied: token.applied, skipped: [] };
        }
        if (token.status === 'pending_check') {
          return {
            status: 'pending_check',
            applied: token.applied,
            skipped: [],
            pendingReason: token.pendingReason
          };
        }

        // 提交瞬间核对版本基线：维护/软件版本被改动则凭据失效停在待核对。
        // 证据清单层面的并发变化（如别人刚接受某一项）不整体作废凭据，
        // 交给下方逐项 CAS：跳过已处理项，继续推进其余项，不覆盖他人结果。
        if (
          token.baselineMaintenanceVersion !== project.maintenanceVersion ||
          token.baselineSoftwareVersion !== project.softwareVersion
        ) {
          token.status = 'pending_check';
          token.pendingReason = '提交时发现维护版本/软件版本基线已被改动，凭据已失效，请核对后重新续办';
          token.updatedAt = nowIso();
          this.persist();
          return {
            status: 'pending_check',
            applied: token.applied,
            skipped: [],
            pendingReason: token.pendingReason
          };
        }

        // 逐项 CAS：只推进仍处于可补件状态、且尚未由本凭据推进过的证据
        const alreadyAppliedIds = new Set(token.applied.map((change) => change.evidenceId));
        const applied: SupplementAppliedChange[] = [...token.applied];
        const skipped: EvidenceManifestEntry[] = [];

        for (const evidenceId of token.selectedEvidenceIds) {
          if (alreadyAppliedIds.has(evidenceId)) continue; // 失败后续办：跳过已落账项
          const evidence = project.evidence.find((item) => item.id === evidenceId);
          if (!evidence) {
            skipped.push({
              evidenceId,
              name: token.evidenceManifest.find((entry) => entry.evidenceId === evidenceId)?.name ?? evidenceId,
              status: 'missing',
              version: '',
              softwareVersion: ''
            });
            continue;
          }
          // 不覆盖别人刚接受/已提交/已处理的结果
          if (!supplementableStatuses.includes(evidence.status)) {
            const manifestEntry = token.evidenceManifest.find((entry) => entry.evidenceId === evidenceId);
            skipped.push({
              evidenceId,
              name: evidence.name,
              status: evidence.status,
              version: evidence.version,
              softwareVersion: evidence.softwareVersion
            });
            if (manifestEntry) {
              manifestEntry.status = evidence.status;
              manifestEntry.version = evidence.version;
              manifestEntry.softwareVersion = evidence.softwareVersion;
            }
            continue;
          }
          const change: SupplementAppliedChange = {
            evidenceId,
            name: evidence.name,
            fromStatus: evidence.status,
            toStatus: 'submitted',
            softwareVersion: project.softwareVersion
          };
          evidence.status = 'submitted';
          evidence.softwareVersion = project.softwareVersion;
          evidence.note = token.note;
          evidence.updatedAt = nowIso();
          evidence.supplementTokenId = token.id;
          applied.push(change);
          alreadyAppliedIds.add(evidenceId);
        }

        // 失败注入：部分证据项已逐项落账（模拟提交中途网络失败），
        // 凭据保持 ready 并持久化已落账进度；重试时从下一项继续，不重复推进
        if (this.failNextCommit) {
          this.failNextCommit = false;
          token.applied = applied;
          token.lastError = '提交失败：模拟网络中断，凭据与已落账项已保留，请重试续办';
          token.updatedAt = nowIso();
          if (applied.length) {
            project.progress = Math.min(95, project.progress + applied.length * 4);
            project.updatedAt = nowIso();
          }
          this.persist();
          return { status: token.status, applied, skipped, error: token.lastError };
        }

        token.applied = applied;
        token.status = 'complete';
        token.completedAt = nowIso();
        token.updatedAt = token.completedAt;
        token.lastError = '';

        if (applied.length) {
          project.progress = Math.min(95, project.progress + applied.length * 4);
          project.updatedAt = token.completedAt;
          const skippedNote = skipped.length
            ? `；${skipped.length} 项已被他人处理或不再可补件，已跳过且未覆盖`
            : '';
          project.audit.unshift(
            audit(
              token.actor,
              '批量补件',
              `凭据 ${token.id}：${applied.length} 项证据更新至 ${project.softwareVersion} 并重新提交。${token.note}${skippedNote}`,
              token.id
            )
          );
        }
        this.persist();
        // 本凭据提交导致证据清单变化，同项目其他未完成凭据立即失效
        this.invalidateProjectTokens(
          project.id,
          `凭据 ${token.id} 已完成补件提交，基线证据清单已更新，其他凭据需重新核对`,
          token.id
        );
        return { status: 'complete', applied, skipped };
      } finally {
        if (this.committingTokenId === tokenId) this.committingTokenId = null;
      }
    },

    reset() {
      this.projects = cloneSeed();
      this.persist();
    }
  }
});
