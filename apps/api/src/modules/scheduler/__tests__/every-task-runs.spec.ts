import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Every scheduled task is actually scheduled (OPS-35).
 *
 * `send-ticket-confirmations` was written, tested, reviewed, committed and
 * deployed without ever being added to the array that runs it. The method sat
 * in the file, fully working, and was called by nothing. Ten ticket buyers
 * went on being told nothing for three runs of a scheduler that reported
 * success every time, because from its point of view there was nothing to do.
 *
 * Nothing caught it. The unit tests passed — they call the method directly.
 * The build passed. The deploy was healthy. The run returned 200 with a task
 * list that simply did not mention it, and nobody counts that list.
 *
 * This is a source scan rather than a behavioural test for the same reason
 * the unauthenticated-route index is: the thing that went wrong is a *missing*
 * line, and no test of what the code does can see a line that is not there.
 * It compares the two halves that drifted — the private task methods and the
 * array that calls them — and fails when one knows about something the other
 * does not.
 */
const SOURCE = join(__dirname, '..', 'scheduler.service.ts');

/**
 * Methods that are not tasks. Each one has to be named here on purpose, so
 * that adding a helper is a decision and forgetting a task is a failure —
 * the opposite way round from a test that lists the tasks it expects, which
 * is a list somebody has to remember to update and therefore doesn't.
 */
const NOT_TASKS = new Set<string>();

function source(): string {
  // Comments stripped first: `runDueTasks` has a commented-out task in its
  // history and a doc comment naming methods, and either would be read as
  // code by a bare regex. The same lesson as the route index.
  return readFileSync(SOURCE, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

/** The array inside `runDueTasks`. */
function taskArray(src: string): string {
  const match = src.match(/for \(const task of \[([\s\S]*?)\n\s*\]\) \{/);
    if (!match) throw new Error('Could not find the task array in runDueTasks');
  return match[1];
}

describe('the scheduler runs every task it defines', () => {
  const src = source();
  const array = taskArray(src);

  it('found the array to inspect', () => {
    // Guards against the whole suite passing because the regex broke, which
    // is the failure mode of every test that searches a file.
    expect(array).toContain('close-due-proposals');
  });

  /**
   * The bug, stated directly. A `private async foo(): Promise<TaskResult>`
   * that nothing in the array calls is a task that never runs.
   */
  it('calls every method that returns a TaskResult', () => {
    const defined = [...src.matchAll(/private async (\w+)\([^)]*\)\s*:\s*Promise<TaskResult>/g)]
      .map((m) => m[1])
      .filter((name) => !NOT_TASKS.has(name));

    expect(defined.length).toBeGreaterThan(10);

    const orphans = defined.filter((name) => !array.includes(`this.${name}(`));

    expect(orphans).toEqual([]);
  });

  /** And the reverse: an array entry naming a method that no longer exists. */
  it('names no method that does not exist', () => {
    const called = [...array.matchAll(/this\.(\w+)\(/g)].map((m) => m[1]);

    expect(called.length).toBeGreaterThan(10);

    const missing = called.filter(
      (name) => !new RegExp(`private async ${name}\\(`).test(src),
    );

    expect(missing).toEqual([]);
  });

  /**
   * Every task reports under a name, and the name is what a run's result is
   * read by. Two tasks sharing one would make a run's report ambiguous, and
   * a name that does not match its method is how somebody debugging at 2am
   * ends up looking at the wrong code.
   */
  it('gives every task a distinct name', () => {
    const names = [...array.matchAll(/name: '([^']+)'/g)].map((m) => m[1]);

    expect(names.length).toBe(new Set(names).size);
    expect(names).toContain('send-ticket-confirmations');
  });
});
