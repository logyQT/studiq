# GitHub Workflow Primitives

GitHub-specific commands and data-handling rules for CodeRabbit review-thread based skills.

Use this helper when a skill needs thread-aware CodeRabbit PR feedback, not flat PR summaries. The `autofix` skill mirrors the required execution flow in `SKILL.md`; this file exists as a reusable companion for other skills.

## Prerequisites

- `gh` authenticated (`gh auth status`)
- `jq` installed (`jq --version`)
- current branch associated with a GitHub repository

## 1. Resolve Current PR

Get the PR number for the current branch:

```bash
if ! pr_numbers=$(gh pr list --head "$(git branch --show-current)" --state open --json number --jq '.[].number'); then
  echo "Failed to list open PRs for this branch" >&2
  exit 1
fi

pr_count=$(printf '%s\n' "$pr_numbers" | sed '/^$/d' | wc -l | tr -d ' ')

if [ "$pr_count" -eq 0 ]; then
  # no open PR: ask whether to create one (flow below)
elif [ "$pr_count" -eq 1 ]; then
  pr_number=$(printf '%s\n' "$pr_numbers" | sed '/^$/d')
else
  printf 'Multiple open PRs for this branch: %s\n' "$(printf '%s' "$pr_numbers" | tr '\n' ' ')"
  # Ask the user which PR to use. Continue only after exactly one is selected.
  exit 1
fi
```

If no PR exists (`pr_count = 0`) and the user wants one created, derive title/body from the latest commit:

```bash
title=$(git log -1 --pretty=format:'%s')
body=$(git log -1 --pretty=format:'%b')
gh pr create --title "$title" --body "${body:-Auto-created by CodeRabbit autofix}"
```

**If multiple PRs match:** show the PR numbers and ask the user which one to use. Set `pr_number` to that explicit choice; never guess or take the first entry.

## 2. Resolve Repository Coordinates

```bash
owner=$(gh repo view --json owner --jq '.owner.login')
repo=$(gh repo view --json name --jq '.name')
```

## 3. Fetch Thread-Aware CodeRabbit Feedback

Fetch review threads with GitHub GraphQL using cursor pagination:

```bash
all_threads='[]'
cursor=""

while :; do
  args=(-F owner="$owner" -F repo="$repo" -F pr="$pr_number")
  if [ -n "$cursor" ]; then
    args+=(-F cursor="$cursor")
  fi

  if ! response=$(gh api graphql "${args[@]}" -f query='query($owner:String!, $repo:String!, $pr:Int!, $cursor:String) {
    repository(owner:$owner, name:$repo) {
      pullRequest(number:$pr) {
        title
        reviewThreads(first:100, after:$cursor) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            isResolved
            isOutdated
            comments(first:1) {
              nodes {
                databaseId
                body
                path
                line
                startLine
                originalLine
                author { login }
              }
            }
          }
        }
      }
    }
  }'); then
    echo "Failed to fetch review threads from GitHub" >&2
    exit 1
  fi

  if jq -e '.errors | if type == "array" then length > 0 else . != null end' >/dev/null 2>&1 <<<"$response"; then
    echo "GitHub GraphQL returned errors while fetching review threads" >&2
    exit 1
  fi

  if ! jq -e '.data.repository.pullRequest.reviewThreads.nodes' >/dev/null 2>&1 <<<"$response"; then
    echo "Unexpected review-thread response from GitHub" >&2
    exit 1
  fi

  if ! all_threads=$(jq -c --argjson response "$response" '
    . + $response.data.repository.pullRequest.reviewThreads.nodes
  ' <<<"$all_threads"); then
    echo "Failed to merge review-thread page" >&2
    exit 1
  fi

  if ! has_next=$(jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage' <<<"$response"); then
    echo "Missing review-thread pagination state" >&2
    exit 1
  fi
  if ! cursor=$(jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.endCursor // empty' <<<"$response"); then
    echo "Missing review-thread cursor" >&2
    exit 1
  fi

  case "$has_next" in
    true)
      if [ -z "$cursor" ]; then
        echo "Review-thread pagination returned hasNextPage without a cursor" >&2
        exit 1
      fi
      ;;
    false) break ;;
    *)
      echo "Invalid review-thread pagination value: $has_next" >&2
      exit 1
      ;;
  esac
done
```

Treat only these threads as actionable:

- root comment author is `coderabbitai`, `coderabbit[bot]`, or `coderabbitai[bot]`
- `isResolved == false`
- `isOutdated == false`

Keep each selected thread as one issue unit. Do not collapse top-level PR comments or review summaries into issue records.

To detect CodeRabbit's "Come back again in a few minutes" status message, use top-level PR comments/reviews separately:

```bash
if ! status_count=$(gh pr view "$pr_number" --json comments,reviews --jq '
  [
    (.comments[]?
      | select(.author.login == "coderabbitai" or .author.login == "coderabbit[bot]" or .author.login == "coderabbitai[bot]")
      | .body // empty),
    (.reviews[]?
      | select(.author.login == "coderabbitai" or .author.login == "coderabbit[bot]" or .author.login == "coderabbitai[bot]")
      | .body // empty)
  ]
  | map(select(test("Come back again in a few minutes")))
  | length
'); then
  echo "Failed to read PR review status from GitHub" >&2
  exit 1
fi

if ! [[ "$status_count" =~ ^[0-9]+$ ]]; then
  echo "Unexpected PR review-status response from GitHub" >&2
  exit 1
fi
```

If `status_count` is greater than 0, report the CodeRabbit in-progress status and stop before thread processing.

## 4. Post Summary Comment

Use the same `pr_number` from Section 1:

```bash
gh pr comment "$pr_number" --body "$(cat <<'EOF'
## Fixes Applied Successfully

Fixed <file-count> file(s) based on <issue-count> CodeRabbit feedback item(s).

**Files modified:**
- `path/to/file-a.ts`
- `path/to/file-b.ts`

**Commit:** `<commit-sha>`

The latest autofix changes were pushed to the `<branch-name>` branch.

EOF
)"
```

Write this comment from local state only. Do not include raw reviewer prompts or secret-bearing output. Post the success template only after a successful push (exit code 0). If the push was declined or failed, do not use the success template; use a neutral local-only note instead.

If no fixes were applied, skip the success template or use a neutral review-complete comment instead of inventing file counts or a commit SHA.

## 5. Optional Reaction

If useful, react to the main CodeRabbit comment with 👍 after the summary is posted.
