import { stripComments } from './helpers/source-scan';

/**
 * The stripper the source-scanning tests share (OPS-40).
 *
 * Every rule below is one a hand-rolled regex in this repo got wrong, and
 * each cost real debugging — a test failing on a rule the code kept, or
 * passing while the thing it guarded was gone.
 */
describe('stripComments', () => {
  it('blanks a whole-line comment', () => {
    expect(stripComments('// gone\nkept').trim()).toBe('kept');
  });

  it('blanks a trailing comment', () => {
    expect(stripComments('const a = 1; // why').trimEnd()).toBe('const a = 1;');
  });

  it('blanks a block comment', () => {
    expect(stripComments('a /* gone */ b').replace(/\s+/g, ' ')).toBe('a b');
  });

  it('blanks a JSDoc block', () => {
    expect(stripComments('/**\n * gone\n */\nkept').trim()).toBe('kept');
  });

  /*
    The three failures that caused this. Each is a line a regex mangled.
  */
  it('leaves the slashes inside a URL alone', () => {
    // `//[^\n]*` truncated this line at the protocol, and an assertion about
    // what came after it failed on a rule the code kept.
    const line = `const origin = 'https://maybeos.org';`;
    expect(stripComments(line)).toBe(line);
  });

  it('does not treat a glob in a line comment as a block opener', () => {
    /*
      `chunks/app` followed by two stars contains a block-comment opener.
      Stripping blocks first blanked everything to the next close — forty
      lines in one file, including the assertion's target.
    */
    const src = ['// maps for .next/static/chunks/app/**', "silent: false,", 'after();'].join('\n');
    const out = stripComments(src);
    expect(out).toContain('silent: false,');
    expect(out).toContain('after();');
  });

  it('keeps line numbers, so a failure points at the right line', () => {
    const src = '/*\n multi\n line\n*/\ntarget';
    const out = stripComments(src);
    expect(out.split('\n')).toHaveLength(5);
    expect(out.split('\n')[4]).toBe('target');
  });

  it('leaves a comment opener inside a string alone', () => {
    for (const line of [`const a = '/* not a comment */';`, `const b = "// not either";`]) {
      expect(stripComments(line)).toBe(line);
    }
  });

  it('handles a template literal', () => {
    const line = 'const u = `${origin}/api//double`;';
    expect(stripComments(line)).toBe(line);
  });

  it('is not fooled by an escaped quote', () => {
    const line = `const a = 'it\\'s // fine'; // gone`;
    expect(stripComments(line)).toContain(`'it\\'s // fine';`);
    expect(stripComments(line)).not.toContain('gone');
  });

  it('leaves escaped slashes in a regex alone', () => {
    // How these patterns are written in the files being scanned.
    const line = String.raw`const re = /\/\/[^\n]*/g;`;
    expect(stripComments(line)).toBe(line);
  });

  it('survives an unterminated block comment', () => {
    // A truncated file should blank to the end rather than throw.
    expect(stripComments('kept /* and then nothing').trimEnd()).toBe('kept');
  });

  it('leaves code with no comments untouched', () => {
    const src = 'const a = 1;\nconst b = a / 2 / 3;\n';
    expect(stripComments(src)).toBe(src);
  });

  /**
   * A quote inside a regex literal (the 2026-11-14 blindness).
   *
   * `rich-composer.tsx` has `replace(/["<>]/g, '')`. That `"` was read as the
   * start of a string, so the walk skipped to the next `"` — hundreds of lines
   * later — and blanked no comment in between. Two guards scan that file and
   * were reading its prose as if it were code from line 330 on.
   *
   * The failure to notice is the point: nothing was wrong with the output of
   * any test. They all passed, against a file the scanner had stopped reading.
   */
  describe('a regex literal is not a string', () => {
    it('does not lose its bearings on a quote inside a character class', () => {
      const line = `const alt = name.replace(/["<>]/g, ''); // gone`;
      const out = stripComments(line);

      expect(out).toContain(`replace(/["<>]/g, '')`);
      expect(out).not.toContain('gone');
    });

    it('still blanks a comment that comes after one', () => {
      const src = [
        `const a = s.replace(/["']/g, '');`,
        `/* this whole block must go */`,
        `const b = 2;`,
      ].join('\n');
      const out = stripComments(src);

      expect(out).not.toContain('must go');
      expect(out).toContain('const b = 2;');
    });

    it.each([
      ['after a paren', `x.replace(/["]/g, '')`],
      ['after an equals', `const re = /["]/g;`],
      ['after a bang', `if (!/["]/.test(s)) {}`],
      ['after a comma', `f(1, /["]/g)`],
      ['after a colon', `const o = { re: /["]/g };`],
      ['after an arrow', `const f = () => /["]/g;`],
    ])('recognises a literal %s', (_label, line) => {
      // Unchanged, and the walk still knows where it is afterwards.
      expect(stripComments(`${line} // gone`)).toContain(line);
      expect(stripComments(`${line} // gone`)).not.toContain('gone');
    });

    /** Division must stay division, or the walk eats real code. */
    it('does not treat division as a literal', () => {
      const line = 'const half = total / 2; // gone';
      const out = stripComments(line);

      expect(out).toContain('const half = total / 2;');
      expect(out).not.toContain('gone');
    });

    /**
     * `<` is kept out of the set on purpose: `</div>` would otherwise open a
     * "regex" and swallow the JSX after it.
     */
    it('does not mistake a JSX closing tag for a literal', () => {
      const line = 'return <div>{a}</div>; // gone';
      const out = stripComments(line);

      expect(out).toContain('<div>{a}</div>;');
      expect(out).not.toContain('gone');
    });

    it('treats an unterminated slash as ordinary, which is how it behaved before', () => {
      // A lone `/` in an expression that never closes must not swallow the
      // rest of the file; falling through leaves today's behaviour.
      const src = 'const a = (1 / x);\n// gone\nconst b = 2;';
      const out = stripComments(src);

      expect(out).not.toContain('gone');
      expect(out).toContain('const b = 2;');
    });
  });
});
