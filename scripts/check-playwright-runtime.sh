#!/usr/bin/env bash
# Guard the browser installs in verify.yml, which no longer use `--with-deps`.
#
# Neither browser needs apt on `ubuntu-24.04`: every library in Playwright's
# chromium list is reported "already the newest version" by apt, and firefox's
# extra packages are dlopened media codecs, not DT_NEEDED of the build. What
# `--with-deps` gave us for free was a loud failure when a library goes missing
# (from the runner image, or from a future browser build); this script puts that
# back, in seconds instead of after the app build and seeding:
#
#   1. `ldd` every browser executable in the Playwright cache and fail on any
#      "not found", naming the soname.
#   2. Launch the browser and render a text probe, so a binary that links but
#      cannot start (missing GL/EGL data, bad flags) fails here as well.
#
# Playwright itself only validates the host on the first launch of a freshly
# installed browser (the `DEPENDENCIES_VALIDATED` marker `--with-deps` writes),
# and its error is a package list rather than the shared object that is missing.
#
# Usage: bash scripts/check-playwright-runtime.sh [chromium|firefox]
#
# Fonts are deliberately not checked here: the only fonts `--with-deps` was
# adding on this image were Thai (fonts-tlwg-loma-otf), CJK (fonts-ipafont-*,
# fonts-wqy-zenhei), last-resort coverage (fonts-unifont, fonts-freefont-ttf)
# and X11 bitmap/Type1 faces (xfonts-*). The suite renders pl/en text only, and
# fontconfig resolves `sans-serif`/`serif`/`Arial` (the next/font fallback) to
# DejaVu and Liberation either way — see the PR that introduced this script.
set -euo pipefail

browser="${1:-chromium}"
cache="${PLAYWRIGHT_BROWSERS_PATH:-${HOME}/.cache/ms-playwright}"

case "$browser" in
  chromium)
    # Only the executables: the bundled .so files come from CfT and are covered
    # by the launch below.
    find_names=(-name chrome -o -name headless_shell -o -name chrome-headless-shell)
    ;;
  firefox)
    # The executable, not the bundled .so files: those resolve their siblings
    # through the launcher's RUNPATH, so a bare `ldd` on them reports false
    # "not found" (and versioned-symbol noise). The launch below runs
    # Playwright's own directory-wide check, which does that walk correctly.
    find_names=(-name firefox)
    ;;
  *)
    echo "unknown browser: $browser (expected chromium or firefox)" >&2
    exit 1
    ;;
esac

if [ ! -d "$cache" ]; then
  echo "::error::no Playwright browser cache at $cache" >&2
  exit 1
fi

mapfile -t executables < <(
  find "$cache" -maxdepth 4 -type f \( "${find_names[@]}" \) -path "*${browser}*" 2>/dev/null | sort
)

if [ "${#executables[@]}" -eq 0 ]; then
  echo "::error::no $browser executable under $cache — did the install step run?" >&2
  exit 1
fi

status=0
for executable in "${executables[@]}"; do
  # `ldd` exits non-zero for a static or non-ELF file; the `-o pipefail` above
  # would turn that into an opaque failure, so capture and report it instead.
  ldd_output="$(ldd "$executable" 2>&1)" || {
    echo "::error file=$executable::ldd failed to inspect the executable" >&2
    echo "$ldd_output" >&2
    status=1
    continue
  }

  # Only the `libfoo.so => not found` form: `ldd` also prints
  # `-` `version `NSS_3.101' not found` for unsatisfied symbol versions, which
  # is not a missing library.
  missing="$(awk '/=> not found/ {print $1}' <<<"$ldd_output" | sort -u | paste -sd' ' -)"
  if [ -n "$missing" ]; then
    echo "::error file=$executable::missing shared libraries: $missing" >&2
    status=1
  else
    echo "ok  ${executable#"$cache"/} — every shared library resolves"
  fi
done

if [ "$status" -ne 0 ]; then
  exit "$status"
fi

# `node -e` resolves bare specifiers from the current working directory, so this
# must run from the repo root (the workflow does).
node --input-type=module -e "
import { ${browser} as engine } from 'playwright';

const launched = await engine.launch();
const version = launched.version();
const page = await launched.newPage();
await page.setContent(
  '<span id=\"probe\" style=\"display:inline-block;font:16px sans-serif\">Zażółć gęślą jaźń</span>',
);
const width = await page.evaluate(
  () => document.getElementById('probe').getBoundingClientRect().width,
);
await launched.close();

if (!(width > 0)) throw new Error('the text probe rendered no glyphs');
console.log(
  'ok  ' + '${browser}' + ' ' + version + ' launched — 20-glyph probe is ' + width.toFixed(1) + 'px',
);
"
