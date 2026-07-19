// Resend sender funnel contract (src/services/email-sender.js).

import { describe, it, expect, vi } from 'vitest';
import { createEmailSender, EmailSendError, RESEND_API_URL } from '../src/services/email-sender.js';

function okFetch(body = { id: 'em_123' }) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  });
}

describe('createEmailSender', () => {
  it('POSTs to the Resend API with Bearer auth and {from, to:[..], subject, html}; resolves {id}', async () => {
    const fetchImpl = okFetch();
    const sender = createEmailSender({ apiKey: 'rk_test', from: 'עדכונים <d@x.co>', fetchImpl });
    const res = await sender.send({ to: 'dana@example.com', subject: 'נושא', html: '<p>ש</p>' });

    expect(res).toEqual({ id: 'em_123' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(RESEND_API_URL);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer rk_test');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      from: 'עדכונים <d@x.co>',
      to: ['dana@example.com'],
      subject: 'נושא',
      html: '<p>ש</p>',
    });
  });

  it('non-2xx → throws EmailSendError carrying the HTTP status and the API message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: () => Promise.resolve({ message: 'Invalid `to` address' }),
    });
    const sender = createEmailSender({ apiKey: 'rk', from: 'a@b.c', fetchImpl });
    await expect(sender.send({ to: 'bad', subject: 's', html: 'h' })).rejects.toMatchObject({
      name: 'EmailSendError',
      status: 422,
      message: expect.stringContaining('Invalid `to` address'),
    });
  });

  it('network failure → throws EmailSendError (never a bare fetch error)', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    const sender = createEmailSender({ apiKey: 'rk', from: 'a@b.c', fetchImpl });
    await expect(sender.send({ to: 'x@y.z', subject: 's', html: 'h' })).rejects.toBeInstanceOf(EmailSendError);
  });
});
