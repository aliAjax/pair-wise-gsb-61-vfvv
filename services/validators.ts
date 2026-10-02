import type { ApprovalProject, ProjectInput } from '~/types/certification';

export function validateProjectInput(input: ProjectInput) {
  const errors: Partial<Record<keyof ProjectInput, string>> = {};

  if (input.name.trim().length < 3) errors.name = '项目名称至少 3 个字符';
  if (!/^[A-Za-z0-9-]{3,}$/.test(input.modelCode.trim())) errors.modelCode = '车型代码只能包含字母、数字和连字符';
  if (!input.vehicleType.trim()) errors.vehicleType = '请选择车辆类别';
  if (input.configuration.trim().length < 2) errors.configuration = '请填写配置名称';
  if (!/^MY\d{2}\.\d+$/.test(input.maintenanceVersion.trim())) errors.maintenanceVersion = '维护版本格式应类似 MY27.1';
  if (!/^\d+\.\d+\.\d+$/.test(input.softwareVersion.trim())) errors.softwareVersion = '软件版本格式应类似 8.4.1';
  if (input.applicant.trim().length < 2) errors.applicant = '请填写申请主体';
  if (input.agency.trim().length < 2) errors.agency = '请选择认证机构';
  if (!input.certificateExpiry) errors.certificateExpiry = '请选择证书有效期';

  return errors;
}

/**
 * 证据是否被法规覆盖/审计认可：
 * 审阅人直接接受（accepted）的证据始终有效；
 * 补件提交上来的证据只认挂在「已完成凭据」上的结果。
 */
export function isCredentialEvidence(
  item: { status: string; submissionTokenId?: string },
  completedTokenIds: Set<string>
) {
  if (item.status === 'accepted') return true;
  return Boolean(item.submissionTokenId && completedTokenIds.has(item.submissionTokenId));
}

/** 只保留被已完成凭据认可的证据。 */
export function credentialEvidence(project: ApprovalProject, completedTokenIds: Set<string>) {
  return project.evidence.filter((item) => isCredentialEvidence(item, completedTokenIds));
}

export function validateSubmission(project: ApprovalProject) {
  const issues: string[] = [];
  const requiredRegulations = project.regulations.filter((item) => item.required);
  const missingEvidence = project.evidence.filter((item) =>
    ['missing', 'rejected', 'resubmit'].includes(item.status)
  );
  const versionMismatch = project.evidence.filter(
    (item) => item.softwareVersion !== project.softwareVersion
  );
  const coverageIssue = requiredRegulations.find((item) => item.status !== 'complete');
  const expiring = new Date(project.certificateExpiry) <= new Date('2026-12-31');

  if (missingEvidence.length) issues.push(`${missingEvidence.length} 项证据缺失、被拒或待补件`);
  if (versionMismatch.length) issues.push(`${versionMismatch.length} 项证据软件版本与项目基线不一致`);
  if (coverageIssue) issues.push(`法规项 ${coverageIssue.code} 尚未完整覆盖配置`);
  if (expiring) issues.push('证书有效期不足 90 天，需先确认续证安排');

  return issues;
}

/**
 * 批准前阻断检查：在常规检查之外，要求所有非「审阅人直接接受」的证据
 * 都能对应到一张已完成的补件凭据。
 */
export function validateSubmissionWithCredentials(project: ApprovalProject, completedTokenIds: Set<string>) {
  const issues = validateSubmission(project);
  const uncreditedSubmitted = project.evidence.filter(
    (item) => item.status === 'submitted' && !(item.submissionTokenId && completedTokenIds.has(item.submissionTokenId))
  );
  if (uncreditedSubmitted.length) {
    issues.push(
      `${uncreditedSubmitted.length} 项已提交证据缺少已完成的补件凭据（草稿/待核对/失败凭据不被认可）：${uncreditedSubmitted
        .map((item) => item.name)
        .join('、')}`
    );
  }
  return issues;
}
