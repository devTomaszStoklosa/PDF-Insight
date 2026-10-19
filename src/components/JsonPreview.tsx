interface JsonPreviewProps {
  readonly json: string;
}

export function JsonPreview({ json }: JsonPreviewProps) {
  return (
    <div className="json-preview">
      <p className="json-preview__hint">
        Surowy wynik analizy – dokładnie ta treść trafi do pobranego pliku JSON.
      </p>
      <pre className="json-preview__code">
        <code>{json}</code>
      </pre>
    </div>
  );
}
