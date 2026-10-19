import type { ExtractionProgress } from '../lib/pdfExtractor.ts';
import type { DocumentInsight } from '../types/schema.ts';

export type AnalysisState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'extracting';
      readonly file: File;
      readonly progress: ExtractionProgress | null;
    }
  | { readonly status: 'analyzing'; readonly file: File; readonly pages: number }
  | { readonly status: 'error'; readonly file: File; readonly message: string }
  | { readonly status: 'success'; readonly insight: DocumentInsight };

export type AnalysisAction =
  | { readonly type: 'started'; readonly file: File }
  | { readonly type: 'progressed'; readonly progress: ExtractionProgress }
  | { readonly type: 'extracted'; readonly pages: number }
  | { readonly type: 'succeeded'; readonly insight: DocumentInsight }
  | { readonly type: 'failed'; readonly message: string }
  | { readonly type: 'reset' };

export const INITIAL_ANALYSIS_STATE: AnalysisState = { status: 'idle' };

/** Pipeline: idle → extracting → analyzing → success | error. Out-of-order actions are ignored. */
export function analysisReducer(state: AnalysisState, action: AnalysisAction): AnalysisState {
  switch (action.type) {
    case 'started':
      return { status: 'extracting', file: action.file, progress: null };
    case 'progressed':
      return state.status === 'extracting' ? { ...state, progress: action.progress } : state;
    case 'extracted':
      return state.status === 'extracting'
        ? { status: 'analyzing', file: state.file, pages: action.pages }
        : state;
    case 'succeeded':
      return { status: 'success', insight: action.insight };
    case 'failed':
      return state.status === 'extracting' || state.status === 'analyzing'
        ? { status: 'error', file: state.file, message: action.message }
        : state;
    case 'reset':
      return INITIAL_ANALYSIS_STATE;
  }
}
