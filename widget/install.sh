#!/bin/bash
# Installs or updates the desktop widget in Übersicht: copies the widget,
# points its command at the config.json next to it, and leaves an existing
# config.json (your share link) untouched.
#   ./widget/install.sh
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
WIDGETS="$HOME/Library/Application Support/Übersicht/widgets"
DEST="$WIDGETS/tqqq.widget"

[ -d "$WIDGETS" ] || { echo "Übersicht's widgets folder is missing; open Übersicht once, then run this again." >&2; exit 1; }

mkdir -p "$DEST"
cat > "$DEST/run.sh" <<EOF
#!/bin/bash
# Written by $REPO/widget/install.sh: hands the widget its config.
exec cat "$DEST/config.json"
EOF
chmod +x "$DEST/run.sh"
# Übersicht runs the command through a shell: the quoted absolute path survives
# the space in "Application Support".
sed "s|'__RUN_SH__'|'\"$DEST/run.sh\"'|" "$REPO/widget/tqqq.widget/index.jsx" > "$DEST/index.jsx"
[ -f "$DEST/config.json" ] || cp "$REPO/widget/config.example.json" "$DEST/config.json"

echo "Installed: $DEST"
echo "Your share link goes in: $DEST/config.json"
