export const DEFAULT_ATTEMPT_GENERATION = 1;

export const normalizeAttemptGeneration = (value: number | undefined): number =>
  value !== undefined && Number.isInteger(value) && value > 0
    ? value
    : DEFAULT_ATTEMPT_GENERATION;

export const getAttemptGeneration = (
  operation: { attemptGeneration?: number } | undefined,
): number => normalizeAttemptGeneration(operation?.attemptGeneration);
