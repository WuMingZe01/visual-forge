/**
 * Pipeline execution engine.
 * Reads a WorkflowConfig, executes enabled stages in order,
 * passing PipelineContext between them.
 */

import type { WorkflowConfig, PipelineContext } from './types';
import { stageRegistry } from './stages';

export class PipelineEngine {
  private config: WorkflowConfig;
  private ctx: PipelineContext;
  private abortController: AbortController;

  constructor(config: WorkflowConfig, ctx: PipelineContext) {
    this.config = config;
    this.ctx = ctx;
    this.abortController = new AbortController();
    this.ctx.signal = this.abortController.signal;
  }

  /** Execute the pipeline — runs all enabled stages in sequence */
  async run(): Promise<void> {
    const { stages } = this.config;

    for (const stageConfig of stages) {
      if (this.ctx.abortRef.current) break;
      if (!stageConfig.enabled) continue;

      const stageFn = stageRegistry[stageConfig.id];
      if (!stageFn) {
        console.warn(`[Pipeline] Unknown stage: ${stageConfig.id}, skipping`);
        continue;
      }

      try {
        this.ctx.onProgress({
          stage: stageConfig.id,
          step: 0,
          total: 0,
          message: `执行阶段: ${stageConfig.id}`,
        });
        await stageFn(this.ctx, stageConfig.config);
      } catch (e) {
        console.error(`[Pipeline] Stage "${stageConfig.id}" failed:`, e);
        throw e;
      }
    }
  }

  /** Abort the pipeline */
  abort(): void {
    this.ctx.abortRef.current = true;
    this.abortController.abort();
  }
}

/**
 * Convenience function: create and run a pipeline.
 */
export async function runPipeline(
  config: WorkflowConfig,
  ctx: PipelineContext,
): Promise<void> {
  const engine = new PipelineEngine(config, ctx);
  await engine.run();
}
