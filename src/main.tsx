import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createAnalyzeClient } from './api/analyzeClient.ts';
import { App } from './components/App.tsx';
import { getLocalStorage } from './lib/browserStorage.ts';
import { createHistoryStore } from './lib/historyStorage.ts';
import { extractPdfText } from './lib/pdfExtractor.ts';
import './index.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element #root not found in index.html');
}

// Composition root: the only place that picks concrete implementations for the UI.
const analyzeText = createAnalyzeClient({ apiUrl: import.meta.env.VITE_API_URL });
const historyStore = createHistoryStore(getLocalStorage());

createRoot(rootElement).render(
  <StrictMode>
    <App extractText={extractPdfText} analyzeText={analyzeText} historyStore={historyStore} />
  </StrictMode>,
);
