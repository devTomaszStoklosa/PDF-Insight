import { buildJsonFileName, downloadJsonFile } from '../lib/jsonExport.ts';
import { DownloadIcon } from './icons.tsx';

interface DownloadJsonButtonProps {
  readonly json: string;
  readonly pdfFileName: string;
}

export function DownloadJsonButton({ json, pdfFileName }: DownloadJsonButtonProps) {
  return (
    <button
      type="button"
      className="button button--primary"
      onClick={() => {
        downloadJsonFile(json, buildJsonFileName(pdfFileName));
      }}
    >
      <DownloadIcon />
      Pobierz JSON
    </button>
  );
}
