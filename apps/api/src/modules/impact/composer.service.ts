import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  COMPOSER_OUTPUT_SCHEMA,
  COMPOSER_SYSTEM_PROMPT,
  FactSheet,
  composerUserMessage,
} from './report-composer';
import {
  Composed,
  Violation,
  validateComposition,
  violationsAsFeedback,
} from './report-validation';

/**
 * Writing the prose (IMP-23 phase 2).
 *
 * One model call, checked, retried once with the specific violations named,
 * then given up on. Giving up is a real outcome here rather than an error
 * path: the report already exists and already reads correctly, because the
 * written report is the free report with better sentences over the same
 * frozen figures. A failed composition costs a co-op nothing — the charge
 * happens at publish, and there is always something publishable.
 *
 * **Claude Sonnet 5** (Charley, 2026-08-27). Cost was not the reason: a
 * report runs about eight cents on Sonnet against twenty on Opus, which is
 * noise against $50 for a document produced once a year.
 */
@Injectable()
export class ComposerService {
  private readonly logger = new Logger(ComposerService.name);
  private readonly client: Anthropic | null;

  /**
   * Named here rather than inline so that "which model wrote this report" is
   * answerable by grep, and so changing it is a reviewable line rather than a
   * detail buried in a request.
   */
  static readonly MODEL = 'claude-sonnet-5';

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey) {
      // Not fatal. Without a key the written report simply cannot be composed,
      // and every co-op still gets the free one — so the app boots and says so
      // rather than failing at startup over a feature most requests never
      // touch.
      this.logger.warn('ANTHROPIC_API_KEY is not set — written reports cannot be composed');
      this.client = null;
      return;
    }
    this.client = new Anthropic({
      apiKey,
      // Well inside a background function's budget, and far enough outside a
      // normal generation that a slow response is a slow response rather than
      // a hung one.
      timeout: 120_000,
      maxRetries: 2,
    });
  }

  /**
   * A provider failure in words an admin can act on.
   *
   * Found by running the thing: a bad key produced
   * `401 {"type":"error","error":{...}}` on a co-op's report page. Nobody
   * reading that learns anything except that MaybeOS leaks its own stack.
   */
  static humanReason(err: unknown): string {
    const status = (err as { status?: number })?.status;

    if (status === 401 || status === 403) {
      // The co-op did nothing wrong and cannot fix this. Say so, and do not
      // invite them to retry something that will fail identically.
      return 'MaybeOS is not set up to write reports yet — nothing is wrong with yours.';
    }
    if (status === 429) {
      return 'The writer is busy right now. Try again in a few minutes — nothing is lost.';
    }
    return 'The writer could not be reached just now. Try again in a few minutes — nothing is lost.';
  }

  get available(): boolean {
    return this.client !== null;
  }

  /**
   * Compose, check, retry once, or give up.
   *
   * The retry is given the violations by name rather than being asked to try
   * harder. "You wrote 62, which is not in the figures for this section" is
   * actionable; "that was wrong" is a second coin flip.
   */
  async compose(
    facts: FactSheet,
    globals: number[] = [],
  ): Promise<
    // A string discriminant, not a boolean: this workspace compiles with
    // `strictNullChecks: false`, under which TypeScript will not narrow a
    // union on a `true`/`false` literal and every field reads as missing.
    | { outcome: 'composed'; blocks: Composed[]; attempts: number }
    | { outcome: 'gave-up'; reason: string; violations?: Violation[] }
  > {
    if (!this.client) {
      // Written for the admin who will read it on the report page, not for a
      // log. They did nothing wrong and their report is not broken.
      return {
        outcome: 'gave-up',
        reason: 'MaybeOS is not set up to write reports yet — nothing is wrong with yours.',
      };
    }

    const checkable = facts.blocks.map((b) => ({ id: b.id, facts: b.facts }));
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: composerUserMessage(facts) },
    ];

    let lastViolations: Violation[] = [];

    for (let attempt = 1; attempt <= 2; attempt++) {
      let composed: Composed[];
      try {
        const response = await this.client.messages.parse({
          model: ComposerService.MODEL,
          max_tokens: 8000,
          system: COMPOSER_SYSTEM_PROMPT,
          thinking: { type: 'adaptive' },
          output_config: {
            effort: 'medium',
            format: jsonSchemaOutputFormat(COMPOSER_OUTPUT_SCHEMA),
          },
          messages,
        });

        const parsed = response.parsed_output;
        if (!parsed) {
          return { outcome: 'gave-up', reason: 'The model returned nothing that could be read as a report' };
        }
        composed = parsed.blocks as Composed[];
      } catch (err) {
        // A provider failure is not a defect in the report. Logged in full,
        // and the co-op is told something it can act on — the raw message is
        // an HTTP status and a JSON blob, and `composeNote` is rendered
        // straight onto the report page.
        this.logger.error(`Composition call failed: ${(err as Error).message}`);
        return { outcome: 'gave-up', reason: ComposerService.humanReason(err) };
      }

      const violations = validateComposition(composed, checkable, globals);
      if (violations.length === 0) {
        return { outcome: 'composed', blocks: composed, attempts: attempt };
      }

      lastViolations = violations;
      this.logger.warn(
        `Composition attempt ${attempt} broke ${violations.length} rule(s): ` +
          violations.map((v) => v.rule).join(', '),
      );

      messages.push(
        { role: 'assistant', content: JSON.stringify({ blocks: composed }) },
        { role: 'user', content: violationsAsFeedback(violations) },
      );
    }

    return {
      outcome: 'gave-up',
      reason: 'The draft kept breaking the report’s own rules',
      violations: lastViolations,
    };
  }
}
