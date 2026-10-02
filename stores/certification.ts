import { defineStore } from 'pinia';
import { seedProjects } from '~/data/seed';
import {
  installCrossTabSync,
  markStaleForProject,
  onTokensChanged,
  readProjects,
  readTokens
} from '~/services/supplement-ledger';
import type {
  ApprovalProject,
  AuditEntry,
  EvidenceItem,
  ProjectInput,
  ProjectStatus,
  ProjectVersion,
  SupplementToken
} from '~/types/certification';

const STORAGE_KEY = 'vehicle-type-approval-projects-v1';

function cloneSeed() {
  return structuredClone(seedProjects);
}

function makeId(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
}

function audit(actor: string, action: string, detail: string): AuditEntry {
  return {
    id: makeId('AUD'),
    actor,
    action,
    detail,
    createdAt: new Date().toISOString()
  };
}

export const useCertificationStore = defineStore('certification', {
  state: () => ({
    projects: cloneSeed(),
    tokens: [] as SupplementToken[],
    hydrated: false
  }),

  getters: {
    projectById: (state) => (id: string) => state.projects.find((project) => project.id === id),
    agencies: (state) => Array.from(new Set(state.projects.map((project) => project.agency))).sort(),
    expiringEvidence: (state) =>
      state.projects.flatMap((project) =>
        project.evidence
          .filter((item) => item.expiryDate)
          .map((item) => ({ project, evidence: item }))
          .filter(({ evidence }) => new Date(evidence.expiryDate!) <= new Date('2027-01-31'))
      ),

    /** 某项目已完成补件凭据的 ID 集合——法规覆盖与审计导出只认这些凭据。 */
    completedTokenIds: (state) => (projectId: string) =>
      new Set(
        state.tokens
          .filter((token) => token.projectId === projectId && token.status === 'completed')
          .map((token) => token.id)
      )
  },
  actions: {
    hydrate() {
      if (this.hydrated || typeof localStorage === 'undefined') return;
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) this.projects = JSON.parse(raw) as ApprovalProject[];
      } catch {
        this.projects = cloneSeed();
      }
      this.tokens = readTokens();
      this.hydrated = true;
      // 凭据（含本标签页）发生任何变化时同步到 store，驱动 getter 和界面。
      onTokensChanged(() => {
        this.tokens = readTokens();
      });
      // 别的标签页提交补件或改动基线后，本标签页实时重载项目数据并核对凭据。
      installCrossTabSync(() => {
        this.projects = readProjects();
        this.tokens = readTokens();
      });
    },

    persist() {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.projects));
      }
    },

    /** 补件凭据提交（在 localStorage 中原子写入）后，从存储重新读取项目数据。 */
    reloadFromStorage() {
      if (typeof localStorage !== 'undefined') {
        this.projects = readProjects();
        this.tokens = readTokens();
      }
    },

    createProject(input: ProjectInput) {
      const createdAt = new Date().toISOString();
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
        audit: [audit(input.applicant, '建立项目', '创建型式认证证据包草稿。')]
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
      Object.assign(project, input, { updatedAt: new Date().toISOString() });

      const changed: string[] = [];
      if (previous.maintenanceVersion !== input.maintenanceVersion) changed.push('维护版本');
      if (previous.softwareVersion !== input.softwareVersion) changed.push('软件版本');
      if (previous.configuration !== input.configuration) changed.push('配置范围');

      if (changed.length) {
        const version: ProjectVersion = {
          id: makeId('VER'),
          label: `${input.maintenanceVersion} / ${input.softwareVersion}`,
          author: project.applicant,
          createdAt: new Date().toISOString(),
          summary: `更新${changed.join('、')}：${reason}`,
          changes: changed,
          impactedConfigurations: [input.configuration]
        };
        project.versions.unshift(version);
        project.audit.unshift(
          audit(project.applicant, '更新项目版本', `${changed.join('、')}；影响配置：${input.configuration}`)
        );
        this.persist();
        // 基线改动后，旧补件凭据立即失效并停在待核对（选择与说明保留）。
        if (previous.maintenanceVersion !== input.maintenanceVersion || previous.softwareVersion !== input.softwareVersion) {
          markStaleForProject(id, {
            maintenanceVersion: input.maintenanceVersion,
            softwareVersion: input.softwareVersion
          });
        }
      } else {
        project.audit.unshift(audit(project.applicant, '更新项目资料', reason));
        this.persist();
      }
      return true;
    },

    transition(id: string, status: ProjectStatus, actor: string, reason: string) {
      const project = this.projects.find((item) => item.id === id);
      if (!project) return false;
      project.status = status;
      if (status === 'submitted') project.submittedAt = new Date().toISOString().slice(0, 10);
      if (status === 'approved') project.progress = 100;
      if (status === 'supplement_required') project.progress = Math.min(project.progress, 82);
      project.updatedAt = new Date().toISOString();
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
      evidence.updatedAt = new Date().toISOString();
      project.updatedAt = evidence.updatedAt;
      project.audit.unshift(audit(project.reviewer, '更新证据状态', `${evidence.name}：${status}`));
      this.persist();
      return true;
    },

    reset() {
      this.projects = cloneSeed();
      this.persist();
    }
  }
});
