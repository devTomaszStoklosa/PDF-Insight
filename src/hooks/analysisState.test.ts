import { describe, expect, it } from 'vitest';
import { createInsight } from '../test/insightFixture.ts';
import { analysisReducer, INITIAL_ANALYSIS_STATE, type AnalysisState } from './analysisState.ts';

const file = new File(['%PDF-1.7'], 'umowa.pdf', { type: 'application/pdf' });

function extracting(): AnalysisState {
  return analysisReducer(INITIAL_ANALYSIS_STATE, { type: 'started', file });
}

describe('analysisReducer', () => {
  it('walks through extraction and analysis to the result', () => {
    const insight = createInsight();
    let state = extracting();
    state = analysisReducer(state, { type: 'progressed', progress: { page: 1, totalPages: 2 } });

    expect(state).toEqual({ status: 'extracting', file, progress: { page: 1, totalPages: 2 } });

    state = analysisReducer(state, { type: 'extracted', pages: 2 });
    expect(state).toEqual({ status: 'analyzing', file, pages: 2 });

    state = analysisReducer(state, { type: 'succeeded', insight });
    expect(state).toEqual({ status: 'success', insight });
  });

  it('keeps the file on failure, so the analysis can be retried', () => {
    const state = analysisReducer(extracting(), { type: 'failed', message: 'Błąd' });

    expect(state).toEqual({ status: 'error', file, message: 'Błąd' });
  });

  it('ignores progress and failures that arrive outside a running analysis', () => {
    expect(
      analysisReducer(INITIAL_ANALYSIS_STATE, {
        type: 'progressed',
        progress: { page: 1, totalPages: 1 },
      }),
    ).toBe(INITIAL_ANALYSIS_STATE);
    expect(analysisReducer(INITIAL_ANALYSIS_STATE, { type: 'failed', message: 'Błąd' })).toBe(
      INITIAL_ANALYSIS_STATE,
    );
  });

  it('returns to the start on reset', () => {
    expect(analysisReducer(extracting(), { type: 'reset' })).toBe(INITIAL_ANALYSIS_STATE);
  });
});
