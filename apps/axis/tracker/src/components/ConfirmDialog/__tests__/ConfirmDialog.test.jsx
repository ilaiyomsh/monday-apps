import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConfirmDialog from '../ConfirmDialog';

describe('ConfirmDialog', () => {

    // === רינדור ===

    it('לא מרנדר כלום כש-isOpen=false', () => {
        const { container } = render(
            <ConfirmDialog isOpen={false} onClose={vi.fn()} onConfirm={vi.fn()} />
        );
        expect(container.innerHTML).toBe('');
    });

    it('מרנדר את הדיאלוג כש-isOpen=true', () => {
        render(
            <ConfirmDialog isOpen={true} onClose={vi.fn()} onConfirm={vi.fn()} />
        );
        // "אישור" מופיע גם ככותרת (h3) וגם ככפתור
        expect(screen.getByRole('heading', { name: 'אישור' })).toBeInTheDocument();
        expect(screen.getByText('האם אתה בטוח?')).toBeInTheDocument();
    });

    it('מציג כותרת והודעה מותאמות', () => {
        render(
            <ConfirmDialog
                isOpen={true}
                onClose={vi.fn()}
                onConfirm={vi.fn()}
                title="מחיקת אירוע"
                message="האם למחוק את האירוע הזה?"
            />
        );
        expect(screen.getByText('מחיקת אירוע')).toBeInTheDocument();
        expect(screen.getByText('האם למחוק את האירוע הזה?')).toBeInTheDocument();
    });

    it('מציג טקסט כפתורים מותאם', () => {
        render(
            <ConfirmDialog
                isOpen={true}
                onClose={vi.fn()}
                onConfirm={vi.fn()}
                confirmText="מחק"
                cancelText="חזור"
            />
        );
        expect(screen.getByText('מחק')).toBeInTheDocument();
        expect(screen.getByText('חזור')).toBeInTheDocument();
    });

    // === אינטראקציות ===

    it('קורא ל-onConfirm בלחיצה על כפתור האישור', async () => {
        const user = userEvent.setup();
        const onConfirm = vi.fn();
        render(
            <ConfirmDialog isOpen={true} onClose={vi.fn()} onConfirm={onConfirm} />
        );

        // כפתור אישור הוא הכפתור השני בפוטר
        const buttons = screen.getAllByRole('button');
        const confirmBtn = buttons.find(btn => btn.textContent === 'אישור');
        await user.click(confirmBtn);

        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('קורא ל-onCancel בלחיצה על כפתור הביטול', async () => {
        const user = userEvent.setup();
        const onCancel = vi.fn();
        render(
            <ConfirmDialog
                isOpen={true}
                onClose={vi.fn()}
                onConfirm={vi.fn()}
                onCancel={onCancel}
                cancelText="ביטול"
            />
        );

        await user.click(screen.getByText('ביטול'));

        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('קורא ל-onClose כ-fallback כשאין onCancel', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        render(
            <ConfirmDialog
                isOpen={true}
                onClose={onClose}
                onConfirm={vi.fn()}
                cancelText="ביטול"
            />
        );

        await user.click(screen.getByText('ביטול'));

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('כפתור X בפינה קורא ל-onCancel', async () => {
        const user = userEvent.setup();
        const onCancel = vi.fn();
        render(
            <ConfirmDialog
                isOpen={true}
                onClose={vi.fn()}
                onConfirm={vi.fn()}
                onCancel={onCancel}
            />
        );

        // כפתור ה-X הוא הכפתור הראשון (ב-header)
        const buttons = screen.getAllByRole('button');
        // כפתור X הוא הראשון
        await user.click(buttons[0]);

        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    // === סגנונות ===

    it('מחיל סגנון danger על כפתור אישור', () => {
        render(
            <ConfirmDialog
                isOpen={true}
                onClose={vi.fn()}
                onConfirm={vi.fn()}
                confirmButtonStyle="danger"
                confirmText="מחק"
            />
        );

        const deleteBtn = screen.getByText('מחק');
        expect(deleteBtn.className).toContain('dangerBtn');
    });

    it('מחיל סגנון primary כברירת מחדל', () => {
        render(
            <ConfirmDialog
                isOpen={true}
                onClose={vi.fn()}
                onConfirm={vi.fn()}
                confirmText="אישור"
            />
        );

        // נמצא את כפתור האישור בפוטר (לא כפתור X)
        const buttons = screen.getAllByRole('button');
        const confirmBtn = buttons.find(btn => btn.textContent === 'אישור');
        expect(confirmBtn.className).toContain('confirmBtn');
    });
});
