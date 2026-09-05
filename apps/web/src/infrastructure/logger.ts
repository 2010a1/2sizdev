type LogContext = {
  operation?: string;
  entityType?: string;
  entityId?: string;
  mutationId?: string;
  errorCode?: string;
};
const sanitize = (context: LogContext = {}) => ({
  operation: context.operation,
  entityType: context.entityType,
  entityId: context.entityId,
  mutationId: context.mutationId,
  errorCode: context.errorCode
});
export const logger = {
  debug(message: string, context?: LogContext) { if (import.meta.env.DEV) console.debug(message, sanitize(context)); },
  info(message: string, context?: LogContext) { if (import.meta.env.DEV) console.info(message, sanitize(context)); },
  warn(message: string, context?: LogContext) { console.warn(message, sanitize(context)); },
  error(message: string, context?: LogContext) { console.error(message, sanitize(context)); }
};
