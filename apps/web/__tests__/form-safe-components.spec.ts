import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Components that render inside a `<form>` have two rules (EVT-22).
 *
 * A `<button>` with no `type` is a **submit** button. That is the HTML
 * default, and it costs nothing until the component is dropped inside a form
 * — which is exactly what happened: `ImageUploader` lived on two admin pages
 * where nothing wrapped it, so its three untyped buttons were harmless for
 * months. Putting the picker in the event form turned "Upload a picture" into
 * "save and close this event": Charley clicked it, the file dialog opened,
 * and behind it the form submitted and vanished. He came back from Finder to
 * the list he started on, with no idea why.
 *
 * The second rule is that a `<form>` cannot contain a `<form>`. It is invalid
 * HTML, and which form a submit button belongs to is then left to the
 * browser. The Unsplash and web-address tabs were each written as their own
 * little form, inside the event's.
 *
 * A repo-wide version of the first rule would fail on 179 buttons, nearly all
 * of them nowhere near a form — a sweep that big does not belong in a bug
 * fix. So this is the list of components that actually render inside one, and
 * adding a component to that form means adding it here.
 */
const INSIDE_A_FORM = [
  'components/events/event-form.tsx',
  'components/events/event-image-picker.tsx',
  'components/ui/image-uploader.tsx',
  'components/ui/image-cropper.tsx',
];

/**
 * Comments and prose are not markup.
 *
 * Written after the first run of this scan reported an untyped button in
 * `image-uploader.tsx` that turned out to be the sentence explaining why they
 * all have types now.
 */
function markupOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const read = (file: string) =>
  markupOnly(readFileSync(join(process.cwd(), file), 'utf8'));

describe('components that render inside a form', () => {
  it.each(INSIDE_A_FORM)('%s gives every button an explicit type', (file) => {
    const untyped = [...read(file).matchAll(/<button\b((?:[^>]|\n)*?)>/g)]
      .filter((match) => !/\btype=/.test(match[1]))
      .map((match) => match[0].replace(/\s+/g, ' ').slice(0, 60));

    expect(untyped).toEqual([]);
  });

  it.each(INSIDE_A_FORM.filter((f) => !f.endsWith('event-form.tsx')))(
    '%s does not open a form of its own',
    (file) => {
      // The event form is the form; anything rendered within it that opens
      // another is nesting them.
      expect(read(file)).not.toMatch(/<form\b/);
    },
  );

  it('is a list somebody has to maintain, so it names why', () => {
    // A guard whose scope nobody can see is a guard that quietly stops
    // covering things. If the event form grows a fifth component, this test
    // is where it has to be declared.
    expect(INSIDE_A_FORM).toContain('components/events/event-image-picker.tsx');
    expect(INSIDE_A_FORM.length).toBeGreaterThanOrEqual(4);
  });
});
