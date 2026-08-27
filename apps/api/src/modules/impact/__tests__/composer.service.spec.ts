import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ComposerService } from '../composer.service';
import { FactSheet } from '../report-composer';

/**
 * The loop around the model (IMP-23 phase 2).
 *
 * Three behaviours matter and none of them is "the model wrote something
 * good": it must **check** before saving, **retry once with the violations
 * named**, and **give up rather than publish** a draft that keeps breaking the
 * report's own rules. Giving up is a real outcome — the co-op keeps the
 * deterministic report, which is flat and true, and has not been charged,
 * because the charge happens at publish.
 */
describe('ComposerService', () => {
  const facts: FactSheet = {
    org: { name: 'Sunrise', mission: null },
    period: { start: '2026-01-01', end: '2026-12-31', label: 'January 2026 – December 2026' },
    blocks: [
      {
        id: 'b1',
        kind: 'goal',
        heading: 'Belonging',
        facts: { figures: [{ label: 'Belonging', average: 3.8, respondents: 42 }] },
        deterministicDraft: 'Members rated belonging 3.8 out of 5, from 42 people.',
      },
    ],
  };

  const build = async (apiKey: string | undefined) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ComposerService,
        { provide: ConfigService, useValue: { get: () => apiKey } },
      ],
    }).compile();
    return module.get(ComposerService);
  };

  const goodBody = 'Members here rated how much they feel they belong 3.8 out of 5. 42 people answered.';
  const badBody = 'Belonging reached 4.9 out of 5, thanks to our monthly suppers.';

  const withReplies = async (service: ComposerService, bodies: string[]) => {
    const parse = jest
      .fn()
      .mockImplementation(() =>
        Promise.resolve({ parsed_output: { blocks: [{ id: 'b1', body: bodies.shift() }] } }),
      );
    (service as any).client = { messages: { parse } };
    return parse;
  };

  it('says so rather than throwing when there is no API key', async () => {
    // The app must boot and every co-op must still get the free report.
    const service = await build(undefined);
    expect(service.available).toBe(false);

    const result = await service.compose(facts);
    expect(result).toMatchObject({ outcome: 'gave-up' });
  });

  it('accepts a draft that keeps to the facts, first time', async () => {
    const service = await build('sk-test');
    const parse = await withReplies(service, [goodBody]);

    const result = await service.compose(facts);

    expect(result).toMatchObject({ outcome: 'composed', attempts: 1 });
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it('retries once, and tells the model exactly what was wrong', async () => {
    const service = await build('sk-test');
    const parse = await withReplies(service, [badBody, goodBody]);

    const result = await service.compose(facts);

    expect(result).toMatchObject({ outcome: 'composed', attempts: 2 });

    // The second call carries the first draft and the named violations —
    // "you wrote 4.9, which is not in the figures" rather than "try again".
    const secondCall = parse.mock.calls[1][0];
    const feedback = secondCall.messages[secondCall.messages.length - 1].content as string;
    expect(feedback).toContain('4.9');
    expect(feedback).toContain('causal-claim');
  });

  it('gives up rather than saving a draft that keeps breaking the rules', async () => {
    const service = await build('sk-test');
    const parse = await withReplies(service, [badBody, badBody]);

    const result = await service.compose(facts);

    expect(result).toMatchObject({ outcome: 'gave-up' });
    expect(parse).toHaveBeenCalledTimes(2);
    // Reported with the violations, so the note an admin sees can say what
    // went wrong rather than "something went wrong".
    expect((result as any).violations.map((v: any) => v.rule)).toContain('ungrounded-number');
  });

  it('treats a provider failure as a failure of the prose, not of the report', async () => {
    const service = await build('sk-test');
    (service as any).client = {
      messages: { parse: jest.fn().mockRejectedValue(new Error('503 upstream')) },
    };

    await expect(service.compose(facts)).resolves.toMatchObject({
      outcome: 'gave-up',
      reason: '503 upstream',
    });
  });

  it('gives up when nothing readable comes back', async () => {
    const service = await build('sk-test');
    (service as any).client = {
      messages: { parse: jest.fn().mockResolvedValue({ parsed_output: null }) },
    };

    await expect(service.compose(facts)).resolves.toMatchObject({ outcome: 'gave-up' });
  });

  it('asks for the model Charley chose', async () => {
    const service = await build('sk-test');
    const parse = await withReplies(service, [goodBody]);

    await service.compose(facts);

    expect(parse.mock.calls[0][0].model).toBe('claude-sonnet-5');
  });
});
