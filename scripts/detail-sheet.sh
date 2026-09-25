#!/usr/bin/env bash
# Contact sheet of the detail-pass cameras: scripts/detail-sheet.sh <tag> -> .shots/detail/<tag>/sheet_<time>.jpg
cd "$(dirname "$0")/../.shots/detail/$1" || exit 1
for t in 12 18.8; do
  args=()
  for n in gado-far gado-mid gado-near train rotary lattice zakkyo-mid zakkyo-near alley alley-near mural hotel; do args+=(-i "${n}_${t}.jpg"); done
  ffmpeg -loglevel error -y "${args[@]}" -filter_complex "xstack=inputs=12:layout=0_0|w0_0|w0+w1_0|w0+w1+w2_0|0_h0|w0_h0|w0+w1_h0|w0+w1+w2_h0|0_h0+h4|w0_h0+h4|w0+w1_h0+h4|w0+w1+w2_h0+h4,scale=2000:-1" "sheet_${t}.jpg"
done
ls sheet_*
