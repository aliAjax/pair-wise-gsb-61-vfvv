export const projectStatuses = [
  'draft',
  'submitted',
  'under_review',
  'supplement_required',
  'approved',
  'rejected'
] as const;

export const evidenceStatuses = ['missing', 'submitted', 'accepted', 'rejected', 'resubmit'] as const;

export type ProjectStatus = (typeof projectStatuses)[number];
export type EvidenceStatus = (typeof evidenceStatuses)[number];

export const supplementTokenStatuses = [
  'draft',
  'stale',
  'submitting',
  'failed',
  'completed'
] as const;

export type SupplementTokenStatus = (typeof supplementTokenStatuses)[number];

/** 凭据创建时固化的项目基线快照，用作乐观并发控制的版本号。 */
export interface BaselineSnapshot {
  maintenanceVersion: string;
  softwareVersion: string;
}

/** 凭据记住的证据清单条目（只固化续办所需的最小信息）。 */
export interface EvidenceManifestEntry {
  id: string;
  regulationId: string;
  name: string;
  status: EvidenceStatus;
  softwareVersion: string;
}

/**
 * 可续办的补件提交凭据：
 * 保存基线、证据清单、已选证据与说明；基线变更后进入 stale，核对后续办。
 */
export interface SupplementToken {
  id: string;
  projectId: string;
  status: SupplementTokenStatus;
  createdAt: string;
  updatedAt: string;
  /** 凭据创建时的基线，提交时必须与当前项目基线一致。 */
  baseline: BaselineSnapshot;
  /** 凭据记住的证据清单快照。 */
  manifest: EvidenceManifestEntry[];
  selectedEvidenceIds: string[];
  note: string;
  /** 续办链：上一张已完成凭据；失败重试用同一凭据，核对续办时携带。 */
  previousCompletedTokenId?: string;
  /** 提交失败后的错误信息（stale/failed 时使用）。 */
  lastError?: string;
  /** 完成时实际推进的证据。 */
  appliedEvidenceIds?: string[];
  /** 完成时因他人已接受等原因跳过的证据。 */
  skippedEvidenceIds?: string[];
  completedAt?: string;
}

export interface RegulationItem {
  id: string;
  code: string;
  title: string;
  category: '安全' | '环保' | '能耗' | '软件' | '部件';
  required: boolean;
  status: 'complete' | 'missing' | 'conflict';
  coverage: number;
  issues: string[];
}

export interface EvidenceItem {
  id: string;
  projectId: string;
  regulationId: string;
  name: string;
  type: 'test_report' | 'part_list' | 'software_report' | 'exemption' | 'certificate';
  version: string;
  softwareVersion: string;
  configurations: string[];
  status: EvidenceStatus;
  expiryDate?: string;
  note: string;
  updatedAt: string;
  /** 推进该证据状态的已完成补件凭据；审阅人直接接受的证据可为空。 */
  submissionTokenId?: string;
}

export interface ProjectVersion {
  id: string;
  label: string;
  author: string;
  createdAt: string;
  summary: string;
  changes: string[];
  impactedConfigurations: string[];
}

export interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  detail: string;
  createdAt: string;
  /** 该条审计是否由已完成的补件凭据产生（补件相关记录才参与凭据导出）。 */
  supplementTokenId?: string;
}

export interface ApprovalProject {
  id: string;
  name: string;
  modelCode: string;
  vehicleType: string;
  configuration: string;
  maintenanceVersion: string;
  softwareVersion: string;
  status: ProjectStatus;
  progress: number;
  applicant: string;
  reviewer: string;
  agency: string;
  submittedAt?: string;
  updatedAt: string;
  certificateExpiry: string;
  regulations: RegulationItem[];
  evidence: EvidenceItem[];
  versions: ProjectVersion[];
  audit: AuditEntry[];
}

export interface ProjectInput {
  name: string;
  modelCode: string;
  vehicleType: string;
  configuration: string;
  maintenanceVersion: string;
  softwareVersion: string;
  applicant: string;
  agency: string;
  certificateExpiry: string;
}

export interface ProjectFilters {
  query: string;
  status: ProjectStatus | 'all';
  agency: string | 'all';
  risk: 'all' | 'expiring' | 'missing' | 'version_conflict';
}
