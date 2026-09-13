import { ValidationPipe, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { UnsplashService } from '../unsplash.service';
import { CreateEventDto, UpdateEventDto } from '../dto/create-event.dto';
import { UploadEventImageDto, UnsplashUsedDto } from '../dto/event-image.dto';
import { PublishBookingEventDto } from '../dto/publish-booking-event.dto';
import { VALIDATION_PIPE_OPTIONS } from '../../../common/validation-options';

/**
 * An event's picture (EVT-22): uploaded, typed as a URL, or chosen on
 * Unsplash.
 *
 * The Unsplash half is a proxy holding MaybeOS's API key, which makes the
 * tracking endpoint the sharp edge: it is handed a URL by the browser and
 * then fetches it *with the key attached*. Unchecked, that is an open proxy
 * for anybody with a member account.
 */
describe('event pictures', () => {
  const KEY = 'UNSPLASH_ACCESS_KEY';
  const before = process.env[KEY];
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    if (before === undefined) delete process.env[KEY];
    else process.env[KEY] = before;
    jest.restoreAllMocks();
  });

  /** Built after the env is set, because the key is read in the constructor. */
  const withKey = (key = 'test-key') => {
    process.env[KEY] = key;
    return new UnsplashService();
  };

  const withoutKey = () => {
    delete process.env[KEY];
    return new UnsplashService();
  };

  describe('telling Unsplash a photo was used', () => {
    it('refuses an address that is not theirs', async () => {
      // Without this check the endpoint fetches anything a member names, with
      // MaybeOS's Unsplash key in the headers.
      const service = withKey();

      await expect(
        service.trackUse('https://evil.example.com/collect'),
      ).rejects.toThrow(BadRequestException);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuses a host that merely ends with theirs', async () => {
      const service = withKey();

      await expect(
        service.trackUse('https://api.unsplash.com.evil.example.com/collect'),
      ).rejects.toThrow(BadRequestException);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuses plain http, which would put the key on the wire', async () => {
      const service = withKey();

      await expect(service.trackUse('http://api.unsplash.com/photos/x/download')).rejects.toThrow(
        BadRequestException,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuses something that is not a URL at all', async () => {
      const service = withKey();

      await expect(service.trackUse('not a url')).rejects.toThrow(BadRequestException);
    });

    it('calls their own endpoint with the key', async () => {
      const service = withKey();
      fetchMock.mockResolvedValue({ ok: true });

      await expect(
        service.trackUse('https://api.unsplash.com/photos/abc/download?ixid=1'),
      ).resolves.toEqual({ tracked: true });

      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toContain('api.unsplash.com/photos/abc/download');
      expect((init.headers as Record<string, string>).Authorization).toBe('Client-ID test-key');
    });

    it('does not fail the caller when Unsplash is unreachable', async () => {
      // The picture is already chosen. Losing an analytics ping is not worth
      // losing the event somebody was in the middle of writing.
      const service = withKey();
      fetchMock.mockRejectedValue(new Error('network down'));

      await expect(
        service.trackUse('https://api.unsplash.com/photos/abc/download'),
      ).resolves.toEqual({ tracked: false });
    });
  });

  describe('searching', () => {
    it('says so plainly when no key is configured', async () => {
      const service = withoutKey();

      expect(service.isConfigured).toBe(false);
      await expect(service.search('pottery')).rejects.toThrow(ServiceUnavailableException);
    });

    it('answers a blank search without troubling Unsplash', async () => {
      const service = withKey();

      await expect(service.search('   ')).resolves.toEqual({ photos: [] });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('narrows their shape to ours and keeps the credit', async () => {
      const service = withKey();
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            {
              id: 'abc',
              alt_description: 'a potter at a wheel',
              urls: { regular: 'https://images.unsplash.com/abc?w=1080', thumb: 'https://images.unsplash.com/abc?w=200' },
              links: { download_location: 'https://api.unsplash.com/photos/abc/download' },
              user: { name: 'Ada Potter', links: { html: 'https://unsplash.com/@ada' } },
            },
          ],
        }),
      });

      const { photos } = await service.search('pottery');

      expect(photos).toHaveLength(1);
      expect(photos[0]).toMatchObject({
        id: 'abc',
        url: 'https://images.unsplash.com/abc?w=1080',
        photographer: 'Ada Potter',
        downloadLocation: 'https://api.unsplash.com/photos/abc/download',
      });
      // Unsplash asks every application to append these to the links it shows.
      expect(photos[0].photographerUrl).toContain('utm_source=');
      expect(photos[0].photographerUrl).toContain('utm_medium=referral');
    });

    it('explains the rate limit rather than saying "failed"', async () => {
      // 403 is the hourly cap on a demo key, which is what a co-op will
      // actually hit. "Try again later, or upload one" is actionable.
      const service = withKey();
      fetchMock.mockResolvedValue({ ok: false, status: 403 });

      await expect(service.search('pottery')).rejects.toThrow(/limit is used up/);
    });

    it('survives a photo with no description and no photographer', async () => {
      const service = withKey();
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ results: [{ id: 'bare', urls: {}, links: {} }] }),
      });

      const { photos } = await service.search('anything');

      expect(photos[0].photographer).toBe('Unsplash');
      expect(photos[0].description).toBe('Unsplash photo');
    });
  });
});

/**
 * The bodies these forms send, through the pipe production uses.
 * `forbidNonWhitelisted` refuses the whole request over one undeclared field —
 * which is how every event edit failed for nine days (EVT-21).
 */
describe('event picture fields through the validation whitelist', () => {
  const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);
  const asDto = (metatype: unknown) => (body: object) =>
    pipe.transform(body, { type: 'body', metatype: metatype as never });

  const create = asDto(CreateEventDto);
  const update = asDto(UpdateEventDto);
  const upload = asDto(UploadEventImageDto);
  const used = asDto(UnsplashUsedDto);
  const fromBooking = asDto(PublishBookingEventDto);

  const event = {
    title: 'Throwing night',
    startTime: '2026-10-01T18:00:00.000Z',
    endTime: '2026-10-01T20:00:00.000Z',
  };

  it('lets an event be created with a picture and a credit', async () => {
    // CreateEventDto had no imageUrl at all, so an event could not be created
    // with one: the whitelist refused the whole request.
    await expect(
      create({
        ...event,
        imageUrl: 'https://images.unsplash.com/abc?w=1080',
        imageCredit: 'Ada Potter',
        imageCreditUrl: 'https://unsplash.com/@ada?utm_source=MaybeOS&utm_medium=referral',
      }),
    ).resolves.toMatchObject({ imageCredit: 'Ada Potter' });
  });

  it('refuses a javascript: address, which a browser would resolve', async () => {
    await expect(
      create({ ...event, imageUrl: 'javascript:alert(1)' }),
    ).rejects.toThrow();
  });

  it('refuses a data: URL, which nothing here caps the size of', async () => {
    await expect(
      update({ imageUrl: 'data:image/png;base64,iVBORw0KGgo=' }),
    ).rejects.toThrow();
  });

  it('accepts an empty address, which is how a picture is removed', async () => {
    await expect(update({ imageUrl: '' })).resolves.toMatchObject({ imageUrl: '' });
  });

  it('lets an explicit null through, which the edit form sends when clearing', async () => {
    // `@IsOptional()` passes null, so the service has to cope with one:
    // `null.trim()` would be a 500 on a save that should just remove the
    // picture. The service uses `?.` for exactly this.
    await expect(
      update({ imageUrl: null, imageCredit: null, imageCreditUrl: null } as never),
    ).resolves.toBeDefined();
  });

  it('accepts the upload body the picker sends', async () => {
    await expect(
      upload({ data: 'data:image/png;base64,iVBORw0KGgo=', mimeType: 'image/png' }),
    ).resolves.toBeDefined();
  });

  it('refuses an upload type the bucket does not take', async () => {
    await expect(upload({ data: 'iVBORw0KGgo=', mimeType: 'image/svg+xml' })).rejects.toThrow();
  });

  it('accepts a picture on the publish-from-a-booking form', async () => {
    // That route has its own narrower DTO, and the same picker sits on its
    // form — so a photo chosen there has to be a field it declares. An
    // undeclared one fails the whole publish, not the field (EVT-21).
    await expect(
      fromBooking({
        title: 'Repair Café',
        imageUrl: 'https://images.unsplash.com/abc?w=1080',
        imageCredit: 'Ada Potter',
        imageCreditUrl: 'https://unsplash.com/@ada?utm_source=MaybeOS&utm_medium=referral',
      }),
    ).resolves.toMatchObject({ imageCredit: 'Ada Potter' });
  });

  it('accepts the download location Unsplash handed back', async () => {
    await expect(
      used({ downloadLocation: 'https://api.unsplash.com/photos/abc/download?ixid=1' }),
    ).resolves.toBeDefined();
  });
});
