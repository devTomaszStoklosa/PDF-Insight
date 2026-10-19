// Removes the `[key: string]: any` index signature from vite/client's ImportMetaEnv,
// so reading an undeclared variable is a type error instead of a silent `any`.
interface ViteTypeOptions {
  strictImportMetaEnv: unknown;
}

interface ImportMetaEnv {
  /** Base URL of the backend API proxy. Optional until the API client validates it. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
