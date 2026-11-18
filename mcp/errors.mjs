import { errorDetails } from '../src/automation/errors.ts';
/** Guidance is conservative: even a connection error can follow a committed write. */
export const toolError = (error) => ({ error: errorDetails(error) });
