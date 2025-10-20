import { z, ZodError } from 'zod';

export class ValidationError extends Error {
  readonly status = 400;
  readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = 'ValidationError';
    this.details = details;
  }
}

function requiredString(field: string) {
  return z
    .string({
      required_error: `${field} is required`,
      invalid_type_error: `${field} must be a string`,
    })
    .max(2048, `${field} exceeds maximum length of 2048 characters.`)
    .transform(value => value.trim())
    .refine(value => value.length > 0, `${field} must not be empty.`);
}

function optionalString(field: string) {
  return z.union([
    z
      .string({ invalid_type_error: `${field} must be a string` })
      .max(2048, `${field} exceeds maximum length of 2048 characters.`)
      .transform(value => value.trim())
      .refine(value => value.length > 0, `${field} must not be empty.`),
    z.null(),
    z.undefined(),
  ]);
}

function requiredInteger(field: string) {
  return z.union([
    z
      .number({ invalid_type_error: `${field} must be a number.` })
      .refine(Number.isFinite, `${field} must be a finite number.`),
    z
      .string({
        required_error: `${field} is required`,
        invalid_type_error: `${field} must be a string.`,
      })
      .regex(/^-?\d+$/, `${field} must be an integer.`),
  ]);
}

function optionalInteger(field: string) {
  return z.union([
    z
      .number({ invalid_type_error: `${field} must be a number.` })
      .refine(Number.isFinite, `${field} must be a finite number.`),
    z
      .string({ invalid_type_error: `${field} must be a string.` })
      .regex(/^-?\d+$/, `${field} must be an integer.`),
    z.null(),
    z.undefined(),
  ]);
}

const baseInvocationSchema = z
  .object({
    parameters: z
      .record(z.unknown())
      .optional()
      .refine(val => val === undefined || !Array.isArray(val), 'Parameters must be an object.'),
    auth: z.unknown().optional(),
  })
  .passthrough();

const pageviewParametersSchema = z
  .object({
    url: requiredString('url'),
    siteId: optionalInteger('siteId'),
    actionName: optionalString('actionName'),
    pvId: optionalString('pvId'),
    visitorId: optionalString('visitorId'),
    uid: optionalString('uid'),
    referrer: optionalString('referrer'),
    timestamp: optionalInteger('timestamp'),
  })
  .passthrough();

const eventParametersSchema = z
  .object({
    category: requiredString('category'),
    action: requiredString('action'),
    name: optionalString('name'),
    value: optionalInteger('value'),
    url: optionalString('url'),
    siteId: optionalInteger('siteId'),
    visitorId: optionalString('visitorId'),
    uid: optionalString('uid'),
    referrer: optionalString('referrer'),
    timestamp: optionalInteger('timestamp'),
  })
  .passthrough();

const goalParametersSchema = z
  .object({
    goalId: requiredInteger('goalId'),
    revenue: optionalInteger('revenue'),
    url: optionalString('url'),
    siteId: optionalInteger('siteId'),
    visitorId: optionalString('visitorId'),
    uid: optionalString('uid'),
    referrer: optionalString('referrer'),
    timestamp: optionalInteger('timestamp'),
  })
  .passthrough();

const endpointValidators = new Map<string, z.ZodTypeAny>([
  ['/track/pageview', pageviewParametersSchema],
  ['/track/event', eventParametersSchema],
  ['/track/goal', goalParametersSchema],
]);

function pickParameters(source: Record<string, unknown>): Record<string, unknown> {
  const { parameters, auth, ...rest } = source;
  if (parameters && typeof parameters === 'object' && !Array.isArray(parameters)) {
    return parameters as Record<string, unknown>;
  }

  return rest;
}

function sanitizeContainer(body: unknown): {
  container: Record<string, unknown>;
  parameters: Record<string, unknown>;
  usedFallback: boolean;
} {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object.');
  }

  try {
    const parsed = baseInvocationSchema.parse(body);
    const params =
      parsed.parameters && typeof parsed.parameters === 'object' && !Array.isArray(parsed.parameters)
        ? (parsed.parameters as Record<string, unknown>)
        : pickParameters(parsed as Record<string, unknown>);

    const usedFallback = !parsed.parameters;
    return {
      container: parsed as Record<string, unknown>,
      parameters: params,
      usedFallback,
    };
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ValidationError('Invalid request payload.', error.format());
    }
    throw error;
  }
}

export function parseToolInvocation(body: unknown, endpoint: string): {
  params: Record<string, unknown>;
  auth: unknown;
  usedFallback: boolean;
} {
  const { container, parameters, usedFallback } = sanitizeContainer(body);

  const schema = endpointValidators.get(endpoint);
  if (!schema) {
    return {
      params: parameters,
      auth: container.auth,
      usedFallback,
    };
  }

  try {
    const parsed = schema.parse(parameters);
    return {
      params: parsed as Record<string, unknown>,
      auth: container.auth,
      usedFallback,
    };
  } catch (error) {
    if (error instanceof ZodError) {
      const issue = error.issues[0];
      const pathSegment = typeof issue?.path?.[0] === 'string' ? (issue?.path?.[0] as string) : undefined;
      let message = issue?.message ?? 'Request parameters are invalid.';
      if (message === 'Required' && pathSegment) {
        message = `${pathSegment} is required`;
      }
      throw new ValidationError(message, error.format());
    }
    throw error;
  }
}
