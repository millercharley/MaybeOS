import { IG_MAX_RATIO, IG_MIN_RATIO, instagramCrop } from '../lib/instagram-image';

describe('instagramCrop', () => {
  it('keeps a picture already inside Instagram’s range whole', () => {
    expect(instagramCrop(1080, 1080)).toEqual({ sx: 0, sy: 0, sw: 1080, sh: 1080, width: 1080, height: 1080 });
    expect(instagramCrop(1080, 1350)).toMatchObject({ sw: 1080, sh: 1350 });
  });

  it('crops a tall phone photo to 4:5 from the centre', () => {
    const crop = instagramCrop(1080, 1920);
    expect(crop).toMatchObject({ sx: 0, sw: 1080, sh: 1350, sy: 285 });
    expect(crop.width / crop.height).toBeCloseTo(IG_MIN_RATIO, 2);
  });

  it('crops a panorama to 1.91:1 from the centre', () => {
    const crop = instagramCrop(4000, 1000);
    expect(crop.sw).toBe(1910);
    expect(crop.sx).toBe(1045);
    expect(crop.width / crop.height).toBeCloseTo(IG_MAX_RATIO, 2);
  });

  it('scales large pictures down to 1440 wide', () => {
    expect(instagramCrop(4000, 3000)).toMatchObject({ width: 1440, height: 1080 });
  });
});
