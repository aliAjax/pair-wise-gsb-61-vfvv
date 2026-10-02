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

/**
 * 补件提交凭据状态：
 * - draft：已记住已选证据与说明，但尚未记住基线
 * - ready：已记住维护版本、软件版本和证据清单，可以提交
 * - pending_check：基线已被改动（含其他标签页），凭据失效，停在待核对，已选证据与说明保留
 * - complete：提交成功并已完成逐项推进；同名凭据重复提交为幂等空操作
 */
export const supplementTokenStatuses = ['draft', 'ready', 'pending_check', 'complete'] as const;
export type SupplementTokenStatus = (typeof supplementTokenStatuses)[number];

/** 可纳入补件范围的证据状态 */
export const supplementableStatuses: EvidenceStatus[] = ['missing', 'rejected', 'resubmit'];

/** 凭据记住的单项证据快照 */
export interface EvidenceManifestEntry {
  evidenceId: string;
  name: string;
  status: EvidenceStatus;
  version: string;
  softwareVersion: string;
}

/** 提交成功后逐项落账的记录 */
export interface SupplementAppliedChange {
  evidenceId: string;
  name: string;
  fromStatus: EvidenceStatus;
  toStatus: EvidenceStatus;
  softwareVersion: string;
}

/** 凭据提交结果 */
export interface CommitOutcome {
  status: SupplementTokenStatus;
  applied: SupplementAppliedChange[];
  skipped: EvidenceManifestEntry[];
  pendingReason?: string;
  error?: string;
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
  /** 最近一次由哪个已完成凭据推进；未完成凭据的结果不计入覆盖与导出 */
  supplementTokenId?: string;
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
  /** 若由补件凭据产生，记录凭据编号；法规覆盖和审计导出只认已完成凭据 */
  supplementTokenId?: string;
}

/**
 * 可续办的补件提交凭据。
 * 记住发起时的维护版本、软件版本和证据清单（基线指纹），
 * 基线一旦被改动即转入 pending_check；提交结果逐项落账以支持续办与幂等。
 */
export interface SupplementToken {
  id: string;
  projectId: string;
  actor: string;
  status: SupplementTokenStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  /** 记住的维护版本 */
  baselineMaintenanceVersion: string;
  /** 记住的软件版本 */
  baselineSoftwareVersion: string;
  /** 记住的证据清单指纹 */
  evidenceManifest: EvidenceManifestEntry[];
  /** 待核对原因（基线改动来源说明） */
  pendingReason: string;
  /** 已选证据，凭据失效/失败后继续保留 */
  selectedEvidenceIds: string[];
  /** 补件说明，凭据失效/失败后继续保留 */
  note: string;
  /** 最近一次提交失败信息；恢复后续办，不回滚已落账部分 */
  lastError: string;
  /** 已完成的逐项推进结果 */
  applied: SupplementAppliedChange[];
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
  /** 补件提交凭据（含草稿、待核对、已完成），随项目持久化 */
  supplementTokens: SupplementToken[];
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
