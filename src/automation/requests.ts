import type { RecordStore } from './storage';
import { AgentError } from './errors';

export interface RequestRecord {
  key: string; tool: string; fingerprint: string; createdAt: number; updatedAt: number;
  status: 'running' | 'completed' | 'unknown'; result?: unknown; error?: string;
}
/** Durable at-most-once journal. Uncertain outcomes are never automatically executed again. */
export function createRequestJournal(storage: RecordStore, hash: (value: unknown) => Promise<string>) {
  const fingerprint = (tool: string, args: Record<string, unknown>) => {
    const { response: _response, requestKey: _key, ...operation } = args;
    return hash({ tool, args: operation });
  };
  return {
    async recover() {
      for (const record of await storage.list<RequestRecord>('request:')) {
        if (record.status === 'running') await storage.put('request:' + record.key, { ...record, status: 'unknown', updatedAt: Date.now(), error: 'El editor se cerró antes de registrar el resultado. Revisa proyecto, auditoría y trabajos.' });
      }
    },
    async read(key: string) { return (await storage.get<RequestRecord>('request:' + key)) ?? null; },
    async lookup(key: string, tool: string, args: Record<string, unknown>) {
      const record = await storage.get<RequestRecord>('request:' + key);
      if (record && record.fingerprint !== await fingerprint(tool, args)) throw new AgentError('REQUEST_KEY_REUSED', 'requestKey ya corresponde a otros argumentos. Consulta clipo_get_request.');
      return record;
    },
    async begin(key: string, tool: string, args: Record<string, unknown>) {
      if (await storage.get('request:' + key)) throw new AgentError('OUTCOME_UNKNOWN', 'La solicitud ya está registrada. Consulta clipo_get_request.');
      if ((await storage.list('request:')).length >= 1000) throw new AgentError('STORAGE_ERROR', 'El diario alcanzó 1000 solicitudes. No se borran claves automáticamente para evitar repetir escrituras antiguas.');
      const at = Date.now();
      const record: RequestRecord = { key, tool, fingerprint: await fingerprint(tool, args), createdAt: at, updatedAt: at, status: 'running' };
      await storage.put('request:' + key, record); return record;
    },
    async complete(record: RequestRecord, result: unknown) {
      const completed: RequestRecord = { ...record, status: 'completed', updatedAt: Date.now(), result };
      await storage.put('request:' + record.key, completed); return completed;
    },
    async uncertain(record: RequestRecord, error: string) {
      await storage.put('request:' + record.key, { ...record, status: 'unknown', updatedAt: Date.now(), error });
    },
  };
}
