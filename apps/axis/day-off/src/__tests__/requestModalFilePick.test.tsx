import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import '../i18n';
import { RequestModal } from '../components/modals/RequestModal';
import type { Employee } from '../domain/types';

/**
 * error-guard: RequestModal.onPickFile called URL.createObjectURL(f) in a sync
 * onChange handler with NO local try/catch (RequestModal.tsx:54, pre-fix). A
 * throw there was seen only by the global unhandledrejection/onerror net — no
 * user-facing feedback, and the picker was left in a broken state.
 *
 * Locks the fixed contract: a createObjectURL failure is caught, logged at
 * ERROR, and shown as a danger toast — and never adds a broken attachment chip.
 */

// vi.mock factories are hoisted above these imports/consts — vi.hoisted keeps the
// mock functions reachable both inside the (hoisted) factories and down here.
const { loggerErrorMock, toastMock } = vi.hoisted(() => ({
  loggerErrorMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock('../core', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: loggerErrorMock },
}));

vi.mock('../contexts/DayOffDataProvider', () => ({
  useDayOffData: () => ({
    balanceFor: () => ({ entitled: 0, used: 0, pending: 0 }),
    companyDays: [],
    toast: toastMock,
  }),
}));

const currentUser: Employee = { id: 'u1', name: 'Dana', initials: 'D', color: '#000' };

function pickFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

describe('RequestModal — file pick failure (error-guard retrofit)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    loggerErrorMock.mockClear();
    toastMock.mockClear();
  });

  it('logs ERROR and shows a danger toast when URL.createObjectURL throws — no attachment chip is added', () => {
    const boom = new Error('createObjectURL: not implemented');
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      throw boom;
    });

    const { container } = render(
      <RequestModal currentUser={currentUser} onClose={() => undefined} onSubmit={() => undefined} />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'note.pdf', { type: 'application/pdf' });

    pickFile(input, file);

    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'RequestModal',
      'failed to create an object URL for the selected file',
      boom,
    );
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith(expect.any(String), 'danger');
    // The broken pick never reached setAttachment — no file chip in the DOM.
    expect(container.querySelector('.file-chip')).toBeNull();
    // The input is reset either way, so picking the same file again re-fires onChange.
    expect(input.value).toBe('');
  });

  it('adds the attachment chip and does not log/toast on a normal successful pick', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:ok');

    const { container, getByText } = render(
      <RequestModal currentUser={currentUser} onClose={() => undefined} onSubmit={() => undefined} />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'note.pdf', { type: 'application/pdf' });

    pickFile(input, file);

    expect(getByText('note.pdf')).toBeInTheDocument();
    expect(loggerErrorMock).not.toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalled();
  });
});
