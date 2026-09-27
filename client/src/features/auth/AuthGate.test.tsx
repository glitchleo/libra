// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthGate, useAccess } from './AuthGate';
import { getJson, sendJson } from '../../api/client';
vi.mock('../../api/client', () => ({ getJson: vi.fn(), sendJson: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function Library() { const access = useAccess(); return <><h1>Private collection</h1><p>{access.maxBackupBytes}</p><button onClick={() => void access.logout()}>Sign out</button></>; }
describe('library sign-in', () => {
  it('keeps private content hidden, supports retry, signs in and signs out', async () => {
    vi.mocked(getJson).mockResolvedValue({ required: true, authenticated: false, backupMaxBytes: 4 * 1024 * 1024 });
    vi.mocked(sendJson).mockRejectedValueOnce(new Error('That password is incorrect.')).mockResolvedValue({ authenticated: true });
    const user = userEvent.setup(); render(<AuthGate><Library /></AuthGate>);
    const password = await screen.findByLabelText('Library password');
    expect(screen.queryByText('Private collection')).toBeNull();
    await user.type(password, 'test-only-password'); await user.click(screen.getByRole('button', { name: 'Open my library' }));
    expect((await screen.findByRole('alert')).textContent).toContain('incorrect');
    await user.click(screen.getByRole('button', { name: 'Open my library' }));
    await screen.findByText('Private collection'); expect(screen.getByText('4194304')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect((await screen.findByLabelText('Library password') as HTMLInputElement).value).toBe('');
    expect(sendJson).toHaveBeenLastCalledWith('/api/auth/logout', 'POST', {});
  });
  it('unmounts private content when an API request reports an expired session', async () => {
    vi.mocked(getJson).mockResolvedValue({ required: true, authenticated: true });
    render(<AuthGate><Library /></AuthGate>); await screen.findByText('Private collection');
    fireEvent(window, new Event('libra:auth-required'));
    await screen.findByLabelText('Library password'); expect(screen.queryByText('Private collection')).toBeNull();
  });
  it('retries a failed session check and opens local development without a password', async () => {
    vi.mocked(getJson).mockRejectedValueOnce(new Error('Cannot connect')).mockResolvedValue({ required: false, authenticated: true });
    const user = userEvent.setup(); render(<AuthGate><Library /></AuthGate>);
    await screen.findByRole('alert'); await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Private collection');
  });
});
