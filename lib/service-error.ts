export class ServiceError extends Error {
  status: number;
  constructor(message: string, status = 503) {
    super(message);
    this.name = 'ServiceError';
    this.status = status;
  }
}

export class LocalRateLimitError extends ServiceError {
  constructor() { super('Please wait a few seconds and try again. This protects the community data service.', 429); }
}
