export class EngineError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
  }
}

export class QLabError extends EngineError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = 'QLabError';
  }
}

export class ShowCueError extends EngineError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = 'ShowCueError';
  }
}

export class LivePlayError extends EngineError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = 'LivePlayError';
  }
}

export class AuthPolicyError extends EngineError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = 'AuthPolicyError';
  }
}
