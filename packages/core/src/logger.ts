import pino, { type Logger } from 'pino';
import { redact } from '@agiloft-control/shared';

export type { Logger };

/** Structured JSON logs. All objects pass through the shared redactor. */
export function createLogger(
  level: string,
  name = 'agiloft-control',
  destination?: pino.DestinationStream,
): Logger {
  return pino(
    {
      name,
      level,
      base: { service: name },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'headers.authorization',
          'headers.cookie',
          '*.password',
          '*.secret',
          '*.token',
        ],
        censor: '[REDACTED]',
      },
      formatters: {
        log: (obj) => redact(obj),
      },
    },
    destination ?? pino.destination(2),
  );
}
