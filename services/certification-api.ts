import { ofetch } from 'ofetch';
import type { ApprovalProject, ProjectFilters, SupplementToken } from '~/types/certification';
import type { SubmitResult } from './supplement-ledger';
import { mockFetch } from './mock-fetch';
const client = ofetch.create({
  baseURL: '/api',
  retry: 0
}, {
  fetch: mockFetch as typeof fetch
});

function matches(project: ApprovalProject, filters: ProjectFilters) {
  const query = filters.query.trim().toLowerCase();
  const matchesQuery =
    !query ||
    [project.id, project.name, project.modelCode, project.configuration, project.softwareVersion]
      .join(' ')
      .toLowerCase()
      .includes(query);
  const matchesStatus = filters.status === 'all' || project.status === filters.status;
  const matchesAgency = filters.agency === 'all' || project.agency === filters.agency;
  const matchesRisk =
    filters.risk === 'all' ||
    (filters.risk === 'expiring' && new Date(project.certificateExpiry) <= new Date('2026-12-31')) ||
    (filters.risk === 'missing' &&
      project.regulations.some((item) => item.status === 'missing' || item.status === 'conflict')) ||
    (filters.risk === 'version_conflict' &&
      project.evidence.some((item) => item.softwareVersion !== project.softwareVersion));

  return matchesQuery && matchesStatus && matchesAgency && matchesRisk;
}

export const certificationApi = {
  async listProjects(filters: ProjectFilters) {
    const projects = await client<ApprovalProject[]>('/projects');
    return projects.filter((project) => matches(project, filters));
  },

  async getProject(id: string) {
    return client<ApprovalProject>(`/projects/${encodeURIComponent(id)}`);
  },

  /** 开始一次补件：创建可续办的提交凭据，记住基线和证据清单。 */
  async createSupplementToken(projectId: string) {
    return client<SupplementToken>(`/projects/${encodeURIComponent(projectId)}/supplement-tokens`, {
      method: 'POST'
    });
  },

  /** 自动保存凭据中的已选证据和说明。 */
  async saveSupplementDraft(
    projectId: string,
    tokenId: string,
    draft: { selectedEvidenceIds: string[]; note: string }
  ) {
    return client<SupplementToken>(
      `/projects/${encodeURIComponent(projectId)}/supplement-tokens/${encodeURIComponent(tokenId)}`,
      { method: 'PUT', body: draft }
    );
  },

  /** 待核对凭据按最新基线核对续办，保留已选证据和说明。 */
  async rebaseSupplementToken(projectId: string, tokenId: string) {
    return client<SupplementToken>(
      `/projects/${encodeURIComponent(projectId)}/supplement-tokens/${encodeURIComponent(tokenId)}?action=rebase`,
      { method: 'POST' }
    );
  },

  /** 用凭据提交补件；凭据本身是幂等键，重复提交不会重复推进证据。 */
  async submitSupplementToken(
    projectId: string,
    tokenId: string,
    payload: { actor: string; simulateFailure?: boolean }
  ) {
    return client<SubmitResult>(
      `/projects/${encodeURIComponent(projectId)}/supplement-tokens/${encodeURIComponent(tokenId)}?action=submit`,
      { method: 'POST', body: payload }
    );
  }
};
