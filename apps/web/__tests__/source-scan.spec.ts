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
});
