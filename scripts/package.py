"""Package only public source; never profiles, dependencies or generated secrets."""
from pathlib import Path
import json
import tarfile
import sys

root = Path(__file__).resolve().parents[1]
output = root.parent / "quorum-custody-source.tar.gz"
excluded = {".build", "node_modules", "dist", ".git", ".env"}
files = [p for p in root.rglob("*") if p.is_file() and not any(
    part in excluded or part.startswith(".dev") for part in p.relative_to(root).parts
) and p.suffix not in {".log", ".qcb"}]
known_secrets = []
for actor_file in root.glob(".dev*/actors/*.json"):
    actor = json.loads(actor_file.read_text())
    known_secrets += [actor.get("token", ""), actor.get("privateKey", "")]
for path in files:
    data = path.read_bytes()
    # References to development paths/functions are allowed; literal key bytes are not.
    if b"-----BEGIN PRIVATE KEY-----\n" in data or b"-----BEGIN RSA PRIVATE KEY-----\n" in data:
        sys.exit(f"Private key material in {path.relative_to(root)}")
    for secret in known_secrets:
        if secret and secret.encode() in data:
            sys.exit(f"Generated secret in {path.relative_to(root)}")
with tarfile.open(output, "w:gz") as archive:
    for path in sorted(files):
        archive.add(path, arcname="quorum-custody/" + str(path.relative_to(root)))
with tarfile.open(output) as archive:
    assert not any(any(part in excluded or part.startswith(".dev") for part in Path(m.name).parts) for m in archive.getmembers())
print(f"Source-only archive: {output} ({len(files)} files; generated secrets excluded)")
