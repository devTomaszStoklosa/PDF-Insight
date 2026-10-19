export type ApiErrorCode =
  | 'METHOD_NOT_ALLOWED'
  | 'ORIGIN_NOT_ALLOWED'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'PAYLOAD_TOO_LARGE'
  | 'INVALID_REQUEST'
  | 'RATE_LIMITED'
  | 'LLM_INVALID_OUTPUT'
  | 'LLM_QUOTA_EXCEEDED'
  | 'LLM_UNAVAILABLE'
  | 'LLM_TIMEOUT'
  | 'SERVER_MISCONFIGURED'
  | 'INTERNAL_ERROR';

interface ApiErrorDefinition {
  readonly status: number;
  /** User-facing message in Polish; never contains request data or upstream details. */
  readonly message: string;
}

const API_ERRORS: Readonly<Record<ApiErrorCode, ApiErrorDefinition>> = {
  METHOD_NOT_ALLOWED: {
    status: 405,
    message: 'Niedozwolona metoda żądania. Użyj POST.',
  },
  ORIGIN_NOT_ALLOWED: {
    status: 403,
    message: 'Ta strona nie ma dostępu do API.',
  },
  UNSUPPORTED_MEDIA_TYPE: {
    status: 415,
    message: 'Treść żądania musi być w formacie JSON.',
  },
  PAYLOAD_TOO_LARGE: {
    status: 413,
    message: 'Dokument jest za duży do analizy. Skróć tekst i spróbuj ponownie.',
  },
  INVALID_REQUEST: {
    status: 400,
    message:
      'Nieprawidłowe dane wejściowe. Wymagane pola: fileName, pages i text z tekstem dokumentu.',
  },
  RATE_LIMITED: {
    status: 429,
    message: 'Wykonano zbyt wiele analiz w krótkim czasie. Spróbuj ponownie później.',
  },
  // 502: the request was valid, but the upstream model did not return a usable analysis.
  LLM_INVALID_OUTPUT: {
    status: 502,
    message: 'Nie udało się uzyskać poprawnej analizy dokumentu. Spróbuj ponownie później.',
  },
  LLM_QUOTA_EXCEEDED: {
    status: 429,
    message: 'Wyczerpano darmowy limit zapytań do modelu AI. Spróbuj ponownie później.',
  },
  LLM_UNAVAILABLE: {
    status: 503,
    message: 'Usługa analizy dokumentów jest chwilowo niedostępna. Spróbuj ponownie później.',
  },
  // 504: the upstream model did not answer within the proxy's time limit.
  LLM_TIMEOUT: {
    status: 504,
    message: 'Model AI nie odpowiedział na czas. Spróbuj ponownie za chwilę.',
  },
  SERVER_MISCONFIGURED: {
    status: 500,
    message: 'Błąd konfiguracji serwera. Skontaktuj się z administratorem.',
  },
  INTERNAL_ERROR: {
    status: 500,
    message: 'Wystąpił nieoczekiwany błąd serwera.',
  },
};

export interface ApiErrorBody {
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;
  };
}

/** An error that maps one-to-one to an HTTP error response. */
export class HttpError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly retryAfterSeconds: number | undefined;

  constructor(code: ApiErrorCode, options: { retryAfterSeconds?: number; cause?: unknown } = {}) {
    super(code, { cause: options.cause });
    this.name = 'HttpError';
    this.code = code;
    this.status = API_ERRORS[code].status;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }

  toBody(): ApiErrorBody {
    return { error: { code: this.code, message: API_ERRORS[this.code].message } };
  }
}
