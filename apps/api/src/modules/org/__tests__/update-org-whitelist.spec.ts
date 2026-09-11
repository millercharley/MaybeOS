import { ValidationPipe } from '@nestjs/common';
import { UpdateOrgDto } from '../dto/update-org.dto';
import { VALIDATION_PIPE_OPTIONS } from '../../../common/validation-options';

/**
 * The Settings page's share-tracking switch must survive the whitelist
 * (MEM-19). One undeclared field rejects the whole save, not the field — the
 * way every event edit failed for nine days (EVT-21). This runs the exact
 * body the switch sends through the exact pipe production uses.
 */
const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);
const validate = (body: object) => pipe.transform(body, { type: 'body', metatype: UpdateOrgDto });

describe('updating an org through the whitelist', () => {
  it('accepts the share-tracking switch', async () => {
    await expect(validate({ sharesEnabled: true })).resolves.toMatchObject({ sharesEnabled: true });
  });

  it('accepts it beside the public-join switch it sits near', async () => {
    await expect(validate({ sharesEnabled: false, allowPublicJoin: true })).resolves.toBeDefined();
  });

  it('refuses a value that is not a boolean', async () => {
    await expect(validate({ sharesEnabled: 'yes' })).rejects.toThrow();
  });
});
