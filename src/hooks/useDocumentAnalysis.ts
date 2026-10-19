import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { AnalyzeText } from '../api/analyzeClient.ts';
import type { ExtractPdfText } from '../lib/pdfExtractor.ts';
import { toUserMessage } from '../lib/userFacingError.ts';
import type { DocumentInsight } from '../types/schema.ts';
import { analysisReducer, INITIAL_ANALYSIS_STATE, type AnalysisState } from './analysisState.ts';

export interface DocumentAnalysisDependencies {
  readonly extractText: ExtractPdfText;
  readonly analyzeText: AnalyzeText;
  /** Called once per successful analysis, e.g. to save it in the history. */
  readonly onSuccess: (insight: DocumentInsight) => void;
}

export interface DocumentAnalysis {
  readonly state: AnalysisState;
  readonly analyze: (file: File) => void;
  /** Runs the whole pipeline again for the file that failed. */
  readonly retry: () => void;
  /** Shows an earlier result, e.g. one picked from the history. */
  readonly showResult: (insight: DocumentInsight) => void;
  readonly reset: () => void;
}

/** Runs text extraction and AI analysis for one file at a time; a new call cancels the old one. */
export function useDocumentAnalysis({
  extractText,
  analyzeText,
  onSuccess,
}: DocumentAnalysisDependencies): DocumentAnalysis {
  const [state, dispatch] = useReducer(analysisReducer, INITIAL_ANALYSIS_STATE);
  const controllerRef = useRef<AbortController | null>(null);

  const cancelRunning = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  useEffect(() => cancelRunning, [cancelRunning]);

  const analyze = useCallback(
    (file: File) => {
      cancelRunning();
      const controller = new AbortController();
      controllerRef.current = controller;
      const { signal } = controller;

      dispatch({ type: 'started', file });

      const run = async (): Promise<void> => {
        try {
          const extracted = await extractText(file, {
            signal,
            onProgress: (progress) => {
              if (!signal.aborted) {
                dispatch({ type: 'progressed', progress });
              }
            },
          });
          signal.throwIfAborted();
          dispatch({ type: 'extracted', pages: extracted.pages });

          const insight = await analyzeText(
            { fileName: file.name, pages: extracted.pages, text: extracted.text },
            signal,
          );
          signal.throwIfAborted();
          dispatch({ type: 'succeeded', insight });
          onSuccess(insight);
        } catch (error) {
          // A cancelled run was replaced by a newer one, which now owns the state.
          if (!signal.aborted) {
            dispatch({ type: 'failed', message: toUserMessage(error) });
          }
        }
      };
      void run();
    },
    [analyzeText, cancelRunning, extractText, onSuccess],
  );

  const retry = useCallback(() => {
    if (state.status === 'error') {
      analyze(state.file);
    }
  }, [analyze, state]);

  const showResult = useCallback(
    (insight: DocumentInsight) => {
      cancelRunning();
      dispatch({ type: 'succeeded', insight });
    },
    [cancelRunning],
  );

  const reset = useCallback(() => {
    cancelRunning();
    dispatch({ type: 'reset' });
  }, [cancelRunning]);

  return { state, analyze, retry, showResult, reset };
}
