/**
 * Git fixtures must not inherit the caller's repository.
 *
 * This suite also runs from the `pre-push` hook, where git exports `GIT_DIR`
 * (the repo is a linked worktree) and lefthook exports its own `LEFTHOOK*`
 * pointers. Any of those redirects `git init` / `git commit` at the real
 * checkout instead of the temp repo a test just created.
 */
const REPOSITORY_SELECTION_VARS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_PREFIX',
  'GIT_NAMESPACE',
] as const;

/** `LEFTHOOK` itself plus every `LEFTHOOK_*` pointer a hook exports. */
const HOOK_VAR = /^LEFTHOOK(?:_|$)/;

/**
 * Copy an environment without the git repository-selection and lefthook hook
 * variables, so a fixture's `git` child only ever sees the temp repo passed as
 * its `cwd` (or `-C`).
 */
export function hermeticGitEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base };
  for (const name of REPOSITORY_SELECTION_VARS) delete env[name];
  for (const name of Object.keys(env)) {
    if (HOOK_VAR.test(name)) delete env[name];
  }
  return env;
}
