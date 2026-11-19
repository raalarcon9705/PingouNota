export class AdaflowError extends Error {
  public readonly status?: number;
  public readonly responseBody?: unknown;

  constructor(message: string, status?: number, responseBody?: unknown) {
    super(message);
    this.name = 'AdaflowError';
    this.status = status;
    this.responseBody = responseBody;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AdaflowAuthError extends AdaflowError {
  constructor(
    message = 'Não autorizado. Verifique seu token de API da Adaflow.',
    responseBody?: unknown,
  ) {
    super(message, 401, responseBody);
    this.name = 'AdaflowAuthError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AdaflowNotFoundError extends AdaflowError {
  constructor(
    message = 'Recurso não encontrado na Adaflow.',
    responseBody?: unknown,
  ) {
    super(message, 404, responseBody);
    this.name = 'AdaflowNotFoundError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AdaflowValidationError extends AdaflowError {
  public readonly errors?: unknown;

  constructor(
    message = 'Erro de validação dos dados na Adaflow.',
    errors?: unknown,
    responseBody?: unknown,
  ) {
    super(message, 422, responseBody);
    this.name = 'AdaflowValidationError';
    this.errors = errors;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AdaflowRateLimitError extends AdaflowError {
  public readonly retryAfter?: number;

  constructor(
    message = 'Limite de requisições da Adaflow excedido.',
    retryAfter?: number,
    responseBody?: unknown,
  ) {
    super(message, 429, responseBody);
    this.name = 'AdaflowRateLimitError';
    this.retryAfter = retryAfter;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AdaflowTimeoutError extends AdaflowError {
  constructor(
    message = 'Tempo limite esgotado ao comunicar com a Adaflow.',
    responseBody?: unknown,
  ) {
    super(message, undefined, responseBody);
    this.name = 'AdaflowTimeoutError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AdaflowServerError extends AdaflowError {
  constructor(
    message = 'Erro interno no servidor da Adaflow.',
    status = 500,
    responseBody?: unknown,
  ) {
    super(message, status, responseBody);
    this.name = 'AdaflowServerError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
