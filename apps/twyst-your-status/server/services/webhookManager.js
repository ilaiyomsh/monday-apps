export function createWebhookManager({ store, mondayApi, baseUrl }) {
  const callbackUrl = `${baseUrl.replace(/\/+$/, '')}/webhooks/status-change`;

  return {
    async ensure({ accountId, boardId, columnId, token }) {
      const existing = await store.getWebhook(accountId, boardId);
      if (existing?.columnId === columnId && existing?.url === callbackUrl && existing?.id) {
        return existing;
      }
      if (existing?.id) {
        await mondayApi.deleteWebhook({ token, webhookId: existing.id });
      }
      const created = await mondayApi.createStatusWebhook({
        token,
        boardId,
        url: callbackUrl,
        columnId,
      });
      const webhook = { id: String(created.id), boardId: String(boardId), columnId, url: callbackUrl };
      await store.saveWebhook(accountId, boardId, webhook);
      return webhook;
    },
  };
}
