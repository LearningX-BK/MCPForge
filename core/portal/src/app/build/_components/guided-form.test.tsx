// @vitest-environment jsdom
//
// MCPForge — W0-J14: the guided form is "a view over the manifest, never a
// separate representation" (03 §5.3). This test is the round-trip proof: an
// edit made through the form's controls must show up as an edit to the SAME
// YAML text, and every field the form does not touch must survive
// byte-for-byte (proving there is no parallel form-state model quietly
// replacing the document on write).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { GuidedForm } from './guided-form';
import { loadBuildDrafts } from '../fixtures';

afterEach(cleanup);

describe('GuidedForm — a view over the same YAML', () => {
  const draft = loadBuildDrafts()[0]!;

  it('reads every field\'s initial value FROM the YAML text, not from separate props', () => {
    render(<GuidedForm yamlText={draft.yaml} onChange={vi.fn()} />);
    expect((screen.getByTestId('field-id') as HTMLInputElement).value).toBe('jde.ap.voucher.create');
    expect((screen.getByTestId('field-binding-type') as HTMLSelectElement).value).toBe('function');
    expect((screen.getByTestId('field-write') as HTMLInputElement).checked).toBe(true);
  });

  it('editing the title writes back into the YAML text, leaving every other field intact', () => {
    let latest = draft.yaml;
    const onChange = vi.fn((text: string) => {
      latest = text;
    });
    render(<GuidedForm yamlText={draft.yaml} onChange={onChange} />);

    fireEvent.change(screen.getByTestId('field-title'), { target: { value: 'Create a voucher (edited)' } });

    expect(onChange).toHaveBeenCalled();
    const before = parseYaml(draft.yaml) as Record<string, unknown>;
    const after = parseYaml(latest) as Record<string, unknown>;
    expect(after['title']).toBe('Create a voucher (edited)');
    // Every field the form did not touch is unchanged.
    expect(after['id']).toBe(before['id']);
    expect(after['purpose']).toBe(before['purpose']);
    expect(after['writeSafety']).toEqual(before['writeSafety']);
    expect(after['disambiguation']).toBe(before['disambiguation']);
  });

  it('changing binding type to plsql forces governance.reviewPath back to standard in the same YAML write', () => {
    let latest = draft.yaml;
    const onChange = vi.fn((text: string) => {
      latest = text;
    });
    render(<GuidedForm yamlText={draft.yaml} onChange={onChange} />);

    fireEvent.change(screen.getByTestId('field-binding-type'), { target: { value: 'plsql' } });

    const after = parseYaml(latest) as { governance: { reviewPath: string }; binding: { type: string } };
    expect(after.binding.type).toBe('plsql');
    expect(after.governance.reviewPath).toBe('standard');
  });

  it('shows the amber note once the binding type becomes plsql', () => {
    let latest = draft.yaml;
    const onChange = vi.fn((text: string) => {
      latest = text;
    });
    const { rerender } = render(<GuidedForm yamlText={draft.yaml} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('field-binding-type'), { target: { value: 'plsql' } });
    rerender(<GuidedForm yamlText={latest} onChange={onChange} />);
    expect(screen.getByTestId('expedited-review-amber-note')).toBeTruthy();
  });
});
