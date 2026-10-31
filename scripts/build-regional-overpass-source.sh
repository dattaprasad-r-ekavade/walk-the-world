#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage: build-regional-overpass-source.sh <work-dir> <output.osm.bz2>

Downloads the four current Geofabrik extracts covering the Demo cities,
verifies their published MD5 files, and merges them into one metadata-free
Overpass import file. Requires curl, md5sum, sha256sum, awk, realpath, and osmium.
The output path and its source manifest must not already exist.
EOF
}

if [[ $# -ne 2 ]]; then
  usage >&2
  exit 2
fi

work_dir=$(realpath -m -- "$1")
output=$(realpath -m -- "$2")
source_manifest="${output}.sources.tsv"
output_tmp="${output}.tmp.$$"

for tool in curl md5sum sha256sum awk realpath osmium; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$tool" >&2
    exit 1
  fi
done

if [[ $output != *.osm.bz2 ]]; then
  printf 'Output must end in .osm.bz2 for the Overpass import format.\n' >&2
  exit 2
fi
if [[ -e $output || -e $source_manifest ]]; then
  printf 'Refusing to overwrite existing output or source manifest.\n' >&2
  exit 1
fi

mkdir -p -- "$work_dir" "$(dirname -- "$output")"
temporary_files=("$output_tmp")
cleanup() {
  local file
  for file in "${temporary_files[@]}"; do
    rm -f -- "$file"
  done
}
trap cleanup EXIT

sources=(
  "https://download.geofabrik.de/north-america/us/new-york-latest.osm.pbf"
  "https://download.geofabrik.de/asia/india/western-zone-latest.osm.pbf"
  "https://download.geofabrik.de/asia/japan/kanto-latest.osm.pbf"
  "https://download.geofabrik.de/europe/united-kingdom/scotland-latest.osm.pbf"
)
files=()

download_atomic() {
  local url=$1
  local destination=$2
  local temporary="${destination}.tmp.$$"
  temporary_files+=("$temporary")
  if [[ ! -f $destination ]]; then
    curl --fail --location --retry 3 --retry-delay 2 --output "$temporary" "$url"
    mv -- "$temporary" "$destination"
  fi
}

for url in "${sources[@]}"; do
  name=${url##*/}
  pbf="$work_dir/$name"
  checksum="$work_dir/$name.md5"
  download_atomic "$url" "$pbf"
  download_atomic "${url}.md5" "$checksum"

  expected=$(awk 'NR == 1 { print $1; exit }' "$checksum")
  if [[ ! $expected =~ ^[[:xdigit:]]{32}$ ]]; then
    printf 'Invalid MD5 file for %s\n' "$name" >&2
    exit 1
  fi
  actual=$(md5sum -- "$pbf" | awk '{ print $1 }')
  if [[ $actual != "$expected" ]]; then
    printf 'MD5 mismatch for %s\n' "$name" >&2
    exit 1
  fi
  files+=("$pbf")
done

osmium merge "${files[@]}" -f 'osm.bz2,add_metadata=false' -o "$output_tmp"
mv -- "$output_tmp" "$output"

{
  printf 'created_at_utc\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'merged_file\t%s\t%s\t%s\n' \
    "${output##*/}" \
    "$(wc -c < "$output" | tr -d ' ')" \
    "$(sha256sum -- "$output" | awk '{ print $1 }')"
  printf 'file\turl\tbytes\tmd5\tsha256\n'
  for index in "${!sources[@]}"; do
    pbf=${files[$index]}
    printf '%s\t%s\t%s\t%s\t%s\n' \
      "${pbf##*/}" \
      "${sources[$index]}" \
      "$(wc -c < "$pbf" | tr -d ' ')" \
      "$(md5sum -- "$pbf" | awk '{ print $1 }')" \
      "$(sha256sum -- "$pbf" | awk '{ print $1 }')"
  done
} > "$source_manifest"

printf 'Merged regional import: %s\nSource manifest: %s\n' "$output" "$source_manifest"
printf 'Import with Overpass init_osm3s.sh using --meta=no; database footprint remains to be measured.\n'
