// @vitest-environment jsdom
//
// MCPForge — W0-J14: `plsql`/`function` structurally cannot select expedited
// review, and the reason is an amber note, never a silently disabled
// control with no explanation (CLAUDE.md non-negotiable #7, 03 §5.3).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReviewPathField } from './review-path-field';

afterEach(cleanup);

describe('ReviewPathField', () => {
  it('leaves expedited selectable and shows no amber note for a rest binding', () => {
    render(<ReviewPathField bindingType="rest" value="standard" onChange={vi.fn()} />);
    const option = screen.getByRole('option', { name: 'Expedited' }) as HTMLOptionElement;
    expect(option.disabled).toBe(false);
    expect(screen.queryByTestId('expedited-review-amber-note')).toBeNull();
  });

  it('disables the expedited option and shows the amber note, with its reason, for a plsql binding', () => {
    render(<ReviewPathField bindingType="plsql" value="standard" onChange={vi.fn()} />);
    const option = screen.getByRole('option', { name: 'Expedited' }) as HTMLOptionElement;
    expect(option.disabled).toBe(true);
    const note = screen.getByTestId('expedited-review-amber-note');
    expect(note.textContent).toContain('plsql');
    expect(note.textContent).toContain('elevated posture');
  });

  it('disables the expedited option and shows the amber note for a function binding', () => {
    render(<ReviewPathField bindingType="function" value="standard" onChange={vi.fn()} />);
    expect((screen.getByRole('option', { name: 'Expedited' }) as HTMLOptionElement).disabled).toBe(true);
    expect(screen.getByTestId('expedited-review-amber-note')).toBeTruthy();
  });

  it('forces the value back to standard if it is already expedited when the binding becomes elevated', () => {
    const onChange = vi.fn();
    render(<ReviewPathField bindingType="plsql" value="expedited" onChange={onChange} />);
    expect(onChange).toHaveBeenCalledWith('standard');
  });

  it('calls onChange when a user picks standard on a non-elevated binding', () => {
    const onChange = vi.fn();
    render(<ReviewPathField bindingType="database" value="standard" onChange={onChange} />);
    fireEvent.change(screen.getByTestId('review-path-select'), { target: { value: 'expedited' } });
    expect(onChange).toHaveBeenCalledWith('expedited');
  });
});
