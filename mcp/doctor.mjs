import { callEditor, discoveryPath } from './bridge-client.mjs';
import { toolSchemas } from '../src/automation/schema.ts';
const report = { node: process.version, serverTools: Object.keys(toolSchemas).length, discoveryFile: discoveryPath(), connected: false };
try {
  const state = await callEditor('clipo_status', {});
  Object.assign(report, { connected: true, revision: state.revision, project: state.project ? { id: state.project.id, name: state.project.name } : null, busy: state.captioning || state.exporting, saveStatus: state.saveStatus });
} catch (e) { Object.assign(report, { error: e instanceof Error ? e.message : String(e), nextStep: 'Usa clipo_connect o clipo_status: Clipo se abrirá automáticamente.' }); process.exitCode = 1; }
console.log(JSON.stringify(report, null, 2));
