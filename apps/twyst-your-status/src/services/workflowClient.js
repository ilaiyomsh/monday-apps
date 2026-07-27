import mondayService from './mondayService';

async function request(path, options = {}) {
  const token = await mondayService.getSessionToken();
  const response = await fetch(path, {
    ...options,
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Workflow request failed (${response.status}).`);
    error.code = payload.error;
    error.details = payload;
    throw error;
  }
  return payload;
}

const workflowClient = {
  getBoardConfig(boardId) {
    return request(`/api/boards/${encodeURIComponent(boardId)}/config`);
  },
  saveBoardConfig(boardId, config) {
    return request(`/api/boards/${encodeURIComponent(boardId)}/config`, {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  },
  getItemWorkflow(boardId, itemId) {
    return request(`/api/boards/${encodeURIComponent(boardId)}/items/${encodeURIComponent(itemId)}/workflow`);
  },
  executeTransition(boardId, itemId, transitionId, formValues = {}) {
    return request(`/api/boards/${encodeURIComponent(boardId)}/items/${encodeURIComponent(itemId)}/transitions`, {
      method: 'POST',
      body: JSON.stringify({ transitionId, formValues }),
    });
  },
  async connectAccount() {
    const popup = window.open('about:blank', 'twyst-workflow-oauth', 'width=720,height=760');
    try {
      const { url } = await request('/api/oauth/start', { method: 'POST', body: '{}' });
      if (popup) popup.location.href = url;
      else window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      popup?.close();
      throw error;
    }
  },
};

export default workflowClient;
