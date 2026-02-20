export class ApiError extends Error {
  public statusCode: number;
  public success: boolean;
  public errors: any[];
  public data: unknown;
  public stack?: string;

  constructor(
    statusCode: number,
    message: string = "Something went wrong",
    errors: any[] = [],
    stack?: string
  ) {
    super(message);

    this.name = "ApiError";
    this.statusCode = statusCode;
    this.success = false;
    this.errors = errors;
    this.data = null;

    if (stack) {
      this.stack = stack;
    } else {
      Error.captureStackTrace(this, this.constructor);
    }

    Object.setPrototypeOf(this, ApiError.prototype);
  }
}