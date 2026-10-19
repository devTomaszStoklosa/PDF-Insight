import { ConfidentialityNotice } from './ConfidentialityNotice.tsx';

export function App() {
  return (
    <main>
      <h1>PDF Insight</h1>
      <p>Wgraj plik PDF, aby otrzymać krótkie podsumowanie i dane strukturalne.</p>
      <ConfidentialityNotice />
    </main>
  );
}
