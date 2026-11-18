import { z } from 'zod';

const job = z.looseObject({ id: z.string(), status: z.enum(['queued', 'running', 'saving', 'completed', 'error', 'cancelled', 'interrupted']) });
const project = z.looseObject({ id: z.string() }).nullable();
/** Additive legacy envelopes: validate known fields while keeping native action-specific results. */
export const stateOutput = z.looseObject({ revision: z.number().int().nonnegative().optional(), project: project.optional(), projectSummary: project.optional(),
  job: job.optional(), jobs: z.array(job).optional(), receipt: z.looseObject({ verified: z.boolean() }).nullable().optional() });
const visualOutput = z.looseObject({ media: z.object({ width: z.number().positive(), height: z.number().positive(), duration: z.number().positive().nullable() }),
  range: z.object({ from: z.number(), to: z.number() }),
  frames: z.array(z.object({ time: z.number(), meanLuma: z.number().min(0).max(1), darkFraction: z.number().min(0).max(1), change: z.number().nullable(), pixelDifference: z.number().nullable() })),
  sceneChanges: z.array(z.object({ from: z.number(), to: z.number(), score: z.number() })),
  issues: z.array(z.object({ code: z.string(), from: z.number(), to: z.number() })),
  coverage: z.looseObject({ mode: z.literal('sampled'), samples: z.number().int().positive(), unmeasured: z.array(z.string()) }) });
export const specializedOutputs: Record<string, z.ZodType> = {
  clipo_get_project: stateOutput.extend({ revision: z.number().int().nonnegative() }),
  clipo_get_job: stateOutput.extend({ revision: z.number().int().nonnegative(), job }),
  clipo_get_caption_job: stateOutput.extend({ revision: z.number().int().nonnegative(), job }),
  clipo_get_request: z.object({ request: z.looseObject({ key: z.string(), tool: z.string(), fingerprint: z.string(), createdAt: z.number(), updatedAt: z.number(), status: z.enum(['running', 'completed', 'unknown']), result: z.unknown().optional(), error: z.string().optional() }).nullable() }),
  clipo_plan_edit: stateOutput.extend({ revision: z.number().int(), dryRun: z.literal(true), appliesToRevision: z.number().int(), plan: z.looseObject({
    duration: z.number().nonnegative(), durationDelta: z.number(), mainDurationDelta: z.number(), idsAreIllustrative: z.literal(true), ripple: z.literal(false),
    differences: z.array(z.object({ id: z.string(), kind: z.string(), change: z.enum(['added', 'removed', 'updated']), fields: z.array(z.string()),
      before: z.object({ start: z.number(), end: z.number() }).nullable(), after: z.object({ start: z.number(), end: z.number() }).nullable() })),
    settings: z.array(z.object({ field: z.string(), before: z.unknown(), after: z.unknown() })), warnings: z.array(z.object({ code: z.string(), ids: z.array(z.string()), message: z.string() })),
  }) }),
  clipo_inspect_media: visualOutput.extend({ domain: z.literal('source'), revision: z.number().int(), projectId: z.string(), assetId: z.string() }),
  clipo_review_export: visualOutput.extend({ domain: z.literal('export'), artifact: z.looseObject({ id: z.string(), sha256: z.string(), bytes: z.number() }), durationCheck: z.looseObject({ measured: z.boolean() }) }),
  clipo_query_project: z.looseObject({ revision: z.number().int(), projectId: z.string(), items: z.array(z.unknown()).optional(), summary: z.object({ id: z.string(), counts: z.record(z.string(), z.number()) }).passthrough().optional() }),
};
