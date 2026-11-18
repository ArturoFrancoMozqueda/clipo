export type ErrorCode = 'CONFLICT' | 'CONNECTION_LOST' | 'BUSY' | 'STORAGE_ERROR' | 'INVALID_INPUT' | 'ACTION_FAILED' | 'REQUEST_KEY_REUSED' | 'OUTCOME_UNKNOWN';
export class AgentError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode, message: string) { super(message); this.name = 'AgentError'; this.code = code; }
}
export function errorDetails(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const explicit = error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
  const codes: ErrorCode[] = ['CONFLICT', 'CONNECTION_LOST', 'BUSY', 'STORAGE_ERROR', 'INVALID_INPUT', 'ACTION_FAILED', 'REQUEST_KEY_REUSED', 'OUTCOME_UNKNOWN'];
  // Compatibility adapter for older native editor errors; new automation errors carry codes.
  const code = codes.includes(explicit as ErrorCode) ? explicit as ErrorCode
    : /desactualizada|cambió|revision/i.test(message) ? 'CONFLICT'
    : /conexión|contactar|app:agent|caducado/i.test(message) ? 'CONNECTION_LOST'
    : /curso|termine|Espera|otro comando/.test(message) ? 'BUSY'
    : /guardar|espacio|quota|disk/i.test(message) ? 'STORAGE_ERROR'
    : /inexistente|desconocid|Fuera|fuera|inválid|necesita|Falta|intervalo|Intervalo|Selecciona|Usa /.test(message) ? 'INVALID_INPUT' : 'ACTION_FAILED';
  return { code, message, retryable: false,
    nextCall: code === 'CONNECTION_LOST' ? 'clipo_connect' : code === 'OUTCOME_UNKNOWN' || code === 'REQUEST_KEY_REUSED' ? 'clipo_get_request' : 'clipo_get_project',
    hint: code === 'CONNECTION_LOST' ? 'Comprueba la conexión y relee el proyecto y los trabajos. No repitas una escritura a ciegas.'
      : code === 'BUSY' ? 'Consulta el trabajo existente o cancélalo por ID.' : 'Relee el estado antes de corregir y repetir la operación.' };
}
